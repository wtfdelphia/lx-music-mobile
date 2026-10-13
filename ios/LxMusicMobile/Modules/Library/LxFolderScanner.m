#import "LxFolderScanner.h"
#import "LxMediaProbe.h"
#import "LxArtworkCache.h"
#import "LxLibraryUtils.h"

// 扫描器实现（§5.3）。
// 并发模型（F2 修复）：每个文件单独入队并发探测队列，进入前取信号量
//（上限 4），探测完成即在 block 内释放信号量。不再攒批派发——
// 旧实现攒满 200 个或枚举结束才 dispatch 并 signal，导致第 5 个文件
// 起信号量永不释放、扫描永久阻塞。
// 入库（F3 修复）：探测结果组装为曲目行，随完成事件交给模块层批量
// upsert，不再丢弃。

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
    [self _scanOnBackground:sourceId rootURL:sourceURL recursive:recursive];
  });
}

- (void)_scanOnBackground:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive
{
  NSInteger scanned = 0;
  NSMutableArray *unsupported = [NSMutableArray array];
  NSMutableArray *notDownloaded = [NSMutableArray array];
  NSMutableArray *failed = [NSMutableArray array];
  NSMutableArray *unreadableDirs = [NSMutableArray array];

  NSFileManager *fm = NSFileManager.defaultManager;
  NSDirectoryEnumerator *enumerator = nil;

  // 尝试用 NSFileCoordinator 包一次协调读取拿一致视图；失败回退普通枚举（§5.3）
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
  } else {
    enumerator = [fm enumeratorAtURL:sourceURL
         includingPropertiesForKeys:@[NSURLIsDirectoryKey, NSURLIsSymbolicLinkKey, NSURLFileSizeKey, NSURLContentModificationDateKey, NSURLIsPackageKey]
                            options:NSDirectoryEnumerationSkipsHiddenFiles | NSDirectoryEnumerationSkipsPackageDescendants
                       errorHandler:^BOOL(NSURL *url, NSError *error) {
      // 读不到的目录：记录后继续（删除保护）
      @synchronized (unreadableDirs) {
        if (url && unreadableDirs.count < 200) [unreadableDirs addObject:url.path ?: @""];
      }
      return YES;
    }];
  }

  // F2：逐文件 dispatch，进入前取信号量，探测完成在 block 内释放
  dispatch_queue_t probeQueue = dispatch_queue_create("lx.library.probe", DISPATCH_QUEUE_CONCURRENT);
  dispatch_semaphore_t concurrencyLimit = dispatch_semaphore_create(4);
  dispatch_group_t group = dispatch_group_create();

  // F3：收集探测成功的行
  NSMutableArray<NSDictionary *> *rows = [NSMutableArray array];
  NSString *rootPath = sourceURL.standardizedURL.path;

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
    NSInteger currentScanned = scanned;
    // 元数据读取并发 4：取信号量 → 入组 → 探测 → 组内释放信号量
    dispatch_semaphore_wait(concurrencyLimit, DISPATCH_TIME_FOREVER);
    dispatch_group_enter(group);
    NSURL *fileURL = url;
    dispatch_async(probeQueue, ^{
      @autoreleasepool {
        NSDictionary *probe = [[LxMediaProbe shared] probeFile:fileURL];
        if (probe.count) {
          NSDictionary *row = [self _rowFromProbe:probe fileURL:fileURL rootPath:rootPath sourceId:sourceId];
          if (row) {
            @synchronized (rows) {
              [rows addObject:row];
            }
          } else {
            @synchronized (failed) {
              if (failed.count < 200) [failed addObject:@{ @"path": fileURL.lastPathComponent ?: @"", @"reason": @"row build failed" }];
            }
          }
        }
        if (self.delegate) {
          [self.delegate scanner:self sourceId:sourceId phase:@"probe" scanned:currentScanned total:0 imported:(NSInteger)rows.count];
        }
      }
      dispatch_group_leave(group);
      dispatch_semaphore_signal(concurrencyLimit);
    });
  }

  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);

  NSMutableDictionary *report = [NSMutableDictionary dictionary];
  report[@"imported"] = @(rows.count);
  report[@"updated"] = @0;
  report[@"removed"] = @0;
  report[@"cancelled"] = @(_cancelled);
  report[@"unsupported"] = @{ @"items": unsupported, @"total": @(unsupported.count) };
  report[@"notDownloaded"] = @{ @"items": notDownloaded, @"total": @(notDownloaded.count) };
  report[@"failed"] = @{ @"items": failed, @"total": @(failed.count) };
  report[@"unreadableDirs"] = @{ @"items": unreadableDirs, @"total": @(unreadableDirs.count) };

  _scanning = NO;
  if (self.delegate) {
    [self.delegate scanner:self sourceId:sourceId finishedWithRows:[rows copy] report:report];
  }
}

// F3：由探测结果组装曲目行（字段与 upsertTracks 契约一致）
- (NSDictionary *)_rowFromProbe:(NSDictionary *)probe fileURL:(NSURL *)fileURL rootPath:(NSString *)rootPath sourceId:(NSString *)sourceId
{
  NSString *absPath = fileURL.standardizedURL.path;
  if (![absPath hasPrefix:rootPath]) return nil;
  NSString *relPath = [absPath substringFromIndex:rootPath.length];
  if ([relPath hasPrefix:@"/"]) relPath = [relPath substringFromIndex:1];
  if (!relPath.length) return nil;

  // 封面：先查缓存，未命中则缩放后入缓存，存缓存文件名
  NSString *artworkName = nil;
  NSData *artworkData = probe[@"artworkData"];
  if ([artworkData isKindOfClass:[NSData class]] && artworkData.length) {
    NSString *cachedPath = [[LxArtworkCache shared] cachedPathForArtwork:artworkData];
    if (!cachedPath) {
      NSData *scaled = [[LxMediaProbe shared] extractArtwork:artworkData];
      cachedPath = [[LxArtworkCache shared] storeArtwork:scaled];
    }
    if (cachedPath) artworkName = cachedPath.lastPathComponent;
  }

  NSMutableDictionary *row = [NSMutableDictionary dictionary];
  row[@"item_key"] = relPath;
  row[@"title"] = LxStr(probe[@"title"]) ?: fileURL.lastPathComponent.stringByDeletingPathExtension;
  NSString *artist = LxStr(probe[@"artist"]);
  NSString *album = LxStr(probe[@"album"]);
  NSString *albumArtist = LxStr(probe[@"albumArtist"]);
  NSString *genre = LxStr(probe[@"genre"]);
  NSString *ext = LxStr(probe[@"ext"]) ?: fileURL.pathExtension.lowercaseString;
  if (artist) row[@"artist"] = artist;
  if (album) row[@"album"] = album;
  if (albumArtist) row[@"album_artist"] = albumArtist;
  if (genre) row[@"genre"] = genre;
  if (artworkName) row[@"artwork"] = artworkName;
  row[@"ext"] = ext;
  row[@"duration_ms"] = probe[@"durationMs"] ?: @0;
  row[@"track_no"] = LxNum(probe[@"trackNo"]);
  row[@"disc_no"] = LxNum(probe[@"discNo"]);
  row[@"year"] = LxNum(probe[@"year"]);
  row[@"bitrate"] = LxNum(probe[@"bitrate"]);
  row[@"size"] = probe[@"size"] ?: @0;
  row[@"has_embedded_lyric"] = probe[@"hasEmbeddedLyric"] ?: @NO;

  // 文件修改时间（增量扫描用）
  NSDictionary *attrs = [NSFileManager.defaultManager attributesOfItemAtPath:absPath error:nil];
  NSDate *mtime = attrs[NSFileModificationDate];
  if (mtime) row[@"mtime"] = @((long long)mtime.timeIntervalSince1970);

  return row;
}

@end
