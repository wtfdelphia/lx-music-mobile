#import "LxLibraryModule.h"
#import "LxLibraryStore.h"
#import "LxFolderAccess.h"
#import "LxFolderScanner.h"
#import "LxMediaProbe.h"
#import "LxArtworkCache.h"
#import "LxCredentialStore.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

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
  NSString *sourceId = source[@"id"];
  BOOL ok = [[LxLibraryStore shared] saveSource:source];
  if (ok) {
    // 记录授权
    NSDictionary *config = source[@"config"];
    if ([config isKindOfClass:[NSString class]]) {
      NSData *data = [(NSString *)config dataUsingEncoding:NSUTF8StringEncoding];
      config = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    }
    if ([config isKindOfClass:[NSDictionary class]]) {
      [[LxFolderAccess shared] saveGrantForSourceId:sourceId config:config];
    }
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

    UIDocumentPickerViewController *picker;
    if (@available(iOS 14.0, *)) {
      picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[[UTType folderType]] asCopy:NO];
    } else {
      picker = [[UIDocumentPickerViewController alloc] initWithDocumentTypes:@[@"public.folder"] inMode:UIDocumentPickerModeOpen];
    }
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
  // 判断是否在本 App Documents 内（沙箱分支，§5.2）
  NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *path = url.path;
  BOOL inSandbox = [path hasPrefix:documents];
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  result[@"label"] = url.lastPathComponent ?: @"";
  if (inSandbox) {
    NSString *rel = [path substringFromIndex:documents.length];
    if ([rel hasPrefix:@"/"]) rel = [rel substringFromIndex:1];
    result[@"relPath"] = rel;
    result[@"bookmark"] = [NSNull null];
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
    result[@"relPath"] = [NSNull null];
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
  BOOL recursive = [options[@"recursive"] boolValue];
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
  // 300ms 节流（§5.3）
  NSDate *now = [NSDate date];
  if (self.lastProgressEmit && [now timeIntervalSinceDate:self.lastProgressEmit] < 0.3) return;
  self.lastProgressEmit = now;
  if (!_hasListeners) return;
  [self sendEventWithName:kScanProgressEvent body:@{
    @"sourceId": sourceId,
    @"phase": phase ?: @"enumerate",
    @"scanned": @(scanned),
    @"total": @(total),
    @"imported": @(imported),
  }];
}

- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId finishedWithReport:(NSDictionary *)report
{
  self.lastProgressEmit = nil;
  // 写回来源的 last_scan_at / report（摘要）
  NSMutableDictionary *source = [NSMutableDictionary dictionary];
  source[@"id"] = sourceId;
  source[@"lastScanAt"] = @((long long)([[NSDate date] timeIntervalSince1970] * 1000));
  NSData *reportData = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
  if (reportData) source[@"lastScanReport"] = [[NSString alloc] initWithData:reportData encoding:NSUTF8StringEncoding];
  // 注意：这里只更新扫描时间字段，完整来源行由 JS 侧 getSources 后 saveSource
  if (_hasListeners) {
    [self sendEventWithName:kScanDoneEvent body:@{ @"sourceId": sourceId, @"report": report ?: @{} }];
  }
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
