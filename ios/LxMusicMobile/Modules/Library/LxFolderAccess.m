#import "LxFolderAccess.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

// 文件夹授权实现（§5.2）：
// - bookmark 解析用 NSURLBookmarkResolutionWithoutImplicitStartAccessing，
//   随后显式 startAccessingSecurityScopedResource（引用计数持有）
// - 沙箱内目录：相对 Documents，无需 bookmark，重签不受影响
// - resolve 时标准化路径并校验仍在根目录下（§16 路径越界防护）

NSString * const LxLibraryErrorDomain = @"LxLibrary";

typedef NS_ENUM(NSInteger, LxLibraryErrorCode) {
  LxLibraryErrorReauth = 1,   // bookmark 失效，需要重新选择
  LxLibraryErrorNotFound = 2, // 文件不存在
};

@interface LxGrant : NSObject
@property (nonatomic, assign) BOOL sandbox;
@property (nonatomic, copy) NSString *relPath;        // sandbox 时相对 Documents
@property (nonatomic, copy) NSData *bookmark;         // 外部目录
@property (nonatomic, strong) NSURL *url;             // 解析后的根目录
@property (nonatomic, assign) BOOL accessing;         // 是否已 startAccess
@property (nonatomic, assign) NSInteger refCount;
@end

@implementation LxGrant
@end

@implementation LxFolderAccess {
  NSMutableDictionary<NSString *, LxGrant *> *_grants;
}

+ (instancetype)shared
{
  static LxFolderAccess *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[LxFolderAccess alloc] init];
  });
  return instance;
}

- (instancetype)init
{
  if (self = [super init]) {
    _grants = [NSMutableDictionary dictionary];
  }
  return self;
}

#pragma mark - 授权记录

- (BOOL)saveGrantForSourceId:(NSString *)sourceId config:(NSDictionary *)config
{
  if (!sourceId.length || !config) return NO;
  LxGrant *grant = [LxGrant new];
  NSString *bookmarkBase64 = config[@"bookmark"];
  NSString *relPath = config[@"relPath"];
  if (bookmarkBase64.length) {
    grant.sandbox = NO;
    grant.bookmark = [[NSData alloc] initWithBase64EncodedString:bookmarkBase64 options:0];
  } else if (relPath.length) {
    grant.sandbox = YES;
    grant.relPath = relPath;
  } else {
    return NO;
  }
  @synchronized (self) {
    _grants[sourceId] = grant;
  }
  return YES;
}

- (NSURL *)documentsURL
{
  return [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
}

#pragma mark - 引用计数

- (BOOL)acquire:(NSString *)sourceId error:(NSError * _Nullable * _Nullable)error
{
  LxGrant *grant;
  @synchronized (self) {
    grant = _grants[sourceId];
    if (grant) {
      grant.refCount += 1;
      if (grant.url) return YES; // 已解析且持有
    }
  }
  if (!grant) {
    if (error) *error = [NSError errorWithDomain:LxLibraryErrorDomain code:LxLibraryErrorNotFound userInfo:@{NSLocalizedDescriptionKey: @"no grant"}];
    return NO;
  }
  if (grant.sandbox) {
    grant.url = [[self documentsURL] URLByAppendingPathComponent:grant.relPath isDirectory:YES];
    return YES;
  }
  // 外部目录：解析 bookmark
  BOOL isStale = NO;
  NSError *resolveError = nil;
  NSURL *url = [NSURL URLByResolvingBookmarkData:grant.bookmark
                                         options:NSURLBookmarkResolutionWithoutImplicitStartAccessing | NSURLBookmarkResolutionWithoutUI
                                   relativeToURL:nil
                             bookmarkDataIsStale:&isStale
                                           error:&resolveError];
  if (!url || resolveError) {
    if (error) *error = [NSError errorWithDomain:LxLibraryErrorDomain code:LxLibraryErrorReauth userInfo:@{NSLocalizedDescriptionKey: @"bookmark resolve failed"}];
    return NO;
  }
  if (isStale) {
    // 重新生成并回写由模块层处理（写回 source.config）；
    // 这里先用旧 URL 继续，能访问就不打断播放
    NSData *newBookmark = [url bookmarkDataWithOptions:0
                        includingResourceValuesForKeys:nil
                                         relativeToURL:nil
                                                 error:nil];
    if (newBookmark) grant.bookmark = newBookmark;
  }
  if (![url startAccessingSecurityScopedResource]) {
    if (error) *error = [NSError errorWithDomain:LxLibraryErrorDomain code:LxLibraryErrorReauth userInfo:@{NSLocalizedDescriptionKey: @"startAccess failed"}];
    return NO;
  }
  grant.url = url;
  grant.accessing = YES;
  return YES;
}

- (void)release:(NSString *)sourceId
{
  @synchronized (self) {
    LxGrant *grant = _grants[sourceId];
    if (!grant) return;
    grant.refCount = MAX(0, grant.refCount - 1);
    // 播放持有策略（§5.2）：App 生命周期内不主动释放，
    // 只有删除来源（refCount 强制清零）才真正 stop
    if (grant.refCount > 0) return;
    if (grant.accessing && grant.url) {
      [grant.url stopAccessingSecurityScopedResource];
    }
    grant.accessing = NO;
    grant.url = nil;
  }
}

- (void)forceReleaseForDelete:(NSString *)sourceId
{
  @synchronized (self) {
    LxGrant *grant = _grants[sourceId];
    if (!grant) return;
    if (grant.accessing && grant.url) {
      [grant.url stopAccessingSecurityScopedResource];
    }
    [_grants removeObjectForKey:sourceId];
  }
}

- (BOOL)relink:(NSString *)sourceId bookmark:(NSString *)bookmark label:(NSString *)label
{
  LxGrant *grant;
  @synchronized (self) {
    grant = _grants[sourceId];
    if (!grant) {
      grant = [LxGrant new];
      _grants[sourceId] = grant;
    }
  }
  grant.sandbox = NO;
  grant.bookmark = [[NSData alloc] initWithBase64EncodedString:bookmark options:0];
  // 下次 acquire 重新解析；itemKey（相对路径）不变，列表中曲目自动恢复
  if (grant.accessing && grant.url) {
    [grant.url stopAccessingSecurityScopedResource];
    grant.accessing = NO;
  }
  grant.url = nil;
  return grant.bookmark != nil;
}

#pragma mark - 路径解析

- (NSURL *)rootURLForSourceId:(NSString *)sourceId
{
  @synchronized (self) {
    return _grants[sourceId].url;
  }
}

- (BOOL)isSandboxSource:(NSString *)sourceId
{
  @synchronized (self) {
    return _grants[sourceId].sandbox;
  }
}

- (NSURL *)resolveSourceId:(NSString *)sourceId relativePath:(NSString *)relPath
{
  NSURL *root = [self rootURLForSourceId:sourceId];
  if (!root || !relPath.length) return nil;
  NSURL *candidate = [root URLByAppendingPathComponent:relPath];
  // 标准化后校验仍在根目录下（防 .. 穿越）（§16）
  NSString *rootStandard = root.standardizedURL.path;
  NSString *candidateStandard = candidate.standardizedURL.path;
  if (![candidateStandard hasPrefix:rootStandard]) return nil;
  return candidate.standardizedURL;
}

@end
