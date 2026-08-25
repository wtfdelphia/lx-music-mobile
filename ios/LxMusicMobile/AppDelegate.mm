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
  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
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

- (BOOL)application:(UIApplication *)app openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  LXCIRecordOpenURL(url, options[UIApplicationOpenURLOptionsSourceApplicationKey]);
  return [RCTLinkingManager application:app openURL:url options:options];
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
