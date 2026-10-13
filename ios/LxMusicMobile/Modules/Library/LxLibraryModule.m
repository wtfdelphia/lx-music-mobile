#import "LxLibraryModule.h"
#import "LxLibraryStore.h"
#import "LxFolderAccess.h"
#import "LxFolderScanner.h"
#import "LxMediaProbe.h"
#import "LxArtworkCache.h"
#import "LxCredentialStore.h"
#import "LxLibraryUtils.h"
#import <UIKit/UIKit.h>

// 本地曲库模块实现（§5）。
// - 所有方法返回 Promise；耗时操作在模块串行队列（lx.library.io 由
//   Store 内部持有），扫描走 Scanner 的后台队列
// - 事件：library_scan_progress（300ms 节流）、library_scan_done
// - pickFolder 复用 UtilsModule 的稳定呈现管线思路（§5.2）

NSString * const kScanProgressEvent = @"library_scan_progress";
NSString * const kScanDoneEvent = @"library_scan_done";

@interface LxLibraryModule () <UIDocumentPickerDelegate, LxFolderScannerDelegate>
@property (nonatomic, strong) LxFolderScanner *scanner;
@property (nonatomic, strong) UIDocumentPickerViewController *folderPicker;
@property (nonatomic, copy) RCTPromiseResolveBlock pendingPickResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pendingPickReject;
@property (nonatomic, strong) NSDate *lastProgressEmit;
@property (nonatomic, assign) BOOL hasListeners;
@end

@implementation LxLibraryModule

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup { return NO; }

- (instancetype)init
{
  if (self = [super init]) {
    _scanner = [LxFolderScanner new];
    _scanner.delegate = self;
    [[LxLibraryStore shared] open];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ kScanProgressEvent, kScanDoneEvent ];
}

- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving { _hasListeners = NO; }

#pragma mark - ping

RCT_EXPORT_METHOD(ping:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@(YES));
}

#pragma mark - 来源

RCT_EXPORT_METHOD(getSources:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([[LxLibraryStore shared] getSources]);
}

RCT_EXPORT_METHOD(saveSource:(NSDictionary *)source
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *sourceId = LxStr(source[@"id"]);
  BOOL ok = [[LxLibraryStore shared] saveSource:source];
  if (ok && sourceId.length) {
    // 记录授权：config 字段是 JSON 字符串；解析失败不阻断落库
    //（下载虚拟来源等无授权来源由 acquire 时懒加载，F1 / F4）
    NSString *configStr = LxStr(source[@"config"]);
    NSDictionary *config = nil;
    if (configStr.length) {
      NSData *data = [configStr dataUsingEncoding:NSUTF8StringEncoding];
      id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if ([parsed isKindOfClass:[NSDictionary class]]) config = parsed;
    }
    [[LxFolderAccess shared] saveGrantForSourceId:sourceId config:config ?: @{}];
  }
  resolve(@(ok));
}

RCT_EXPORT_METHOD(deleteSource:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] deleteSource:sourceId];
  // 删除来源时强制释放授权（§5.2）
  [[LxFolderAccess shared] forceReleaseForDelete:sourceId];
  [[LxCredentialStore shared] deleteSecretForSourceId:sourceId];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(pickFolder:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.pendingPickResolve = resolve;
    self.pendingPickReject = reject;

    // 部署目标 13.4：沿用 UtilsModule 的 documentTypes 惯例（iOS 14 起
    // 标记废弃但仍可用），避免 UTType 在低部署目标下的可见性问题
    UIDocumentPickerViewController *picker =
        [[UIDocumentPickerViewController alloc] initWithDocumentTypes:@[@"public.folder"] inMode:UIDocumentPickerModeOpen];
    picker.delegate = self;
    picker.allowsMultipleSelection = NO;
    self.folderPicker = picker;

    UIViewController *top = [self lx_topViewController];
    if (!top) {
      resolve([NSNull null]);
      return;
    }
    [top presentViewController:picker animated:YES completion:nil];
  });
}

- (UIViewController *)lx_topViewController
{
  UIViewController *root = [UIApplication sharedApplication].delegate.window.rootViewController;
  while (root.presentedViewController) root = root.presentedViewController;
  return root;
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  NSURL *url = urls.firstObject;
  if (!url) {
    if (self.pendingPickResolve) self.pendingPickResolve([NSNull null]);
    self.pendingPickResolve = nil;
    return;
  }
  // 判断是否在本 App Documents 内（沙箱分支，§5.2）。
  // 选择器返回的路径可能带 /private 前缀（符号链接形式），而
  // NSSearchPath 返回 /var 形式：两边都先解析符号链接再比前缀，
  // 否则容器内文件夹会被误判为外部文件夹走 bookmark 分支
  NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *documentsResolved = [[NSURL fileURLWithPath:documents] URLByResolvingSymlinksInPath].path;
  NSString *pathResolved = [url URLByResolvingSymlinksInPath].path ?: url.path;
  NSString *documentsPrefix = [documentsResolved stringByAppendingString:@"/"];
  BOOL inSandbox = [pathResolved isEqualToString:documentsResolved] || [pathResolved hasPrefix:documentsPrefix];
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  result[@"label"] = url.lastPathComponent ?: @"";
  if (inSandbox) {
    NSString *rel = [pathResolved isEqualToString:documentsResolved] ? @"" : [pathResolved substringFromIndex:documentsPrefix.length];
    // 只回传存在的键：不回传 [NSNull null]，下游一律按缺失处理（F5）。
    // relPath 允许空串 = Documents 根
    result[@"relPath"] = rel;
  } else {
    // 生成 bookmark（§5.2）
    BOOL started = [url startAccessingSecurityScopedResource];
    NSError *bmError = nil;
    NSData *bookmark = [url bookmarkDataWithOptions:0 includingResourceValuesForKeys:nil relativeToURL:nil error:&bmError];
    if (started) [url stopAccessingSecurityScopedResource];
    if (!bookmark) {
      if (self.pendingPickResolve) self.pendingPickResolve([NSNull null]);
      self.pendingPickResolve = nil;
      return;
    }
    result[@"bookmark"] = [bookmark base64EncodedStringWithOptions:0];
  }
  if (self.pendingPickResolve) self.pendingPickResolve(result);
  self.pendingPickResolve = nil;
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  if (self.pendingPickResolve) self.pendingPickResolve([NSNull null]);
  self.pendingPickResolve = nil;
}

RCT_EXPORT_METHOD(relink:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // relink 走 pickFolder 流程；此处接收已选中的 bookmark（模块层编排）
  resolve([NSNull null]);
}

RCT_EXPORT_METHOD(acquire:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *error = nil;
  BOOL ok = [[LxFolderAccess shared] acquire:sourceId error:&error];
  if (!ok) {
    NSString *code = (error.code == 1) ? @"E_REAUTH" : @"E_NOT_FOUND";
    reject(code, error.localizedDescription, error);
    return;
  }
  resolve(@(YES));
}

RCT_EXPORT_METHOD(release:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxFolderAccess shared] release:sourceId];
  resolve(@(YES));
}

#pragma mark - 扫描

RCT_EXPORT_METHOD(startScan:(NSString *)sourceId options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL recursive = LxBool(options[@"recursive"]);
  NSURL *rootURL = [[LxFolderAccess shared] rootURLForSourceId:sourceId];
  if (!rootURL) {
    // 先 acquire
    NSError *error = nil;
    if (![[LxFolderAccess shared] acquire:sourceId error:&error]) {
      reject(@"E_REAUTH", error.localizedDescription ?: @"acquire failed", error);
      return;
    }
    rootURL = [[LxFolderAccess shared] rootURLForSourceId:sourceId];
  }
  if (!rootURL) {
    reject(@"E_NOT_FOUND", @"no root url", nil);
    return;
  }
  [self.scanner scanSourceId:sourceId rootURL:rootURL recursive:recursive];
  resolve(@(YES));
}

RCT_EXPORT_METHOD(cancelScan:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self.scanner cancel];
  resolve(@(YES));
}

#pragma mark - Scanner delegate

- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId
          phase:(NSString *)phase scanned:(NSInteger)scanned total:(NSInteger)total imported:(NSInteger)imported
{
  // 300ms 节流（§5.3）。回调来自扫描线程：节流戳与事件发送统一
  // 转主队列，消除跨线程读写竞态（低危项修复）
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDate *now = [NSDate date];
    if (self.lastProgressEmit && [now timeIntervalSinceDate:self.lastProgressEmit] < 0.3) return;
    self.lastProgressEmit = now;
    if (!self->_hasListeners) return;
    [self sendEventWithName:kScanProgressEvent body:@{
      @"sourceId": sourceId,
      @"phase": phase ?: @"enumerate",
      @"scanned": @(scanned),
      @"total": @(total),
      @"imported": @(imported),
    }];
  });
}

- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId
  finishedWithRows:(NSArray<NSDictionary *> *)rows report:(NSDictionary *)report
{
  // 完成回调来自扫描线程：落库可在 io 队列（线程安全），但事件与
  // 节流戳必须回主队列；入库先行，事件在其后发出
  dispatch_async(dispatch_get_main_queue(), ^{
    self.lastProgressEmit = nil;
    [self _finishScanOnMain:sourceId rows:rows report:report];
  });
}

- (void)_finishScanOnMain:(NSString *)sourceId rows:(NSArray<NSDictionary *> *)rows report:(NSDictionary *)report
{
  // 入库（F3 修复）：补定位符后分批 upsert（每批 ≤500，§5.1），
  // 正常完成的扫描才做 finishSync 清理；取消的扫描不清理（§5.3）
  BOOL cancelled = LxBool(report[@"cancelled"]);
  NSInteger imported = 0;
  if (rows.count) {
    NSMutableArray *batch = [NSMutableArray array];
    for (NSDictionary *row in rows) {
      NSString *itemKey = LxStr(row[@"item_key"]);
      if (!itemKey.length) continue;
      NSMutableDictionary *full = [row mutableCopy];
      full[@"locator"] = [self locatorForSourceId:sourceId itemKey:itemKey];
      [batch addObject:full];
      if (batch.count >= 500) {
        if ([[LxLibraryStore shared] upsertTracks:sourceId rows:batch]) imported += batch.count;
        [batch removeAllObjects];
      }
    }
    if (batch.count) {
      if ([[LxLibraryStore shared] upsertTracks:sourceId rows:batch]) imported += batch.count;
    }
  }
  if (!cancelled) {
    [[LxLibraryStore shared] finishSync:sourceId];
  }
  // 扫描状态落库（低危修复）：last_scan_at / 报告摘要 / state
  long long now = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
  NSMutableDictionary *summary = [report mutableCopy] ?: [NSMutableDictionary dictionary];
  summary[@"imported"] = @(imported);
  NSData *reportData = [NSJSONSerialization dataWithJSONObject:summary options:0 error:nil];
  NSString *reportJSON = reportData ? [[NSString alloc] initWithData:reportData encoding:NSUTF8StringEncoding] : nil;
  [[LxLibraryStore shared] updateScanState:sourceId lastScanAt:now report:reportJSON];
  if (_hasListeners) {
    [self sendEventWithName:kScanDoneEvent body:@{ @"sourceId": sourceId, @"report": summary }];
  }
}

// 定位符构造（§4）：lxlib://<sourceId>/<itemKey>，逐段百分号编码，
// 与 JS 侧 `encodeURIComponent` 的保留集对齐
- (NSString *)locatorForSourceId:(NSString *)sourceId itemKey:(NSString *)itemKey
{
  NSMutableCharacterSet *allowed = [NSMutableCharacterSet alphanumericCharacterSet];
  [allowed addCharactersInString:@"-._~"];
  NSMutableArray *encoded = [NSMutableArray array];
  for (NSString *seg in [itemKey componentsSeparatedByString:@"/"]) {
    NSString *enc = [seg stringByAddingPercentEncodingWithAllowedCharacters:allowed];
    [encoded addObject:enc ?: @""];
  }
  return [NSString stringWithFormat:@"lxlib://%@/%@", sourceId, [encoded componentsJoinedByString:@"/"]];
}

#pragma mark - 查询与写入（转发 Store）

RCT_EXPORT_METHOD(query:(NSDictionary *)spec
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([[LxLibraryStore shared] query:spec]);
}

RCT_EXPORT_METHOD(upsertTracks:(NSString *)sourceId rows:(NSArray *)rows
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] upsertTracks:sourceId rows:rows];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(finishSync:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSInteger removed = [[LxLibraryStore shared] finishSync:sourceId];
  resolve(@(removed));
}

// 全量 itemKey（自动关联差量对账用，避免 query limit 截断，S3）
RCT_EXPORT_METHOD(listItemKeysForSourceId:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([[LxLibraryStore shared] listItemKeysForSourceId:sourceId]);
}

RCT_EXPORT_METHOD(getTrack:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *track = [[LxLibraryStore shared] getTrack:locator];
  resolve(track ?: [NSNull null]);
}

RCT_EXPORT_METHOD(deleteTrack:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] deleteTrack:locator];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(setOffline:(NSString *)locator relPath:(NSString *)relPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] setOffline:locator relPath:(relPath == (NSString *)[NSNull null] ? nil : relPath)];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(bumpPlay:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] bumpPlay:locator];
  resolve(@(ok));
}

#pragma mark - 播放 / 封面 / 歌词解析（§8）

RCT_EXPORT_METHOD(resolvePlayFileUrl:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *track = [[LxLibraryStore shared] getTrack:locator];
  if (!track) { resolve(@""); return; }
  NSString *sourceId = track[@"sourceId"];
  NSString *itemKey = track[@"itemKey"];
  NSString *sourceType = track[@"sourceType"];

  // 远程来源（P2 串流）：P1 只处理本地；离线文件优先
  NSString *offlinePath = track[@"offlinePath"];
  if ([offlinePath isKindOfClass:[NSString class]] && offlinePath.length) {
    NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    NSString *absPath = [documents stringByAppendingPathComponent:offlinePath];
    if ([NSFileManager.defaultManager fileExistsAtPath:absPath]) {
      resolve([NSString stringWithFormat:@"file://%@", absPath]);
      return;
    }
  }

  if (![sourceType isEqualToString:@"local"] && ![sourceType isEqualToString:@"download"]) {
    // 远程且无离线：P1 返回空串，由 JS 回落（串流在 P2）
    resolve(@"");
    return;
  }

  // 本地 / 下载来源：acquire 授权并解析路径
  NSError *error = nil;
  if (![[LxFolderAccess shared] acquire:sourceId error:&error]) {
    resolve(@"");
    return;
  }
  NSURL *fileURL = [[LxFolderAccess shared] resolveSourceId:sourceId relativePath:itemKey];
  if (!fileURL || ![NSFileManager.defaultManager fileExistsAtPath:fileURL.path]) {
    resolve(@"");
    return;
  }
  resolve([NSString stringWithFormat:@"file://%@", fileURL.path]);
}

RCT_EXPORT_METHOD(artworkPath:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *track = [[LxLibraryStore shared] getTrack:locator];
  NSString *cachedName = track[@"artwork"];
  if (![cachedName isKindOfClass:[NSString class]] || !cachedName.length) { resolve(@""); return; }
  NSString *path = [[LxArtworkCache shared] pathForCachedName:cachedName];
  resolve(path ?: @"");
}

RCT_EXPORT_METHOD(readLyric:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *track = [[LxLibraryStore shared] getTrack:locator];
  if (!track) { resolve([NSNull null]); return; }
  NSString *sourceId = track[@"sourceId"];
  NSString *itemKey = track[@"itemKey"];

  NSError *error = nil;
  if (![[LxFolderAccess shared] acquire:sourceId error:&error]) { resolve([NSNull null]); return; }
  NSURL *fileURL = [[LxFolderAccess shared] resolveSourceId:sourceId relativePath:itemKey];
  if (!fileURL) { resolve([NSNull null]); return; }

  // 优先内嵌歌词
  NSString *lyric = [[LxMediaProbe shared] readEmbeddedLyric:fileURL];
  if (lyric.length) {
    resolve(@{ @"lyric": lyric, @"source": @"embedded" });
    return;
  }
  // 其次同名 .lrc（§5.6）
  NSString *lrcPath = [fileURL.path.stringByDeletingPathExtension stringByAppendingPathExtension:@"lrc"];
  if ([NSFileManager.defaultManager fileExistsAtPath:lrcPath]) {
    NSData *data = [NSData dataWithContentsOfFile:lrcPath];
    if (data.length <= 512 * 1024) {
      NSString *text = [self decodeLrcData:data];
      if (text.length) {
        resolve(@{ @"lyric": text, @"source": @"sidecar" });
        return;
      }
    }
  }
  resolve([NSNull null]);
}

// 编码探测：BOM → UTF-8 → GB18030 → Big5（§5.6）
- (NSString *)decodeLrcData:(NSData *)data
{
  if (!data.length) return nil;
  const uint8_t *bytes = data.bytes;
  // BOM 探测
  if (data.length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) {
    return [[NSString alloc] initWithData:[data subdataWithRange:NSMakeRange(3, data.length - 3)] encoding:NSUTF8StringEncoding];
  }
  if (data.length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
    return [[NSString alloc] initWithData:[data subdataWithRange:NSMakeRange(2, data.length - 2)] encoding:NSUTF16LittleEndianStringEncoding];
  }
  if (data.length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) {
    return [[NSString alloc] initWithData:[data subdataWithRange:NSMakeRange(2, data.length - 2)] encoding:NSUTF16BigEndianStringEncoding];
  }
  // 严格 UTF-8
  NSString *utf8 = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (utf8) return utf8;
  // GB18030
  NSStringEncoding gb18030 = CFStringConvertEncodingToNSStringEncoding(kCFStringEncodingGB_18030_2000);
  NSString *gb = [[NSString alloc] initWithData:data encoding:gb18030];
  if (gb) return gb;
  // Big5
  NSStringEncoding big5 = CFStringConvertEncodingToNSStringEncoding(kCFStringEncodingBig5);
  return [[NSString alloc] initWithData:data encoding:big5];
}

#pragma mark - Keychain（P2 使用，P1 先落接口，§5.7）

RCT_EXPORT_METHOD(setSecret:(NSString *)sourceId secret:(NSString *)secret
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxCredentialStore shared] setSecret:secret forSourceId:sourceId];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(getSecret:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *secret = [[LxCredentialStore shared] getSecretForSourceId:sourceId];
  resolve(secret ?: [NSNull null]);
}

RCT_EXPORT_METHOD(deleteSecret:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxCredentialStore shared] deleteSecretForSourceId:sourceId];
  resolve(@(ok));
}

@end
