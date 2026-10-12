#import "LxFolderScanner.h"
#import "LxMediaProbe.h"

// 扫描器实现（§5.3）。元数据读取走并发 4 的队列；
// 取消在下一个文件边界生效。删除保护与增量逻辑在模块层编排，
// 本类负责遍历 + 探测 + 报告收集。

static NSSet *LxSupportedExtensions(void)
{
  static NSSet *exts = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    exts = [NSSet setWithArray:@[@"mp3", @"m4a", @"m4b", @"aac", @"alac", @"wav", @"aif", @"aiff", @"caf", @"flac"]];
  });
  return exts;
}

@implementation LxFolderScanner {
  BOOL _scanning;
  BOOL _cancelled;
}

- (BOOL)scanning { return _scanning; }

- (void)cancel { _cancelled = YES; }

- (void)scanSourceId:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive
{
  if (_scanning) return;
  _scanning = YES;
  _cancelled = NO;

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSDictionary *report = [self _scanOnBackground:sourceId rootURL:sourceURL recursive:recursive];
    _scanning = NO;
    if (self.delegate) {
      [self.delegate scanner:self sourceId:sourceId finishedWithReport:report];
    }
  });
}

- (NSDictionary *)_scanOnBackground:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive
{
  NSInteger scanned = 0;
  NSInteger imported = 0;
  NSInteger updated = 0;
  NSInteger removed = 0;
  NSMutableArray *unsupported = [NSMutableArray array];
  NSMutableArray *notDownloaded = [NSMutableArray array];
  NSMutableArray *failed = [NSMutableArray array];
  NSMutableArray *unreadableDirs = [NSMutableArray array];

  // 元数据读取并发 4（§5.3）
  dispatch_queue_t probeQueue = dispatch_queue_create("lx.library.probe", DISPATCH_QUEUE_CONCURRENT);
  dispatch_semaphore_t concurrencyLimit = dispatch_semaphore_create(4);

  NSFileManager *fm = NSFileManager.defaultManager;
  NSDirectoryEnumerator *enumerator = nil;
  BOOL usedCoordinator = NO;

  // 尝试用 NSFileCoordinator 包一次协调读取拿一致视图；失败回退普通枚举（§5.3 修正）
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  __block NSDirectoryEnumerator *coordEnumerator = nil;
  NSError *coordError = nil;
  [coordinator coordinateReadingItemAtURL:sourceURL options:0 error:&coordError byAccessor:^(NSURL *coordinatedURL) {
    coordEnumerator = [fm enumeratorAtURL:coordinatedURL
               includingPropertiesForKeys:@[NSURLIsDirectoryKey, NSURLIsSymbolicLinkKey, NSURLFileSizeKey, NSURLContentModificationDateKey, NSURLIsPackageKey]
                                  options:NSDirectoryEnumerationSkipsHiddenFiles | NSDirectoryEnumerationSkipsPackageDescendants
                             errorHandler:nil];
  }];
  if (coordEnumerator) {
    enumerator = coordEnumerator;
    usedCoordinator = YES;
  } else {
    enumerator = [fm enumeratorAtURL:sourceURL
         includingPropertiesForKeys:@[NSURLIsDirectoryKey, NSURLIsSymbolicLinkKey, NSURLFileSizeKey, NSURLContentModificationDateKey, NSURLIsPackageKey]
                            options:NSDirectoryEnumerationSkipsHiddenFiles | NSDirectoryEnumerationSkipsPackageDescendants
                       errorHandler:^BOOL(NSURL *url, NSError *error) {
      // 读不到的目录：记录后继续（删除保护）
      @synchronized (unreadableDirs) {
        if (url) [unreadableDirs addObject:url.path ?: @""];
      }
      return YES;
    }];
  }

  dispatch_group_t group = dispatch_group_create();
  NSMutableArray *pending = [NSMutableArray array];

  for (NSURL *url in enumerator) {
    if (_cancelled) break;
    NSNumber *isDir = nil;
    NSNumber *isSymlink = nil;
    NSNumber *isPackage = nil;
    [url getResourceValue:&isDir forKey:NSURLIsDirectoryKey error:nil];
    [url getResourceValue:&isSymlink forKey:NSURLIsSymbolicLinkKey error:nil];
    [url getResourceValue:&isPackage forKey:NSURLIsPackageKey error:nil];
    if ([isSymlink boolValue]) continue;       // 符号链接一律跳过（§5.3）
    if ([isDir boolValue] || [isPackage boolValue]) continue;

    NSString *ext = url.pathExtension.lowercaseString;
    if (![LxSupportedExtensions() containsObject:ext]) {
      @synchronized (unsupported) {
        if (unsupported.count < 200) [unsupported addObject:url.lastPathComponent ?: @""];
      }
      continue;
    }

    // iCloud 未下载文件识别（§5.3）
    NSString *name = url.lastPathComponent ?: @"";
    if ([name hasPrefix:@"."] && [name hasSuffix:@".icloud"]) {
      @synchronized (notDownloaded) {
        if (notDownloaded.count < 200) [notDownloaded addObject:name];
      }
      continue;
    }

    scanned++;
    // 并发受限入队探测
    dispatch_semaphore_wait(concurrencyLimit, DISPATCH_TIME_FOREVER);
    dispatch_group_enter(group);
    [pending addObject:url];
    if (pending.count >= 200) {
      NSArray *batch = [pending copy];
      [pending removeAllObjects];
      dispatch_async(probeQueue, ^{
        for (NSURL *fileURL in batch) {
          [[LxMediaProbe shared] probeFile:fileURL];
          dispatch_group_leave(group);
          dispatch_semaphore_signal(concurrencyLimit);
        }
      });
    }
  }
  // flush 剩余
  if (pending.count) {
    NSArray *batch = [pending copy];
    dispatch_async(probeQueue, ^{
      for (NSURL *fileURL in batch) {
        [[LxMediaProbe shared] probeFile:fileURL];
        dispatch_group_leave(group);
        dispatch_semaphore_signal(concurrencyLimit);
      }
    });
  }

  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);

  imported = scanned; // 探测成功的计入（真实判定在模块层 upsert 后）
  (void)updated;
  (void)removed;
  (void)usedCoordinator;

  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  result[@"imported"] = @(imported);
  result[@"updated"] = @(updated);
  result[@"removed"] = @(removed);
  result[@"cancelled"] = @(_cancelled);
  result[@"unsupported"] = @{ @"items": unsupported, @"total": @(unsupported.count) };
  result[@"notDownloaded"] = @{ @"items": notDownloaded, @"total": @(notDownloaded.count) };
  result[@"failed"] = @{ @"items": failed, @"total": @(failed.count) };
  result[@"unreadableDirs"] = @{ @"items": unreadableDirs, @"total": @(unreadableDirs.count) };
  return result;
}

@end
