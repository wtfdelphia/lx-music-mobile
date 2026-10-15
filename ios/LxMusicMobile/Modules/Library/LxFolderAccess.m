#import "LxFolderAccess.h"
#import "LxLibraryStore.h"
#import "LxLibraryUtils.h"
#import <Foundation/Foundation.h>

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
  if (!sourceId.length || ![config isKindOfClass:[NSDictionary class]]) return NO;
  LxGrant *grant = [LxGrant new];
  // LxStr 清洗：JS null 到达时是 NSNull，对其发 length 会崩（F5）。
  // relPath 用键存在性判断：空串合法，表示沙箱分支选中 Documents 根
  NSString *bookmarkBase64 = LxStr(config[@"bookmark"]);
  NSString *relPath = LxStr(config[@"relPath"]);
  BOOL hasRelPath = [config[@"relPath"] isKindOfClass:[NSString class]];
  if (bookmarkBase64.length) {
    grant.sandbox = NO;
    grant.bookmark = [[NSData alloc] initWithBase64EncodedString:bookmarkBase64 options:0];
  } else if (hasRelPath) {
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

// F4：「下载」虚拟来源等无外部授权的来源，根目录即 Documents
- (BOOL)ensureGrantForSourceId:(NSString *)sourceId
{
  @synchronized (self) {
    if (_grants[sourceId]) return YES;
  }
  NSDictionary *meta = [[LxLibraryStore shared] configForSourceId:sourceId];
  if (!meta) return NO;
  NSString *type = LxStr(meta[@"type"]);
  if ([type isEqualToString:@"download"]) {
    // 下载来源：文件在 Documents 内，相对路径即 itemKey，无需授权
    LxGrant *grant = [LxGrant new];
    grant.sandbox = YES;
    grant.relPath = @"";
    @synchronized (self) {
      _grants[sourceId] = grant;
    }
    return YES;
  }
  NSString *configJSON = LxStr(meta[@"config"]);
  if (!configJSON.length) return NO;
  NSDictionary *config = [NSJSONSerialization JSONObjectWithData:[configJSON dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  return [self saveGrantForSourceId:sourceId config:config];
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
    // F1：冷启动后内存授权丢失，从 Store 懒加载
    if ([self ensureGrantForSourceId:sourceId]) {
      @synchronized (self) {
        grant = _grants[sourceId];
        grant.refCount += 1;
      }
    } else {
      if (error) *error = [NSError errorWithDomain:LxLibraryErrorDomain code:LxLibraryErrorNotFound userInfo:@{NSLocalizedDescriptionKey: @"no grant"}];
      return NO;
    }
  }
  if (grant.sandbox) {
    // relPath 为空串（下载虚拟来源，F4）：根目录即 Documents
    grant.url = grant.relPath.length
      ? [[self documentsURL] URLByAppendingPathComponent:grant.relPath isDirectory:YES]
      : [self documentsURL];
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
    // 重新生成并回写（审核第 10 条）：此前只更新内存，注释声称的
    // 「模块层回写」不存在，下次冷启动仍解析旧 bookmark 数据
    NSData *newBookmark = [url bookmarkDataWithOptions:0
                        includingResourceValuesForKeys:nil
                                         relativeToURL:nil
                                                 error:nil];
    if (newBookmark) {
      grant.bookmark = newBookmark;
      [self persistBookmark:newBookmark forSourceId:sourceId];
    }
  }
  if (![url startAccessingSecurityScopedResource]) {
    // 容错：部分场景（容器内路径被误存为 bookmark、系统已隐式持有
    // 访问权）startAccessing 返回 NO 但目录实际可读。可读即继续，
    // 只有真正不可读才判授权失效
    BOOL isDir = NO;
    BOOL readable = [NSFileManager.defaultManager fileExistsAtPath:url.path isDirectory:&isDir] && isDir;
    if (!readable) {
      if (error) *error = [NSError errorWithDomain:LxLibraryErrorDomain code:LxLibraryErrorReauth userInfo:@{NSLocalizedDescriptionKey: @"startAccess failed"}];
      return NO;
    }
  } else {
    grant.accessing = YES;
  }
  grant.url = url;
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

// stale bookmark 重新生成后回写 source.config（与 JS 侧 config JSON 结构对齐）
- (void)persistBookmark:(NSData *)bookmark forSourceId:(NSString *)sourceId
{
  if (!bookmark.length || !sourceId.length) return;
  NSDictionary *meta = [[LxLibraryStore shared] configForSourceId:sourceId];
  NSString *configJSON = LxStr(meta[@"config"]);
  if (!configJSON.length) return;
  NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:[configJSON dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![parsed isKindOfClass:[NSDictionary class]]) return;
  NSMutableDictionary *config = [parsed mutableCopy];
  config[@"bookmark"] = [bookmark base64EncodedStringWithOptions:0];
  NSData *data = [NSJSONSerialization dataWithJSONObject:config options:0 error:nil];
  NSString *newJSON = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  if (newJSON) [[LxLibraryStore shared] setSourceConfig:sourceId config:newJSON state:nil];
}

- (NSURL *)resolveSourceId:(NSString *)sourceId relativePath:(NSString *)relPath
{
  NSURL *root = [self rootURLForSourceId:sourceId];
  if (!root || !relPath.length) return nil;
  NSURL *candidate = [root URLByAppendingPathComponent:relPath];
  // 标准化后校验仍在根目录下（防 .. 穿越）（§16）。
  // 前缀比较必须带尾斜杠：/Music 不得匹配 /Music2
  NSString *rootStandard = [root.standardizedURL.path stringByAppendingString:@"/"];
  NSString *candidateStandard = candidate.standardizedURL.path;
  if (![candidateStandard hasPrefix:rootStandard]) return nil;
  return candidate.standardizedURL;
}

@end
