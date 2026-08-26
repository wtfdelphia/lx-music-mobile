#import "UtilsModule.h"
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <MobileCoreServices/MobileCoreServices.h>
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <ifaddrs.h>
#import <arpa/inet.h>
#import <net/if.h>

@interface UtilsModule () <UIDocumentPickerDelegate>
@property (nonatomic, copy, nullable) RCTPromiseResolveBlock selectFileResolve;
@property (nonatomic, copy, nullable) NSString *selectFileToPath;
@end

@implementation UtilsModule {
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(screenDidUnlock)
                                                 name:UIApplicationProtectedDataDidBecomeAvailable
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(screenWillLock)
                                                 name:UIApplicationProtectedDataWillBecomeUnavailable
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(orientationDidChange)
                                                 name:UIApplicationDidChangeStatusBarOrientationNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - RCTEventEmitter

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"screen-state", @"screen-size-changed" ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

- (void)screenDidUnlock
{
  if (_hasListeners) [self sendEventWithName:@"screen-state" body:@{ @"state": @"ON" }];
}

- (void)screenWillLock
{
  if (_hasListeners) [self sendEventWithName:@"screen-state" body:@{ @"state": @"OFF" }];
}

// 与 getWindowSize 同口径：points * scale（JS 侧除以 scale 得 dp/pt）
- (NSDictionary *)currentWindowSize
{
  CGRect bounds = [UIScreen mainScreen].bounds;
  CGFloat scale = [UIScreen mainScreen].scale;
  return @{
    @"width": @((NSInteger)(bounds.size.width * scale)),
    @"height": @((NSInteger)(bounds.size.height * scale)),
  };
}

- (void)orientationDidChange
{
  if (_hasListeners) [self sendEventWithName:@"screen-size-changed" body:[self currentWindowSize]];
}

#pragma mark - 导出方法

// 不覆写 addListener/removeListeners：RN 0.73 RCTEventEmitter 基类
// 负责监听计数与 startObserving 触发，空覆写会吞掉全部事件。

// iOS 不允许应用主动退出，桩化为空实现
RCT_EXPORT_METHOD(exitApp) {}

RCT_EXPORT_METHOD(getSupportedAbis:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
#if defined(__arm64__)
  resolve(@[ @"arm64" ]);
#elif defined(__x86_64__)
  resolve(@[ @"x86_64" ]);
#else
  resolve(@[ @"unknown" ]);
#endif
}

// iOS 无法安装 APK；更新路径在 JS 侧改道（任务 7.3）
RCT_EXPORT_METHOD(installApk:(NSString *)filePath
                  authority:(NSString *)authority
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  reject(@"not_supported", @"Installing APK is not supported on iOS", nil);
}

RCT_EXPORT_METHOD(screenkeepAwake)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = YES;
  });
}

RCT_EXPORT_METHOD(screenUnkeepAwake)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = NO;
  });
}

RCT_EXPORT_METHOD(getWIFIIPV4Address:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *address = nil;
  struct ifaddrs *interfaces = NULL;
  if (getifaddrs(&interfaces) == 0) {
    for (struct ifaddrs *ifa = interfaces; ifa != NULL; ifa = ifa->ifa_next) {
      if (ifa->ifa_addr == NULL) continue;
      if (!(ifa->ifa_flags & IFF_UP) || !(ifa->ifa_flags & IFF_RUNNING)) continue;
      NSString *name = [NSString stringWithUTF8String:ifa->ifa_name];
      if (![name hasPrefix:@"en"]) continue;
      if (ifa->ifa_addr->sa_family != AF_INET) continue;
      struct sockaddr_in *addr4 = (struct sockaddr_in *)ifa->ifa_addr;
      char buf[INET_ADDRSTRLEN];
      if (inet_ntop(AF_INET, &addr4->sin_addr, buf, sizeof(buf)) != NULL) {
        address = [NSString stringWithUTF8String:buf];
        break;
      }
    }
    freeifaddrs(interfaces);
  }
  resolve(address != nil ? address : [NSNull null]);
}

RCT_EXPORT_METHOD(getDeviceName:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([[UIDevice currentDevice] name]);
}

RCT_EXPORT_METHOD(isNotificationsEnabled:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    BOOL enabled = settings.authorizationStatus == UNAuthorizationStatusAuthorized
      || settings.authorizationStatus == UNAuthorizationStatusProvisional;
    resolve(@(enabled));
  }];
}

// Android 侧跳系统设置页；iOS 直接请求授权并返回结果
RCT_EXPORT_METHOD(openNotificationPermissionActivity:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
  [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:options completionHandler:^(BOOL granted, NSError *error) {
    resolve(@(granted));
  }];
}

RCT_EXPORT_METHOD(shareText:(NSString *)shareTitle
                  title:(NSString *)title
                  text:(NSString *)text)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *root = [UIApplication sharedApplication].delegate.window.rootViewController;
    while (root.presentedViewController != nil) root = root.presentedViewController;
    if (root == nil) return;
    NSString *subject = shareTitle.length > 0 ? shareTitle : title;
    UIActivityViewController *controller = [[UIActivityViewController alloc] initWithActivityItems:@[ text ] applicationActivities:nil];
    [controller setValue:subject forKey:@"subject"];
    if (controller.popoverPresentationController != nil) {
      controller.popoverPresentationController.sourceView = root.view;
      controller.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(root.view.bounds), CGRectGetMidY(root.view.bounds), 0, 0);
    }
    [root presentViewController:controller animated:YES completion:nil];
  });
}

RCT_EXPORT_METHOD(getSystemLocales:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *locale = [[NSLocale preferredLanguages] firstObject];
  resolve(locale != nil ? locale : @"en-US");
}

RCT_EXPORT_METHOD(getWindowSize:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self currentWindowSize]);
}

// CI 自测：字体注册检查（任务 1.5 豆腐块的根因判据）。
// UIAppFonts 挂载失败时 fontWithName 返回 nil，图标字形无渲染源。
RCT_EXPORT_METHOD(isFontRegistered:(NSString *)name
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UIFont *font = [UIFont fontWithName:(name ?: @"") size:12];
  resolve(@(font != nil));
}

// CI 自测：音频会话运行时类别（任务 5.2）。
// setupPlayer(iosCategory: playback) 生效后应为 AVAudioSessionCategoryPlayback，
// 这是后台出声的必要配置在运行时的直接证据。
RCT_EXPORT_METHOD(getAudioSessionCategory:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([AVAudioSession sharedInstance].category);
}

// CI 自测：锁屏/控制中心 Now Playing 面板内容（任务 5.3/5.4）。
// 返回 MPNowPlayingInfoCenter 当前信息的可读子集；无内容时 resolve(null)。
RCT_EXPORT_METHOD(getNowPlayingInfo:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *info = [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo;
  if (info == nil || info.count == 0) {
    resolve([NSNull null]);
    return;
  }
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  id title = info[MPMediaItemPropertyTitle];
  id artist = info[MPMediaItemPropertyArtist];
  id album = info[MPMediaItemPropertyAlbumTitle];
  id duration = info[MPMediaItemPropertyPlaybackDuration];
  id elapsed = info[MPNowPlayingInfoPropertyElapsedPlaybackTime];
  id artwork = info[MPMediaItemPropertyArtwork];
  if ([title isKindOfClass:[NSString class]]) out[@"title"] = title;
  if ([artist isKindOfClass:[NSString class]]) out[@"artist"] = artist;
  if ([album isKindOfClass:[NSString class]]) out[@"album"] = album;
  if ([duration isKindOfClass:[NSNumber class]]) out[@"duration"] = duration;
  if ([elapsed isKindOfClass:[NSNumber class]]) out[@"elapsed"] = elapsed;
  out[@"hasArtwork"] = @([artwork isKindOfClass:[MPMediaItemArtwork class]]);
  resolve(out);
}

// CI 自测：屏幕常亮开关回读（任务 6.6 常亮项的运行时判据）
RCT_EXPORT_METHOD(isScreenKeepAwake:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(@([UIApplication sharedApplication].idleTimerDisabled));
  });
}

// CI 自测（任务 7.4 横屏）：强制旋转模拟器窗口。宿主侧无可靠的无头旋转
// 通道（simctl 无 rotate 子命令，AppleScript 依赖 GUI 会话），改由应用内
// 驱动：KVC 设置设备方向 + attemptRotation；iOS 16+ 追加场景几何请求。
// 双保险门控：仅当沙箱存在 .lx-ci-selftest 标记时生效，正式包恒拒绝。
RCT_EXPORT_METHOD(setDeviceOrientation:(NSString *)name
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) {
    reject(@"not_allowed", @"orientation forcing requires the CI self-test marker", nil);
    return;
  }
  BOOL landscape = [name isEqualToString:@"landscape"];
  dispatch_async(dispatch_get_main_queue(), ^{
    UIDeviceOrientation target = landscape ? UIDeviceOrientationLandscapeLeft : UIDeviceOrientationPortrait;
    // KVC 通道走运行时查找，避免在个别构建下触发 KVC 异常（仅模拟器自测场景）
    UIDevice *device = [UIDevice currentDevice];
    SEL setter = NSSelectorFromString(@"setValue:forKey:");
    if ([device respondsToSelector:setter]) {
      [device setValue:@(target) forKey:@"orientation"];
    }
    [UIViewController attemptRotationToDeviceOrientation];
    if (@available(iOS 16.0, *)) {
      UIInterfaceOrientationMask mask = landscape ? UIInterfaceOrientationMaskLandscape : UIInterfaceOrientationMaskPortrait;
      UIWindowSceneGeometryPreferencesIOS *prefs =
        [[UIWindowSceneGeometryPreferencesIOS alloc] initWithInterfaceOrientations:mask];
      for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
        if ([scene isKindOfClass:[UIWindowScene class]] &&
            scene.activationState == UISceneActivationStateForegroundActive) {
          [(UIWindowScene *)scene requestGeometryUpdateWithPreferences:prefs errorHandler:nil];
        }
      }
    }
    resolve(@(YES));
  });
}

// 观察者已在 init 注册，此处保留空实现以对齐 JS 调用面
RCT_EXPORT_METHOD(listenWindowSizeChanged) {}

// iOS 无 Doze 机制，语义上恒为"已忽略电池优化"
RCT_EXPORT_METHOD(isIgnoringBatteryOptimization:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@(YES));
}

RCT_EXPORT_METHOD(requestIgnoreBatteryOptimization:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@(YES));
}

#pragma mark - 文件选择（任务 6.5，替代 Android SAF openDocument）

// 扩展名 → UTI；未知扩展名（如 .lxmc）会得到 dyn.* 动态 UTI，过滤性差，退回 public.data
- (NSString *)utiForExtension:(NSString *)ext
{
  NSString *uti = nil;
  CFStringRef created = UTTypeCreatePreferredIdentifierForTag(kUTTagClassFilenameExtension, (__bridge CFStringRef)[ext lowercaseString], NULL);
  if (created != NULL) {
    uti = (__bridge_transfer NSString *)created;
  }
  if (uti == nil || [uti hasPrefix:@"dyn."]) uti = (__bridge NSString *)kUTTypeData;
  return uti;
}

- (NSString *)mimeForExtension:(NSString *)ext
{
  NSString *uti = [self utiForExtension:ext];
  NSString *mime = nil;
  CFStringRef created = UTTypeCopyPreferredTagWithClass((__bridge CFStringRef)uti, kUTTagClassMIMEType);
  if (created != NULL) {
    mime = (__bridge_transfer NSString *)created;
  }
  return mime != nil ? mime : @"application/octet-stream";
}

// 与 Android 契约对齐：取消时 resolve(null)；给定 toPath 时拷贝到 toPath/原文件名，
// 返回 { data: 目标路径, ...文件信息 }
RCT_EXPORT_METHOD(selectFile:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSArray *extTypes = nil;
  NSString *toPath = nil;
  if ([options isKindOfClass:[NSDictionary class]]) {
    if ([options[@"extTypes"] isKindOfClass:[NSArray class]]) extTypes = options[@"extTypes"];
    if ([options[@"toPath"] isKindOfClass:[NSString class]]) toPath = options[@"toPath"];
  }

  NSMutableArray<NSString *> *documentTypes = [NSMutableArray array];
  for (id ext in extTypes) {
    if ([ext isKindOfClass:[NSString class]] && [ext length] > 0) {
      NSString *uti = [self utiForExtension:ext];
      if (![documentTypes containsObject:uti]) [documentTypes addObject:uti];
    }
  }
  if (documentTypes.count == 0) [documentTypes addObject:(__bridge NSString *)kUTTypeItem];

  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *root = [UIApplication sharedApplication].delegate.window.rootViewController;
    while (root.presentedViewController != nil) root = root.presentedViewController;
    if (root == nil) {
      reject(@"no_root_vc", @"No view controller to present document picker", nil);
      return;
    }
    if (self.selectFileResolve != nil) {
      // 上一个选择器仍在显示，按取消处理
      self.selectFileResolve([NSNull null]);
    }
    self.selectFileResolve = resolve;
    self.selectFileToPath = toPath;
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initWithDocumentTypes:documentTypes inMode:UIDocumentPickerModeImport];
    picker.delegate = self;
    [root presentViewController:picker animated:YES completion:nil];
  });
}

- (void)clearSelectFileState
{
  self.selectFileResolve = nil;
  self.selectFileToPath = nil;
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  RCTPromiseResolveBlock resolve = self.selectFileResolve;
  NSString *toPath = self.selectFileToPath;
  [self clearSelectFileState];
  if (resolve == nil) return;

  NSURL *url = urls.firstObject;
  if (url == nil) {
    resolve([NSNull null]);
    return;
  }

  BOOL scoped = [url startAccessingSecurityScopedResource];
  NSString *name = url.lastPathComponent.length > 0 ? url.lastPathComponent : @"file";

  if (toPath == nil) {
    NSData *data = [NSData dataWithContentsOfURL:url];
    if (scoped) [url stopAccessingSecurityScopedResource];
    if (data == nil) {
      resolve([NSNull null]);
      return;
    }
    NSString *content = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    resolve(@{ @"data": content != nil ? content : @"" });
    return;
  }

  NSString *destPath = [toPath stringByAppendingPathComponent:name];
  NSURL *destURL = [NSURL fileURLWithPath:destPath];
  NSString *ext = name.pathExtension;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSFileManager *fm = [NSFileManager defaultManager];
    NSError *error = nil;
    [fm createDirectoryAtPath:toPath withIntermediateDirectories:YES attributes:nil error:&error];
    [fm removeItemAtPath:destPath error:nil];
    BOOL copied = [fm copyItemAtURL:url toURL:destURL error:&error];
    if (scoped) [url stopAccessingSecurityScopedResource];
    if (!copied) {
      resolve([NSNull null]);
      return;
    }
    NSDictionary *attrs = [fm attributesOfItemAtPath:destPath error:nil];
    resolve(@{
      @"data": destPath,
      @"name": name,
      @"path": destPath,
      @"isDirectory": @(NO),
      @"isFile": @(YES),
      @"mimeType": [self mimeForExtension:ext],
      @"size": attrs[NSFileSize] != nil ? attrs[NSFileSize] : @0,
      @"lastModified": attrs[NSFileModificationDate] != nil ? @([attrs[NSFileModificationDate] timeIntervalSince1970] * 1000) : @0,
      @"canRead": @(YES),
    });
  });
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  RCTPromiseResolveBlock resolve = self.selectFileResolve;
  [self clearSelectFileState];
  if (resolve != nil) resolve([NSNull null]);
}

@end
