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

// 文件夹选择器呈现管线预算（对齐 UtilsModule 的竞态安全口径）：
// 等视图层级稳定后呈现，呈现被并发退场吞掉则重试；预算耗尽
// resolve null，绝不把 Promise 挂死（真机反馈：⋮ 菜单 Modal 关闭
// 动画中 present 被 UIKit 静默吞掉，delegate 永不回调）
static const NSTimeInterval kLxPickWaitInterval = 0.15;
static const NSTimeInterval kLxPickPresentBudget = 3.0;

@interface LxLibraryModule () <UIDocumentPickerDelegate, LxFolderScannerDelegate>
@property (nonatomic, strong) LxFolderScanner *scanner;
@property (nonatomic, strong) UIDocumentPickerViewController *folderPicker;
@property (nonatomic, strong) UIDocumentPickerViewController *pendingPicker;
@property (nonatomic, copy) RCTPromiseResolveBlock pendingPickResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pendingPickReject;
@property (nonatomic, copy) NSString *pendingRelinkSourceId;
@property (nonatomic, copy) RCTPromiseResolveBlock pendingRelinkResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pendingRelinkReject;
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

// 单字段更新：整行 saveSource 会用旧快照覆盖扫描状态（重命名无效根因）
RCT_EXPORT_METHOD(renameSource:(NSString *)sourceId name:(NSString *)name
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] renameSource:LxStr(sourceId) name:LxStr(name)];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(setSourceEnabled:(NSString *)sourceId enabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] setSourceEnabled:LxStr(sourceId) enabled:enabled];
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
    // 同一时刻只允许一个选择器：上一个挂起中的选择按取消处理
    [self cancelPendingPickerPicks];
    // 上一拍选择器仍存活时先清场，避免新选择器叠在旧选择器上
    //（旧选择器会成为无人消费的孤儿）。退场中的层级由呈现管线的
    // 重试循环自然等待稳定
    UIViewController *prev = self.folderPicker;
    if (prev.presentingViewController != nil && !prev.isBeingDismissed) {
      self.folderPicker = nil;
      self.pendingPicker = nil;
      [prev dismissViewControllerAnimated:NO completion:nil];
    }
    self.pendingPickResolve = resolve;
    self.pendingPickReject = reject;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kLxPickPresentBudget];
    [self presentFolderPickerWithDeadline:deadline];
  });
}

// 竞态安全呈现：调用点多在 ⋮ 菜单等 RN Modal 的 onPress 回调内，此时
// 菜单 Modal 正在退场动画中。旧实现直接取 presentedViewController 链
// 尾并 present，UIKit 会静默拒绝（isBeingDismissed 的 VC 不能再
// present），delegate 回调永不到来，JS Promise 挂死（真机反馈：
// 添加文件夹点击无反应）。这里等层级稳定后再呈现，被吞掉则重试；
// 预算耗尽 resolve null 让 JS 侧提示失败
- (void)presentFolderPickerWithDeadline:(NSDate *)deadline
{
  UIViewController *top = [self lx_stableTopViewController];
  if (!top) {
    if ([deadline timeIntervalSinceNow] <= 0) {
      [self failPendingPickerPicks];
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLxPickWaitInterval * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self presentFolderPickerWithDeadline:deadline];
    });
    return;
  }
  // 部署目标 13.4：沿用 UtilsModule 的 documentTypes 惯例（iOS 14 起
  // 标记废弃但仍可用），避免 UTType 在低部署目标下的可见性问题
  UIDocumentPickerViewController *picker =
      [[UIDocumentPickerViewController alloc] initWithDocumentTypes:@[@"public.folder"] inMode:UIDocumentPickerModeOpen];
  picker.delegate = self;
  picker.allowsMultipleSelection = NO;
  self.folderPicker = picker;
  self.pendingPicker = picker;
  __weak typeof(self) weakSelf = self;
  __block BOOL completionFired = NO;
  [top presentViewController:picker animated:YES completion:^{
    completionFired = YES;
    // completion 不等于存活：被并发退场吞掉时 completion 照样回调，
    // VC 随后被收走。延迟校验存活，不存活则重试
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      __strong typeof(weakSelf) self = weakSelf;
      if (!self || self.pendingPicker != picker) return;
      BOOL alive = picker.presentingViewController != nil && picker.view.window != nil;
      self.pendingPicker = nil;
      if (alive) return;
      // 不存活：只重试，不强拆
      self.folderPicker = nil;
      if ([deadline timeIntervalSinceNow] <= 0) {
        [self failPendingPickerPicks];
        return;
      }
      [self presentFolderPickerWithDeadline:deadline];
    });
  }];
  // completion 看门狗：目标 VC 不在窗口层级时 UIKit 根本不回调
  // completion，没有看门狗重试链会停在这里，成为另一处静默挂起。
  // 只处理 completion 从未回调的情形：completion 已回调（选择器正常
  // 呈现）时绝不强拆——真机实证（审核反馈）：完成回调晚于 0.8s 到达
  // 时，旧代码会把呈现中的选择器强制关掉再重弹，反复拆
  // DocumentProvider 远程选择器触发崩溃（UtilsModule 注释记载过
  // 同类 DOCWeakProxy 问题）
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.8 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    __strong typeof(weakSelf) self = weakSelf;
    if (!self || completionFired || self.pendingPicker != picker) return;
    if (picker.presentingViewController != nil) [picker dismissViewControllerAnimated:NO completion:nil];
    self.pendingPicker = nil;
    self.folderPicker = nil;
    if ([deadline timeIntervalSinceNow] <= 0) {
      [self failPendingPickerPicks];
      return;
    }
    [self presentFolderPickerWithDeadline:deadline];
  });
}

// 稳定顶层 VC：presentedViewController 链上任一节点处于转场中
//（呈现 / 退场动画未结束）即返回 nil，由调用方重试。口径与
// UtilsModule.lx_stableTopViewController 一致
- (UIViewController *)lx_stableTopViewController
{
  UIWindow *window = nil;
  for (UIWindow *w in [UIApplication sharedApplication].windows) {
    if (w.isKeyWindow) { window = w; break; }
  }
  if (!window) window = [UIApplication sharedApplication].delegate.window;
  UIViewController *vc = window.rootViewController;
  while (vc) {
    if (vc.isBeingPresented || vc.isBeingDismissed || vc.isMovingFromParentViewController || vc.isMovingToParentViewController) return nil;
    if (!vc.presentedViewController) return vc;
    vc = vc.presentedViewController;
  }
  return nil;
}

// 选中 URL → config 片段：沙箱内返回 @{@"relPath": …}，外部返回
// @{@"bookmark": base64}；bookmark 生成失败返回 nil。两条路径
//（pickFolder / relink）共用，保证口径一致
- (NSDictionary * _Nullable)configFragmentForPickedURL:(NSURL *)url
{
  // 判断是否在本 App Documents 内（沙箱分支，§5.2）。
  // 选择器返回的路径可能带 /private 前缀（符号链接形式），而
  // NSSearchPath 返回 /var 形式：两边都先解析符号链接再比前缀，
  // 否则容器内文件夹会被误判为外部文件夹走 bookmark 分支
  NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *documentsResolved = [[NSURL fileURLWithPath:documents] URLByResolvingSymlinksInPath].path;
  NSString *pathResolved = [url URLByResolvingSymlinksInPath].path ?: url.path;
  NSString *documentsPrefix = [documentsResolved stringByAppendingString:@"/"];
  BOOL inSandbox = [pathResolved isEqualToString:documentsResolved] || [pathResolved hasPrefix:documentsPrefix];
  if (inSandbox) {
    NSString *rel = [pathResolved isEqualToString:documentsResolved] ? @"" : [pathResolved substringFromIndex:documentsPrefix.length];
    return @{ @"relPath": rel };
  }
  BOOL started = [url startAccessingSecurityScopedResource];
  NSError *bmError = nil;
  NSData *bookmark = [url bookmarkDataWithOptions:0 includingResourceValuesForKeys:nil relativeToURL:nil error:&bmError];
  if (started) [url stopAccessingSecurityScopedResource];
  if (!bookmark) return nil;
  return @{ @"bookmark": [bookmark base64EncodedStringWithOptions:0] };
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  NSURL *url = urls.firstObject;
  if (!url) { [self cancelPendingPickerPicks]; return; }

  NSDictionary *fragment = [self configFragmentForPickedURL:url];
  NSString *label = url.lastPathComponent ?: @"";
  NSString *pickedResolvedPath = [url URLByResolvingSymlinksInPath].path ?: url.path;

  // relink：只替换授权，不改变定位符（§5.2）。成功 / 失败回 bool，
  // 取消在 cancelPendingPickerPicks 里回 NSNull
  NSString *relinkSourceId = self.pendingRelinkSourceId;
  if (relinkSourceId.length) {
    RCTPromiseResolveBlock resolve = self.pendingRelinkResolve;
    RCTPromiseRejectBlock reject = self.pendingRelinkReject;
    [self clearPendingPickerState];
    if (!fragment) { if (resolve) resolve(@(NO)); return; }
    // 校验选中的目录与原授权是同一目录（审核第 15 条）：选错目录
    // 会在下次扫描时清空原曲目并重建，歌单引用全部断开。
    // 原路径无法解析（来源已坏）时放行，允许换目录救回
    NSString *oldPath = [self rootPathForSourceIdNoAccess:relinkSourceId];
    if (oldPath.length && ![oldPath isEqualToString:pickedResolvedPath]) {
      if (reject) reject(@"E_WRONG_DIR", @"selected folder differs from the original", nil);
      return;
    }
    NSDictionary *meta = [[LxLibraryStore shared] configForSourceId:relinkSourceId];
    NSString *oldConfigJSON = LxStr(meta[@"config"]);
    NSMutableDictionary *config = [NSMutableDictionary dictionary];
    if (oldConfigJSON.length) {
      id parsed = [NSJSONSerialization JSONObjectWithData:[oldConfigJSON dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:nil];
      if ([parsed isKindOfClass:[NSDictionary class]]) config = [parsed mutableCopy];
    }
    // 新授权覆盖旧授权：沙箱分支清掉失效 bookmark，外部分支清掉旧
    // relPath，避免两种授权并存
    [config removeObjectForKey:@"bookmark"];
    [config removeObjectForKey:@"relPath"];
    [config addEntriesFromDictionary:fragment];
    NSData *data = [NSJSONSerialization dataWithJSONObject:config options:0 error:nil];
    NSString *newConfigJSON = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
    BOOL ok = newConfigJSON.length && [[LxLibraryStore shared] setSourceConfig:relinkSourceId config:newConfigJSON state:@"ok"];
    if (ok) {
      [[LxFolderAccess shared] saveGrantForSourceId:relinkSourceId config:config];
    }
    if (resolve) resolve(@(ok));
    return;
  }

  // pickFolder：回传来源创建素材。resolvedPath 供 JS 侧去重比对
  //（审核第 14 条：同一目录此前可重复添加）
  RCTPromiseResolveBlock resolve = self.pendingPickResolve;
  [self clearPendingPickerState];
  if (!fragment || !resolve) return;
  NSMutableDictionary *result = [fragment mutableCopy];
  result[@"label"] = label;
  result[@"resolvedPath"] = pickedResolvedPath;
  resolve(result);
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  [self cancelPendingPickerPicks];
}

// 清理选择器挂起态（不 resolve）
- (void)clearPendingPickerState
{
  self.pendingPickResolve = nil;
  self.pendingPickReject = nil;
  self.pendingRelinkResolve = nil;
  self.pendingRelinkReject = nil;
  self.pendingRelinkSourceId = nil;
}

// 用户取消：选择按取消处理（pick → null，relink → null），
// 与失败区分开
- (void)cancelPendingPickerPicks
{
  if (self.pendingPickResolve) self.pendingPickResolve([NSNull null]);
  if (self.pendingRelinkResolve) self.pendingRelinkResolve([NSNull null]);
  [self clearPendingPickerState];
}

// 呈现预算耗尽等系统级失败：不算用户取消。pick 走 reject，
// JS 侧据此提示「添加文件夹失败」（与用户取消的静默区分开，
// 否则超时后点击仍然像没反应）；relink 回 NO
- (void)failPendingPickerPicks
{
  if (self.pendingPickReject) self.pendingPickReject(@"E_PICKER_PRESENT_FAILED", @"folder picker could not be presented within budget", nil);
  if (self.pendingRelinkResolve) self.pendingRelinkResolve(@(NO));
  [self clearPendingPickerState];
}

RCT_EXPORT_METHOD(relink:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // relink 复用文件夹选择器：用户重新选中目录后只替换授权
  //（bookmark / relPath），定位符不变（§5.2）。此前是空桩，
  // 授权失效后点「重新授权」什么都不发生（真机反馈第 4 条的配套缺口）
  NSString *sid = LxStr(sourceId);
  if (!sid.length || ![[LxLibraryStore shared] configForSourceId:sid]) {
    resolve(@(NO));
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self cancelPendingPickerPicks];
    self.pendingRelinkSourceId = sid;
    self.pendingRelinkResolve = resolve;
    self.pendingRelinkReject = reject;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kLxPickPresentBudget];
    [self presentFolderPickerWithDeadline:deadline];
  });
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
  // H2 兜底：「下载」虚拟来源的根是 Documents 且曲目由对账维护，
  // 扫描会误删曲目行并吞并 Documents 根下的音频，原生侧直接拒绝
  NSDictionary *meta = [[LxLibraryStore shared] configForSourceId:LxStr(sourceId)];
  if ([LxStr(meta[@"type"]) isEqualToString:@"download"]) {
    reject(@"E_INVALID_ARGS", @"download source cannot be scanned", nil);
    return;
  }
  BOOL recursive = LxBool(options[@"recursive"]);
  NSURL *rootURL = [[LxFolderAccess shared] rootURLForSourceId:sourceId];
  if (!rootURL) {
    // 先 acquire
    NSError *error = nil;
    if (![[LxFolderAccess shared] acquire:sourceId error:&error]) {
      // 授权失效落到来源状态（审核第 11 条：此前 state 永远是 ok）
      [[LxLibraryStore shared] setSourceState:LxStr(sourceId) state:@"needs_reauth"];
      reject(@"E_REAUTH", error.localizedDescription ?: @"acquire failed", error);
      return;
    }
    rootURL = [[LxFolderAccess shared] rootURLForSourceId:sourceId];
  }
  if (!rootURL) {
    reject(@"E_NOT_FOUND", @"no root url", nil);
    return;
  }
  // 忙时显式拒绝，不让 JS 白等完成事件
  if (![self.scanner scanSourceId:sourceId rootURL:rootURL recursive:recursive]) {
    reject(@"E_SCAN_BUSY", @"scanner is busy", nil);
    return;
  }
  resolve(@(YES));
}

RCT_EXPORT_METHOD(cancelScan:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // 校验当前扫描来源：此前忽略 sourceId，超时兜底取消可能误杀
  // 另一个来源的扫描（低危项）
  if (!LxStr(sourceId).length || !self.scanner.scanning || ![LxStr(sourceId) isEqualToString:self.scanner.currentSourceId]) {
    resolve(@(NO));
    return;
  }
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
  // 完成回调来自扫描线程。入库与落库在后台执行（不依赖主队列），
  // 只有事件发送回主队列。此前整体 dispatch 到主队列，无头模拟器
  // 上主队列消费不及时导致入库延迟、冒烟轮询超时
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    [self _finishScanWork:sourceId rows:rows report:report];
  });
}

- (void)_finishScanWork:(NSString *)sourceId rows:(NSArray<NSDictionary *> *)rows report:(NSDictionary *)report
{
  // 入库（F3 修复）：补定位符后分批 upsert（每批 ≤500，§5.1），
  // 正常完成的扫描才做 finishSync 清理；取消的扫描不清理（§5.3）。
  // 计数精确化（审核第 5 条）：imported 只数新行，重写行进 updated
  BOOL cancelled = LxBool(report[@"cancelled"]);
  NSInteger scanned = LxNum(report[@"scanned"]) ? [LxNum(report[@"scanned"]) integerValue] : 0;
  NSArray<NSString *> *existingKeys = [[LxLibraryStore shared] listItemKeysForSourceId:sourceId];
  NSMutableSet<NSString *> *existingKeySet = [NSMutableSet setWithArray:existingKeys];
  // 排除表在计数前剔除（真机反馈：移除后扫描报「新增 1」）。
  // 此前 Store 的 upsert 跳过排除行，但模块层计数已完成，
  // 行没入库报告却记了导入
  NSArray<NSString *> *excludedKeys = [[LxLibraryStore shared] listExcludedItemKeysForSourceId:sourceId];
  NSSet<NSString *> *excludedSet = [NSSet setWithArray:excludedKeys];
  NSInteger imported = 0;
  NSInteger updated = 0;
  if (rows.count) {
    NSMutableArray *batch = [NSMutableArray array];
    for (NSDictionary *row in rows) {
      NSString *itemKey = LxStr(row[@"item_key"]);
      if (!itemKey.length) continue;
      if ([excludedSet containsObject:itemKey]) continue;
      NSMutableDictionary *full = [row mutableCopy];
      full[@"locator"] = [self locatorForSourceId:sourceId itemKey:itemKey];
      [batch addObject:full];
      if (batch.count >= 500) {
        [self _upsertBatch:batch sourceId:sourceId existingKeySet:existingKeySet imported:&imported updated:&updated];
        [batch removeAllObjects];
      }
    }
    if (batch.count) {
      [self _upsertBatch:batch sourceId:sourceId existingKeySet:existingKeySet imported:&imported updated:&updated];
    }
  }
  // 删除保护（审核第 1 条）：
  // 1) 枚举为空但库里有曲目——外部盘拔出 / iCloud 或 File Provider
  //    离线 / 授权失效的典型特征，跳过清理，不让一次失败扫描清空来源
  // 2) 不可读子目录前缀下的行豁免清理（此前注释有、代码没有）
  NSInteger removed = 0;
  if (!cancelled) {
    id unreadableDirsObj = report[@"unreadableDirs"];
  NSArray *unreadable = [unreadableDirsObj isKindOfClass:[NSDictionary class]] ? LxArr(unreadableDirsObj[@"items"]) : nil;
    BOOL hasExistingTracks = existingKeySet.count > 0;
    if (hasExistingTracks && (scanned == 0 || (imported == 0 && updated == 0))) {
      // 全空扫描、或扫到文件却零入库（协调枚举返回不同前缀 /
      // 全部探测失败）：一行不删，等下一次正常扫描再清理
    } else {
      removed = [[LxLibraryStore shared] finishSync:sourceId protectedPrefixes:unreadable];
    }
  }
  // 扫描状态落库：last_scan_at / 报告摘要；状态按授权可达性回写
  //（审核第 11 条：此前 state 永远停在 ok）
  long long now = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
  NSMutableDictionary *summary = [report mutableCopy] ?: [NSMutableDictionary dictionary];
  summary[@"imported"] = @(imported);
  summary[@"updated"] = @(updated);
  summary[@"removed"] = @(removed);
  NSData *reportData = [NSJSONSerialization dataWithJSONObject:summary options:0 error:nil];
  NSString *reportJSON = reportData ? [[NSString alloc] initWithData:reportData encoding:NSUTF8StringEncoding] : nil;
  [[LxLibraryStore shared] updateScanState:sourceId lastScanAt:now report:reportJSON];
  // 授权已失效但扫描仍走完（沙箱来源文件被移动等）：标需要重新授权
  NSError *acqError = nil;
  if (![[LxFolderAccess shared] acquire:sourceId error:&acqError]) {
    [[LxLibraryStore shared] setSourceState:sourceId state:@"needs_reauth"];
    [[LxFolderAccess shared] release:sourceId];
  } else {
    [[LxFolderAccess shared] release:sourceId];
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    self.lastProgressEmit = nil;
    if (self->_hasListeners) {
      [self sendEventWithName:kScanDoneEvent body:@{ @"sourceId": sourceId, @"report": summary }];
    }
  });
}

// 分批 upsert 并分流计数
- (void)_upsertBatch:(NSArray<NSDictionary *> *)batch sourceId:(NSString *)sourceId
      existingKeySet:(NSMutableSet<NSString *> *)keySet
            imported:(NSInteger *)imported updated:(NSInteger *)updated
{
  NSInteger batchNew = 0;
  NSInteger batchSkipped = 0;
  for (NSDictionary *row in batch) {
    NSString *itemKey = LxStr(row[@"item_key"]);
    if (!itemKey.length) continue;
    if ([keySet containsObject:itemKey]) {
      // 超时降级行：Store 只对已存在的行打 seen、不实际更新，
      // 不计入 updated（审核结论补充项）
      if (LxBool(row[@"timeout"])) batchSkipped++;
      continue;
    }
    batchNew++;
  }
  if ([[LxLibraryStore shared] upsertTracks:sourceId rows:batch]) {
    *imported += batchNew;
    *updated += (NSInteger)batch.count - batchNew - batchSkipped;
    for (NSDictionary *row in batch) {
      NSString *itemKey = LxStr(row[@"item_key"]);
      if (itemKey.length) [keySet addObject:itemKey];
    }
  }
}

// relink 校验用：从存储的 config 还原来源根目录路径，不实际获取授权。
// 沙箱来源 = Documents/relPath；bookmark 来源解析 bookmark 取路径。
// 失败返回 nil（放行换目录）
- (NSString *)rootPathForSourceIdNoAccess:(NSString *)sourceId
{
  NSDictionary *meta = [[LxLibraryStore shared] configForSourceId:sourceId];
  NSString *configJSON = LxStr(meta[@"config"]);
  if (!configJSON.length) return nil;
  NSDictionary *config = [NSJSONSerialization JSONObjectWithData:[configJSON dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![config isKindOfClass:[NSDictionary class]]) return nil;
  NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *documentsResolved = [[NSURL fileURLWithPath:documents] URLByResolvingSymlinksInPath].path;
  NSString *relPath = LxStr(config[@"relPath"]);
  BOOL hasRelPath = [config[@"relPath"] isKindOfClass:[NSString class]];
  if (hasRelPath) {
    return relPath.length
      ? [[documentsResolved stringByAppendingPathComponent:relPath] stringByStandardizingPath]
      : documentsResolved;
  }
  NSString *bookmarkBase64 = LxStr(config[@"bookmark"]);
  if (!bookmarkBase64.length) return nil;
  NSData *bookmark = [[NSData alloc] initWithBase64EncodedString:bookmarkBase64 options:0];
  BOOL isStale = NO;
  NSURL *url = [NSURL URLByResolvingBookmarkData:bookmark
                                         options:NSURLBookmarkResolutionWithoutImplicitStartAccessing | NSURLBookmarkResolutionWithoutUI
                                   relativeToURL:nil
                             bookmarkDataIsStale:&isStale
                                           error:nil];
  return url ? ([url URLByResolvingSymlinksInPath].path ?: url.path) : nil;
}

// 定位符解析（与 JS 侧 parseLocator 对齐）：非法输入返回 nil。
// 「从曲库移除」后曲目行已删，播放 / 歌词解析靠它还原来源与路径
- (NSDictionary *)parseLocator:(NSString *)locator
{
  NSString *prefix = @"lxlib://";
  if (![LxStr(locator) hasPrefix:prefix]) return nil;
  NSString *body = [locator substringFromIndex:prefix.length];
  NSRange slash = [body rangeOfString:@"/"];
  if (slash.location == NSNotFound) return nil;
  NSString *sourceId = [body substringToIndex:slash.location];
  NSString *encodedKey = [body substringFromIndex:slash.location + 1];
  if (sourceId.length != 32 || !encodedKey.length) return nil;
  NSCharacterSet *hexSet = [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"];
  if ([[sourceId stringByTrimmingCharactersInSet:hexSet] length] > 0) return nil;
  NSMutableArray<NSString *> *decoded = [NSMutableArray array];
  for (NSString *seg in [encodedKey componentsSeparatedByString:@"/"]) {
    if (!seg.length) return nil;
    NSString *val = [seg stringByRemovingPercentEncoding];
    if (!val.length) return nil;
    for (NSString *sub in [val componentsSeparatedByString:@"/"]) {
      if (!sub.length || [sub isEqualToString:@"."] || [sub isEqualToString:@".."]) return nil;
    }
    [decoded addObject:val];
  }
  return @{ @"sourceId": sourceId, @"itemKey": [decoded componentsJoinedByString:@"/"] };
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

#pragma mark - 下载来源元数据补全（审核第 16 条）

// 关联入库时行里只有歌名降级值（duration 0、无封面）。下载文件在
// Documents 沙箱内，这里读真实元数据后重写行（§11.5）
RCT_EXPORT_METHOD(enrichDownloadTracks:(NSArray *)itemKeys
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSArray *keys = LxArr(itemKeys);
  if (!keys.count) { resolve(@0); return; }
  NSString *sourceId = @"d0000000000000000000000000000001";
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSURL *docs = [[NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask] firstObject];
    NSString *rootPath = docs.standardizedURL.path;
    NSMutableArray *rows = [NSMutableArray array];
    for (NSString *key in keys) {
      NSString *itemKey = LxStr(key);
      if (!itemKey.length) continue;
      NSURL *fileURL = [docs URLByAppendingPathComponent:itemKey];
      if (![NSFileManager.defaultManager fileExistsAtPath:fileURL.path]) continue;
      NSDictionary *probe = [[LxMediaProbe shared] probeFile:fileURL];
      if (!probe.count) continue;
      NSDictionary *row = [self.scanner rowFromProbe:probe fileURL:fileURL rootPath:rootPath sourceId:sourceId];
      if (row) [rows addObject:row];
    }
    NSInteger enriched = 0;
    for (NSUInteger i = 0; i < rows.count; i += 200) {
      NSArray *batch = [rows subarrayWithRange:NSMakeRange(i, MIN(200, rows.count - i))];
      NSMutableArray *full = [NSMutableArray array];
      for (NSDictionary *row in batch) {
        NSString *itemKey = LxStr(row[@"item_key"]);
        if (!itemKey.length) continue;
        NSMutableDictionary *m = [row mutableCopy];
        m[@"locator"] = [self locatorForSourceId:sourceId itemKey:itemKey];
        [full addObject:m];
      }
      if (full.count && [[LxLibraryStore shared] upsertTracks:sourceId rows:full]) enriched += full.count;
    }
    resolve(@(enriched));
  });
}

// relink 去重 / 添加文件夹去重（审核第 14 条）：来源根目录路径，
// 不获取授权；取不到回 NSNull
RCT_EXPORT_METHOD(rootPathForSourceId:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *path = [self rootPathForSourceIdNoAccess:LxStr(sourceId)];
  resolve(path ?: [NSNull null]);
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

#pragma mark - 排除表（§16）

RCT_EXPORT_METHOD(excludeTrack:(NSString *)sourceId itemKey:(NSString *)itemKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] excludeTrack:LxStr(sourceId) itemKey:LxStr(itemKey)];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(restoreExcluded:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL ok = [[LxLibraryStore shared] restoreExcluded:LxStr(sourceId)];
  resolve(@(ok));
}

RCT_EXPORT_METHOD(listExcludedItemKeysForSourceId:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([[LxLibraryStore shared] listExcludedItemKeysForSourceId:LxStr(sourceId)]);
}

RCT_EXPORT_METHOD(isExcluded:(NSString *)sourceId itemKey:(NSString *)itemKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@([[LxLibraryStore shared] isExcluded:LxStr(sourceId) itemKey:LxStr(itemKey)]));
}

#pragma mark - 文件删除（§16 分级）

// 只删沙箱内来源（含「下载」虚拟来源，根目录即 Documents）的音频与
// 同名 .lrc；外部 bookmark 来源拒绝。路径经 resolve 的越界校验
// （§16 定位符前缀比较）
RCT_EXPORT_METHOD(deleteSourceFile:(NSString *)locator
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *loc = LxStr(locator);
  NSDictionary *track = [[LxLibraryStore shared] getTrack:loc];
  if (!track) { reject(@"E_NOT_FOUND", @"track not found", nil); return; }
  NSString *sourceId = LxStr(track[@"sourceId"]);
  NSString *itemKey = LxStr(track[@"itemKey"]);
  NSString *sourceType = LxStr(track[@"sourceType"]);

  // 先 acquire 再判沙箱（审核第 3 条）：冷启动后授权表为空，
  // isSandboxSource 直接返回 NO，沙箱来源的删除会误报只读
  NSError *error = nil;
  if (![[LxFolderAccess shared] acquire:sourceId error:&error]) {
    reject(@"E_REAUTH", error.localizedDescription ?: @"acquire failed", error);
    return;
  }
  if (![[LxFolderAccess shared] isSandboxSource:sourceId]) {
    [[LxFolderAccess shared] release:sourceId];
    reject(@"E_READONLY", @"external folders are read-only", nil);
    return;
  }
  NSURL *fileURL = [[LxFolderAccess shared] resolveSourceId:sourceId relativePath:itemKey];
  if (!fileURL) {
    [[LxFolderAccess shared] release:sourceId];
    reject(@"E_NOT_FOUND", @"path escape or missing", nil);
    return;
  }

  NSFileManager *fm = NSFileManager.defaultManager;
  BOOL removedAudio = NO;
  if ([fm fileExistsAtPath:fileURL.path]) {
    removedAudio = [fm removeItemAtPath:fileURL.path error:nil];
  }
  // sidecar .lrc 一并删除（§16）：按常见大小写逐个探测
  NSString *base = fileURL.path.stringByDeletingPathExtension;
  NSString *lrcPath = nil;
  for (NSString *ext in @[@"lrc", @"LRC", @"Lrc"]) {
    NSString *candidatePath = [base stringByAppendingPathExtension:ext];
    if ([fm fileExistsAtPath:candidatePath]) { lrcPath = candidatePath; break; }
  }
  BOOL removedLrc = NO;
  if (lrcPath) removedLrc = [fm removeItemAtPath:lrcPath error:nil];
  // 曲目行一并移除；释放本次操作的授权引用（修复只 acquire 不 release）
  [[LxLibraryStore shared] deleteTrack:loc];
  [[LxFolderAccess shared] release:sourceId];

  resolve(@{
    @"removedAudio": @(removedAudio),
    @"removedLrc": @(removedLrc),
    @"sourceType": sourceType ?: @"",
  });
}

// 来源曲目数（来源管理列表，§14.4）
RCT_EXPORT_METHOD(countTracksForSourceId:(NSString *)sourceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@([[LxLibraryStore shared] countTracksForSourceId:LxStr(sourceId)]));
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
  NSString *sourceId = nil;
  NSString *itemKey = nil;
  NSString *sourceType = nil;
  if (track) {
    sourceId = track[@"sourceId"];
    itemKey = track[@"itemKey"];
    sourceType = track[@"sourceType"];
  } else {
    // 曲库行不存在（「从曲库移除」后行已删但文件还在，审核第 12 条）：
    // 直接从定位符结构解析来源与相对路径，文件可播就继续播，
    // 歌单引用不因移除操作失效
    NSDictionary *parsed = [self parseLocator:locator];
    if (!parsed) { resolve(@""); return; }
    sourceId = parsed[@"sourceId"];
    itemKey = parsed[@"itemKey"];
  }

  // 远程来源（P2 串流）：P1 只处理本地；离线文件优先
  NSString *offlinePath = track ? track[@"offlinePath"] : nil;
  if ([offlinePath isKindOfClass:[NSString class]] && offlinePath.length) {
    NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    NSString *absPath = [documents stringByAppendingPathComponent:offlinePath];
    if ([NSFileManager.defaultManager fileExistsAtPath:absPath]) {
      resolve(LxFileUrl(absPath));
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
  resolve(LxFileUrl(fileURL.path));
}

// 封面缓存文件名 → file:// URL（聚合行封面展示，§14.2 专辑网格）
RCT_EXPORT_METHOD(artworkUrlForName:(NSString *)cachedName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([[LxArtworkCache shared] fileUrlForCachedName:LxStr(cachedName)]);
}

// 测试钩子：删库重置（仅自测标记门控的 library_smoke 调用，
// 正式包无调用方）。模拟「存量 v1 库升级」时配合沙箱内的
// .lx-ci-lib-v1 标记：删库后下次打开先按 v1 schema 预置再迁移
RCT_EXPORT_METHOD(closeAndDropLibrary:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxLibraryStore shared] closeAndDrop];
  resolve(@(YES));
}

// 空间管理（设置分组）：封面缓存大小与清理
RCT_EXPORT_METHOD(artworkCacheSize:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@([[LxArtworkCache shared] cacheSize]));
}

RCT_EXPORT_METHOD(clearArtworkCache:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxArtworkCache shared] clearCache];
  resolve(@(YES));
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
  NSString *sourceId = nil;
  NSString *itemKey = nil;
  if (track) {
    sourceId = track[@"sourceId"];
    itemKey = track[@"itemKey"];
  } else {
    // 移除后的曲目：从定位符直接解析（同 resolvePlayFileUrl）
    NSDictionary *parsed = [self parseLocator:locator];
    if (!parsed) { resolve([NSNull null]); return; }
    sourceId = parsed[@"sourceId"];
    itemKey = parsed[@"itemKey"];
  }

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
