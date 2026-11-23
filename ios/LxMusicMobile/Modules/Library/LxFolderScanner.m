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

// 伴随文件：歌词 / 封面 / 播放列表 / 说明文件等。曲库正常消费
//（readLyric 按同名 .lrc 读取）或与音乐无关，静默跳过，不计入
//「不支持的格式」（真机反馈：报告里 .lrc 被算成不支持）
static NSSet *LxSilentExtensions(void)
{
  static NSSet *exts = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    exts = [NSSet setWithArray:@[@"lrc", @"krc", @"qrc", @"txt", @"cue", @"jpg", @"jpeg", @"png", @"webp", @"gif", @"bmp", @"nfo", @"log", @"m3u", @"m3u8", @"pls", @"sfv", @"db", @"ini", @"tmp"]];
  });
  return exts;
}

// 不可读目录 → 相对来源根的路径前缀（finishSync 删除保护豁免键）。
// 不在根下的路径原样返回（前缀匹配不上即不豁免，安全侧倾）
static NSString *LxRelPath(NSString *path, NSString *rootPath)
{
  if (path.length && rootPath.length && [path hasPrefix:rootPath]) {
    NSString *rel = [path substringFromIndex:rootPath.length];
    if ([rel hasPrefix:@"/"]) rel = [rel substringFromIndex:1];
    if (rel.length) return rel;
  }
  return path ?: @"";
}

@implementation LxFolderScanner {
  BOOL _scanning;
  BOOL _cancelled;
  NSString *_currentSourceId;
}

- (BOOL)scanning { return _scanning; }
- (NSString *)currentSourceId { return _currentSourceId; }

- (void)cancel { _cancelled = YES; }

- (BOOL)scanSourceId:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive
{
  // 忙时返回 NO：模块层据此 reject E_SCAN_BUSY，不再静默吞掉
  // 让 JS 白等一个永远不会来的完成事件（真机反馈「扫描全部没有用」）
  if (_scanning) return NO;
  _scanning = YES;
  _cancelled = NO;
  _currentSourceId = [sourceId copy];

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    [self _scanOnBackground:sourceId rootURL:sourceURL recursive:recursive];
  });
  return YES;
}

- (void)_scanOnBackground:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive
{
  NSInteger scanned = 0;
  NSMutableArray *unsupported = [NSMutableArray array];
  NSMutableArray *notDownloaded = [NSMutableArray array];
  NSMutableArray *failed = [NSMutableArray array];
  NSMutableArray *unreadableDirs = [NSMutableArray array];
  NSString *rootPath = sourceURL.standardizedURL.path;

  NSFileManager *fm = NSFileManager.defaultManager;
  NSDirectoryEnumerator *enumerator = nil;

  // 递归开关（§5.3 / §14.4「包含子文件夹」）：此前参数被传入却从未使用，
  // 枚举器永远递归。不递归时加 SkipsSubdirectoryDescendants
  // 不带 SkipsHiddenFiles：.icloud 占位文件是隐藏文件，带该选项时
  // 未下载统计永远是 0（真机审核发现）。隐藏项改在循环里手动跳过，
  // .icloud 占位单独识别并触发下载
  NSDirectoryEnumerationOptions enumOptions = NSDirectoryEnumerationSkipsPackageDescendants;
  if (!recursive) enumOptions |= NSDirectoryEnumerationSkipsSubdirectoryDescendants;

  // 尝试用 NSFileCoordinator 包一次协调读取拿一致视图；失败回退普通枚举（§5.3）
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  __block NSDirectoryEnumerator *coordEnumerator = nil;
  NSError *coordError = nil;
  // 协调枚举也带 errorHandler：此前传 nil，不可读目录永远记不到
  // 报告（删除保护依赖这个清单）
  [coordinator coordinateReadingItemAtURL:sourceURL options:0 error:&coordError byAccessor:^(NSURL *coordinatedURL) {
    coordEnumerator = [fm enumeratorAtURL:coordinatedURL
               includingPropertiesForKeys:@[NSURLIsDirectoryKey, NSURLIsSymbolicLinkKey, NSURLFileSizeKey, NSURLContentModificationDateKey, NSURLIsPackageKey]
                                  options:enumOptions
                             errorHandler:^BOOL(NSURL *url, NSError *err) {
      @synchronized (unreadableDirs) {
        if (url && unreadableDirs.count < 200) [unreadableDirs addObject:LxRelPath(url.path, rootPath)];
      }
      return YES;
    }];
  }];
  if (coordEnumerator) {
    enumerator = coordEnumerator;
  } else {
    enumerator = [fm enumeratorAtURL:sourceURL
         includingPropertiesForKeys:@[NSURLIsDirectoryKey, NSURLIsSymbolicLinkKey, NSURLFileSizeKey, NSURLContentModificationDateKey, NSURLIsPackageKey]
                            options:enumOptions
                       errorHandler:^BOOL(NSURL *url, NSError *error) {
      // 读不到的目录：记录后继续（删除保护）
      @synchronized (unreadableDirs) {
        if (url && unreadableDirs.count < 200) [unreadableDirs addObject:LxRelPath(url.path, rootPath)];
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

  for (NSURL *url in enumerator) {
    if (_cancelled) break;
    NSString *name = url.lastPathComponent ?: @"";
    NSNumber *isDir = nil;
    NSNumber *isSymlink = nil;
    NSNumber *isPackage = nil;
    [url getResourceValue:&isDir forKey:NSURLIsDirectoryKey error:nil];
    [url getResourceValue:&isSymlink forKey:NSURLIsSymbolicLinkKey error:nil];
    [url getResourceValue:&isPackage forKey:NSURLIsPackageKey error:nil];
    if ([isSymlink boolValue]) continue;       // 符号链接一律跳过（§5.3）

    // iCloud 未下载占位（.<原名>.icloud）：在扩展名过滤之前识别，
    // 否则占位扩展名是 icloud，永远到不了这里。记录并尽力触发下载
    if ([name hasPrefix:@"."] && [name hasSuffix:@".icloud"]) {
      @synchronized (notDownloaded) {
        if (notDownloaded.count < 200) [notDownloaded addObject:name];
      }
      [fm startDownloadingUbiquitousItemAtURL:url error:nil];
      continue;
    }

    // 隐藏项手动跳过（不带 SkipsHiddenFiles 后的补位）
    if ([name hasPrefix:@"."]) {
      if ([isDir boolValue]) [enumerator skipDescendents];
      continue;
    }

    if ([isDir boolValue] || [isPackage boolValue]) continue;

    NSString *ext = url.pathExtension.lowercaseString;
    if ([LxSilentExtensions() containsObject:ext]) continue;
    if (![LxSupportedExtensions() containsObject:ext]) {
      @synchronized (unsupported) {
        if (unsupported.count < 200) [unsupported addObject:name];
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
          NSDictionary *row = [self rowFromProbe:probe fileURL:fileURL rootPath:rootPath sourceId:sourceId];
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
  report[@"scanned"] = @(scanned);
  report[@"imported"] = @(rows.count);
  report[@"updated"] = @0;
  report[@"removed"] = @0;
  report[@"cancelled"] = @(_cancelled);
  report[@"unsupported"] = @{ @"items": unsupported, @"total": @(unsupported.count) };
  report[@"notDownloaded"] = @{ @"items": notDownloaded, @"total": @(notDownloaded.count) };
  report[@"failed"] = @{ @"items": failed, @"total": @(failed.count) };
  report[@"unreadableDirs"] = @{ @"items": unreadableDirs, @"total": @(unreadableDirs.count) };

  _scanning = NO;
  _currentSourceId = nil;
  if (self.delegate) {
    [self.delegate scanner:self sourceId:sourceId finishedWithRows:[rows copy] report:report];
  }
}

// F3：由探测结果组装曲目行（字段与 upsertTracks 契约一致）
- (NSDictionary *)rowFromProbe:(NSDictionary *)probe fileURL:(NSURL *)fileURL rootPath:(NSString *)rootPath sourceId:(NSString *)sourceId
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
  // 探测超时标记：upsert 对已存在的行只打 seen，不用文件名降级
  // 覆盖已有元数据（审核第 6 条）
  if (LxBool(probe[@"timeout"])) row[@"timeout"] = @YES;
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
