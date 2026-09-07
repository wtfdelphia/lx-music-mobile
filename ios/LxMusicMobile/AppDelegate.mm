#import "AppDelegate.h"
#import <ReactNativeNavigation/ReactNativeNavigation.h>

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>

// CI 取证：沙箱标记存在时，把系统投递的每个 URL 追加到
// <tmp>/lx-ci-openurl.log，供宿主区分「系统未送达」与「JS 未触发」
// （run 32828495250：file:// 到达 JS 而 lxmusic:// 无声）。附带
// 来源包名，区分 simctl / 应用内 openURL 两条投递路径。
// 无标记文件时零开销，正式包行为不变。
static void LXCIRecordOpenURL(NSURL *url, NSString *source) {
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) return;
  NSString *logPath = [tmp stringByAppendingPathComponent:@"lx-ci-openurl.log"];
  NSString *line = [NSString stringWithFormat:@"%.0f %@ source=%@\n",
                    [[NSDate date] timeIntervalSince1970] * 1000.0,
                    url.absoluteString ?: @"<nil>",
                    source.length ? source : @"<none>"];
  NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:logPath];
  if (handle) {
    @try {
      [handle seekToEndOfFile];
      [handle writeData:data];
    } @finally {
      [handle closeFile];
    }
  } else {
    [data writeToFile:logPath atomically:YES];
  }
}

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // 任务 9.14 冷启动补口：进程未启动时打开文档，URL 不经 openURL 回调，
  // 而是由 RCTLinkingManager.getInitialURL 从 launchOptions 直取；暂存
  // 必须提前到此处改写 launchOptions，否则冷启动拿到的仍是沙箱外原始
  // 路径（真机实测：程序后台没有启动时报「调用失败 文件不存在」）
  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:[self lx_stagedLaunchOptions:launchOptions]];
  [ReactNativeNavigation bootstrapWithBridge:bridge];
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return YES;
}

- (NSArray<id<RCTBridgeModule>> *)extraModulesForBridge:(RCTBridge *)bridge {
  return [ReactNativeNavigation extraModulesForBridge:bridge];
}

#pragma mark - 深链（任务 6.3，对齐 AndroidManifest 的 lxmusic:// 与文件打开）

// 任务 9.14：「文件」App / 其他应用打开文档时，file:// URL 指向沙箱外
// （其他应用容器 / iCloud）。安全作用域访问授权只在 openURL 回调内可靠
// 可用；JS 收到 Linking 事件时 stat 已读不到原路径，深链链报
// 「调用失败：文件不存在」（真机 iPhone 17 Pro / iOS 26.6 实测）。
// 在此同步拷进沙箱暂存区并转发暂存 URL，下游 handleFileAction 看到的
// 一律是沙箱内可读路径（lxmc/js/audio 三类 DocumentTypes 同走此路径）。
// 沙箱内已可读文件（共享文档、CI 探针）原样透传，零拷贝。
- (NSURL *)lx_stagedFileURL:(NSURL *)url
{
  if (url == nil || !url.isFileURL) return url;
  NSString *srcPath = url.path;
  if (srcPath.length == 0) return url;
  NSFileManager *fm = [NSFileManager defaultManager];
  if ([fm isReadableFileAtPath:srcPath]) return url;

  BOOL scoped = [url startAccessingSecurityScopedResource];
  NSString *name = url.lastPathComponent.length > 0 ? url.lastPathComponent : @"opened-file";
  NSString *stageRoot = [NSTemporaryDirectory() stringByAppendingPathComponent:@"lx-opened-files"];
  // 每次打开独立时间戳子目录：并发打开互不覆盖，stat 读到的仍是原文件名
  NSString *destDir = [stageRoot stringByAppendingPathComponent:
                       [NSString stringWithFormat:@"%.0f", [[NSDate date] timeIntervalSince1970] * 1000.0]];
  NSError *error = nil;
  [fm createDirectoryAtPath:destDir withIntermediateDirectories:YES attributes:nil error:&error];
  NSString *destPath = [destDir stringByAppendingPathComponent:name];
  BOOL copied = [fm copyItemAtPath:srcPath toPath:destPath error:&error];
  if (scoped) [url stopAccessingSecurityScopedResource];
  // 拷贝失败保留原路径：下游报可读错误，不静默吞掉
  if (!copied) return url;
  return [NSURL fileURLWithPath:destPath];
}

- (NSDictionary *)lx_stagedLaunchOptions:(NSDictionary *)launchOptions
{
  if (launchOptions == nil) return launchOptions;
  id raw = launchOptions[UIApplicationLaunchOptionsURLKey];
  if (![raw isKindOfClass:[NSURL class]]) return launchOptions;
  NSURL *staged = [self lx_stagedFileURL:(NSURL *)raw];
  if (staged == (NSURL *)raw) return launchOptions;
  NSMutableDictionary *m = [launchOptions mutableCopy];
  m[UIApplicationLaunchOptionsURLKey] = staged;
  return m;
}

- (BOOL)application:(UIApplication *)app openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  LXCIRecordOpenURL(url, options[UIApplicationOpenURLOptionsSourceApplicationKey]);
  return [RCTLinkingManager application:app openURL:[self lx_stagedFileURL:url] options:options];
}

- (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)userActivity
 restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> *))restorationHandler {
  LXCIRecordOpenURL(userActivity.webpageURL, @"userActivity");
  return [RCTLinkingManager application:application continueUserActivity:userActivity
                    restorationHandler:restorationHandler];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self getBundleURL];
}
- (NSURL *)getBundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
