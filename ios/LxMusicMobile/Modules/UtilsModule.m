#import "UtilsModule.h"
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <MobileCoreServices/MobileCoreServices.h>
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <CoreText/CoreText.h>
#import <ifaddrs.h>
#import <arpa/inet.h>
#import <net/if.h>
#import <math.h>
#import <unistd.h>

@interface UtilsModule () <UIDocumentPickerDelegate>
@property (nonatomic, copy, nullable) RCTPromiseResolveBlock selectFileResolve;
@property (nonatomic, copy, nullable) NSString *selectFileToPath;
@property (nonatomic, strong, nullable) UIDocumentPickerViewController *selectFilePicker;
@property (nonatomic, assign) NSInteger selectFilePresentAttempts;
// 竞态探针（任务 9.4）：管线在预算内未能呈现时的报错原因，供轮询分支读走
@property (nonatomic, copy, nullable) NSString *raceProbeRejectReason;
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
// 注意：.m 文件里 `@(font != nil)` 的比较结果是 int，桥接转为 JS 数字
// 1/0 而非布尔（run 33012088667：JS 侧 === true 误判未注册，字体其实
// 已挂载）；三元表达式 `font != nil ? YES : NO` 同样会被 C 整型提升为
// int（run 33021891043 复现），必须经 BOOL 变量装箱
RCT_EXPORT_METHOD(isFontRegistered:(NSString *)name
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UIFont *font = [UIFont fontWithName:(name ?: @"") size:12];
  BOOL isRegistered = font != nil;
  resolve(@(isRegistered));
}

// CI 自测：UIAppFonts 偶发不生效时的诊断 + 兜底挂载。
// 返回当前 familyNames 中与文件名（去扩展名）相关的匹配（诊断面），
// 并尝试用 CTFontManager 手动注册 bundle 内同名文件；结果由调用方复核。
// 仅自测标记存在时生效，正式包恒拒绝。
RCT_EXPORT_METHOD(registerBundledFont:(NSString *)fileName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) {
    reject(@"not_allowed", @"font registration fallback requires the CI self-test marker", nil);
    return;
  }
  NSString *stem = [fileName stringByDeletingPathExtension] ?: @"";
  NSMutableArray *matched = [NSMutableArray array];
  for (NSString *family in [UIFont familyNames]) {
    if ([family rangeOfString:stem options:(NSCaseInsensitiveSearch)].location != NSNotFound) {
      [matched addObject:family];
    }
  }
  NSString *path = [[NSBundle mainBundle] pathForResource:stem
                                                   ofType:[fileName pathExtension]];
  BOOL registered = NO;
  if (path.length) {
    NSURL *url = [NSURL fileURLWithPath:path];
    CFErrorRef error = NULL;
    registered = CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url,
                                                  kCTFontManagerScopeProcess, &error);
    if (!registered && error) CFRelease(error);
  }
  resolve(@{ @"matched": matched, @"registered": @(registered) });
}

// CI 自测：音频会话运行时类别（任务 5.2）。
// setupPlayer(iosCategory: playback) 生效后应为 AVAudioSessionCategoryPlayback，
// 这是后台出声的必要配置在运行时的直接证据。
RCT_EXPORT_METHOD(getAudioSessionCategory:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([AVAudioSession sharedInstance].category);
}

// CI 自测（播放位置冻结判别）：裸 AVPlayer A/B 探针。
// run 32982319768/33012088667 实锤：两轮不同采样率夹具位置都冻结在
// ~0.027s（AVPlayer 报 playing 但时钟不走），疑似无头 runner 无音频
// 输出设备 → 媒体时钟停摆。本探针脱离 track-player 栈直接采样裸
// AVPlayer 位置：A 阶段复刻应用配置（automaticallyWaits=true），
// B 阶段关等待。若两阶段均不走 → 环境约束（门禁软化并带证据）；
// 若裸播放器走而应用栈不走 → 栈配置问题。附带会话路由诊断。
RCT_EXPORT_METHOD(audioClockProbe:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) {
    reject(@"not_allowed", @"audio clock probe requires the CI self-test marker", nil);
    return;
  }
  NSURL *fileURL = [NSURL URLWithString:path];
  if (fileURL == nil) {
    fileURL = [NSURL fileURLWithPath:(path ?: @"")];
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    // 会话诊断：路由/延迟/缓冲是「无输出设备」的直接读面
    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSMutableArray *outputs = [NSMutableArray array];
    for (AVAudioSessionPortDescription *port in session.currentRoute.outputs) {
      [outputs addObject:@{ @"type": port.portType ?: @"?", @"name": port.portName ?: @"?" }];
    }
    NSDictionary *sessionInfo = @{
      @"category": session.category ?: @"?",
      @"mode": session.mode ?: @"?",
      @"outputLatency": @(session.outputLatency),
      @"ioBufferDuration": @(session.IOBufferDuration),
      @"sampleRate": @(session.sampleRate),
      @"outputs": outputs,
    };

    NSMutableArray *phases = [NSMutableArray array];
    BOOL clockAdvances = NO;
    NSString *probeError = nil;
    @try {
      for (int phase = 0; phase < 2; phase++) {
        BOOL waits = (phase == 0);
        AVURLAsset *asset = [AVURLAsset assetWithURL:fileURL];
        AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];
        AVPlayer *player = [AVPlayer playerWithPlayerItem:item];
        player.automaticallyWaitsToMinimizeStalling = waits;
        [player play];
        usleep(300 * 1000);
        NSMutableArray *samples = [NSMutableArray array];
        for (int i = 0; i < 8; i++) {
          // CMTime 是 C 结构体，ObjC 无 .seconds 属性，须经 CMTimeGetSeconds
          double seconds = CMTimeGetSeconds(player.currentTime);
          [samples addObject:@(isnan(seconds) ? 0.0 : seconds)];
          usleep(400 * 1000);
        }
        [player pause];
        double first = [samples.firstObject doubleValue];
        double last = [samples.lastObject doubleValue];
        double advance = last - first;
        if (advance > 1.0) clockAdvances = YES;
        [phases addObject:@{
          @"waits": @(waits ? YES : NO),
          @"samples": samples,
          @"advance": @(advance),
          @"timeControlStatus": @(player.timeControlStatus),
        }];
        player = nil;
      }
    } @catch (NSException *exception) {
      probeError = [NSString stringWithFormat:@"%@: %@", exception.name, exception.reason];
    }
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    out[@"session"] = sessionInfo;
    out[@"phases"] = phases;
    out[@"clockAdvances"] = @(clockAdvances ? YES : NO);
    out[@"error"] = probeError ?: (id)[NSNull null];
    resolve(out);
  });
}

// CI 自测（任务 5.2 后台续播）：原生后台采样探针。
// run 33233955428 实锤：应用切后台后 RN JS 线程被重度节流——AppState
// 事件晚到 178s，JS 轮询等待与 JS 侧采样都不可靠。采样下沉到原生：
// 裸 AVPlayer 接管夹具并循环播放（音频后台模式保活要求全程有声），
// UIApplicationDidEnterBackground 观察者记录切后台时刻，并在其后
// +2s/+14s 原生采样播放器位置。JS 何时醒来何时读，判据不依赖 JS 时序。
static AVPlayer *lxciBgProbePlayer = nil;
static NSMutableDictionary *lxciBgProbeState = nil;

RCT_EXPORT_METHOD(startBgAudioProbe:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) {
    reject(@"not_allowed", @"bg audio probe requires the CI self-test marker", nil);
    return;
  }
  NSURL *fileURL = [NSURL URLWithString:path];
  if (fileURL == nil) {
    fileURL = [NSURL fileURLWithPath:(path ?: @"")];
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *error = nil;
    double posAfterStart = -1.0;
    NSInteger timeControlStatus = -1;
    @try {
      // 状态先于观察者就位：后台事件可能在观察者注册后立即到达，
      // 状态未就位会被观察者当作未启动丢弃
      lxciBgProbeState = [NSMutableDictionary dictionary];
      lxciBgProbeState[@"startedAt"] = @((long long)([[NSDate date] timeIntervalSince1970] * 1000.0));
      lxciBgProbeState[@"samples"] = [NSMutableArray array];
      AVURLAsset *asset = [AVURLAsset assetWithURL:fileURL];
      AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];
      AVPlayer *player = [AVPlayer playerWithPlayerItem:item];
      lxciBgProbePlayer = player;
      // 播完即回卷重播：夹具 90s，套件后台段可能持续数十分钟，
      // 音频一停应用就可能被系统回收
      [[NSNotificationCenter defaultCenter] addObserverForName:AVPlayerItemDidPlayToEndTimeNotification
                                                        object:item
                                                         queue:[NSOperationQueue mainQueue]
                                                    usingBlock:^(NSNotification *note) {
        [player seekToTime:kCMTimeZero];
        [player play];
      }];
      [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidEnterBackgroundNotification
                                                        object:nil
                                                         queue:[NSOperationQueue mainQueue]
                                                    usingBlock:^(NSNotification *note) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (lxciBgProbeState == nil) return;
          lxciBgProbeState[@"backgroundedAt"] = @((long long)([[NSDate date] timeIntervalSince1970] * 1000.0));
          void (^sample)(double) = ^(double delay) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
              if (lxciBgProbeState == nil) return;
              double seconds = CMTimeGetSeconds(player.currentTime);
              [(NSMutableArray *)lxciBgProbeState[@"samples"] addObject:@{
                @"delay": @(delay),
                @"at": @((long long)([[NSDate date] timeIntervalSince1970] * 1000.0)),
                @"pos": @(isnan(seconds) ? -1.0 : seconds),
                @"rate": @(player.rate),
              }];
            });
          };
          sample(2.0);
          sample(14.0);
        });
      }];
      [player play];
      usleep(300 * 1000);
      posAfterStart = CMTimeGetSeconds(player.currentTime);
      timeControlStatus = player.timeControlStatus;
    } @catch (NSException *exception) {
      error = [NSString stringWithFormat:@"%@: %@", exception.name, exception.reason];
    }
    resolve(@{
      @"started": @(error == nil),
      @"posAfterStart": @(isnan(posAfterStart) ? -1.0 : posAfterStart),
      @"timeControlStatus": @(timeControlStatus),
      @"error": error ?: (id)[NSNull null],
    });
  });
}

// CI 自测：读取后台探针结果。未启动（或初始化尚未落到主队列）返回
// null；已启动则带回切后台时刻与原生采样（可能尚未采完，长度 0-2）。
// 状态创建在后台队列、后续读写均在主队列，与观察者/采样块同队列免竞态。
RCT_EXPORT_METHOD(getBgAudioProbeResult:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (lxciBgProbeState == nil) {
      resolve([NSNull null]);
      return;
    }
    double seconds = CMTimeGetSeconds(lxciBgProbePlayer.currentTime);
    resolve(@{
      @"startedAt": lxciBgProbeState[@"startedAt"] ?: [NSNull null],
      @"backgroundedAt": lxciBgProbeState[@"backgroundedAt"] ?: [NSNull null],
      @"samples": [(NSMutableArray *)lxciBgProbeState[@"samples"] copy],
      @"posNow": @(isnan(seconds) ? -1.0 : seconds),
      @"rateNow": @(lxciBgProbePlayer.rate),
      @"playingNow": @(lxciBgProbePlayer.timeControlStatus == AVPlayerTimeControlStatusPlaying),
    });
  });
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
// 驱动：iOS 16+ 场景几何请求（requestGeometryUpdate）。
// run 32995785233 实锤：KVC 写 UIDevice.orientation 在 iOS 16+ 模拟器上
// 抛 NSUndefinedKeyException 直接崩进程（rotate 标记后 3s 崩溃）；
// respondsToSelector 对 setValue:forKey: 恒真，形同虚设，已整段移除。
// run 33012088667 实锤：无头模拟器上窗口场景处于 ForegroundInactive，
// ForegroundActive 门控把场景全部滤掉（scenes=0）；且本应用为 legacy
// 生命周期（无 scene manifest），场景须经 UIWindow.windowScene 兜底发现。
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
    // CI 专用代码：全程 @try/@catch，异常转诊断返回而非崩进程
    NSString *error = nil;
    NSMutableArray<NSString *> *applied = [NSMutableArray array];
    NSMutableArray<UIWindowScene *> *scenesFound = [NSMutableArray array];
    NSMutableArray<NSString *> *sceneStates = [NSMutableArray array];
    NSMutableArray<NSString *> *geoErrors = [NSMutableArray array];
    @try {
      for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
        if ([scene isKindOfClass:[UIWindowScene class]]) [scenesFound addObject:(UIWindowScene *)scene];
      }
      // legacy 生命周期应用 connectedScenes 可能为空，从窗口反查场景
      if (scenesFound.count == 0) {
        for (UIWindow *window in [UIApplication sharedApplication].windows) {
          if (window.windowScene != nil && ![scenesFound containsObject:window.windowScene]) {
            [scenesFound addObject:window.windowScene];
          }
        }
      }
      for (UIWindowScene *scene in scenesFound) {
        NSString *stateName = scene.activationState == UISceneActivationStateForegroundActive ? @"active"
          : scene.activationState == UISceneActivationStateForegroundInactive ? @"inactive"
          : scene.activationState == UISceneActivationStateBackground ? @"background" : @"unattached";
        [sceneStates addObject:[NSString stringWithFormat:@"%@(%@)", NSStringFromClass([scene class]), stateName]];
      }
      [UIViewController attemptRotationToDeviceOrientation];
      [applied addObject:@"attemptRotation"];
      if (@available(iOS 16.0, *)) {
        UIInterfaceOrientationMask mask = landscape ? UIInterfaceOrientationMaskLandscape : UIInterfaceOrientationMaskPortrait;
        UIWindowSceneGeometryPreferencesIOS *prefs =
          [[UIWindowSceneGeometryPreferencesIOS alloc] initWithInterfaceOrientations:mask];
        for (UIWindowScene *scene in scenesFound) {
          [scene requestGeometryUpdateWithPreferences:prefs errorHandler:^(NSError *geoError) {
            dispatch_async(dispatch_get_main_queue(), ^{
              [geoErrors addObject:geoError.localizedDescription ?: @"unknown"];
            });
          }];
        }
        [applied addObject:[NSString stringWithFormat:@"requestGeometryUpdate(scenes=%lu)", (unsigned long)scenesFound.count]];
      } else {
        error = @"iOS < 16: no headless rotation channel";
      }
    } @catch (NSException *exception) {
      error = [NSString stringWithFormat:@"%@: %@", exception.name, exception.reason];
    }
    // 延迟 2s resolve：带回实际 interfaceOrientation 与异步 geoErrors，
    // JS 侧断言文本即可判别「请求未送达 / 送达但场景拒绝 / 已生效」
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      NSString *orientNow = nil;
      UIWindowScene *scene0 = scenesFound.firstObject;
      if (scene0 != nil) {
        orientNow = UIInterfaceOrientationIsLandscape(scene0.interfaceOrientation) ? @"landscape" : @"portrait";
      }
      resolve(@{
        @"ok": @(error == nil),
        @"applied": applied,
        @"error": error ?: (id)[NSNull null],
        @"sceneStates": sceneStates,
        @"geoErrors": geoErrors,
        @"interfaceOrientationAfter2s": orientNow ?: (id)[NSNull null],
      });
    });
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

// 转场稳定参数（任务 9.4）：预算需覆盖 RN Modal fade 退场（约 0.3s）加数轮重试
static const NSTimeInterval kLXPickerWaitInterval = 0.15;
static const NSTimeInterval kLXPickerPresentBudget = 3.0;
static const NSTimeInterval kLXPickerAliveDelay = 0.25;
static const NSTimeInterval kLXPickerCompletionWatchdog = 0.8;

// 与 Android 契约对齐：取消时 resolve(null)；给定 toPath 时拷贝到 toPath/原文件名，
// 返回 { data: 目标路径, ...文件信息 }。
// 任务 9.4：真机（iPhone 17 Pro / iOS 26.6）自定义源本地导入无反应——
// Menu.tsx menuPress 先触发 onPress（selectFile）再 onHide()（菜单 Modal
// 退场），两条命令同拍到达原生主队列；旧实现把选择器直接 present 到正在
// 退场的 VC 上，UIKit 静默吞掉呈现：无 delegate 回调、无报错，Promise 永挂。
// 改为等视图层级稳定后再呈现 + 呈现后存活校验 + 被吞重试，预算耗尽必须
// 走 reject 通道（JS 侧 ChoosePath 已有回退内置浏览器弹窗），不许静默挂起。
RCT_EXPORT_METHOD(selectFile:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSArray<NSString *> *documentTypes = [self documentTypesFromOptions:options];
  NSString *toPath = nil;
  if ([options isKindOfClass:[NSDictionary class]] && [options[@"toPath"] isKindOfClass:[NSString class]]) toPath = options[@"toPath"];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self presentDocumentPickerWithTypes:documentTypes toPath:toPath resolver:resolve rejecter:reject];
  });
}

- (NSArray<NSString *> *)documentTypesFromOptions:(NSDictionary *)options
{
  NSArray *extTypes = nil;
  if ([options isKindOfClass:[NSDictionary class]] && [options[@"extTypes"] isKindOfClass:[NSArray class]]) extTypes = options[@"extTypes"];
  NSMutableArray<NSString *> *documentTypes = [NSMutableArray array];
  for (id ext in extTypes) {
    if ([ext isKindOfClass:[NSString class]] && [ext length] > 0) {
      NSString *uti = [self utiForExtension:ext];
      if (![documentTypes containsObject:uti]) [documentTypes addObject:uti];
    }
  }
  if (documentTypes.count == 0) [documentTypes addObject:(__bridge NSString *)kUTTypeItem];
  return documentTypes;
}

// 稳定顶层 VC：presentedViewController 链上任一节点处于转场中（呈现/退场
// 动画未结束）即返回 nil，由调用方重试；keyWindow 优先（RNN legacy 生命
// 周期下 delegate.window 仍在），逐层上溯到最顶层
- (UIViewController *)lx_stableTopViewController
{
  UIWindow *window = nil;
  for (UIWindow *w in [UIApplication sharedApplication].windows) {
    if (w.isKeyWindow) { window = w; break; }
  }
  if (window == nil) window = [UIApplication sharedApplication].delegate.window;
  UIViewController *vc = window.rootViewController;
  while (vc != nil) {
    if (vc.isBeingPresented || vc.isBeingDismissed || vc.isMovingFromParentViewController || vc.isMovingToParentViewController) return nil;
    if (vc.presentedViewController == nil) return vc;
    vc = vc.presentedViewController;
  }
  return nil;
}

- (void)presentDocumentPickerWithTypes:(NSArray<NSString *> *)documentTypes
                                toPath:(NSString *)toPath
                              resolver:(RCTPromiseResolveBlock)resolve
                              rejecter:(RCTPromiseRejectBlock)reject
{
  if (self.selectFileResolve != nil) {
    // 上一个选择器仍在显示，按取消处理
    self.selectFileResolve([NSNull null]);
  }
  self.selectFileResolve = resolve;
  self.selectFileToPath = toPath;
  self.selectFilePicker = nil;
  self.selectFilePresentAttempts = 0;
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kLXPickerPresentBudget];
  [self attemptPresentPickerWithTypes:documentTypes deadline:deadline onFinish:^(NSString *error) {
    if (error == nil) return;
    // 预算耗尽：清状态并走 reject；JS 侧 ChoosePath 已有回退弹窗，不许静默挂起
    [self clearSelectFileState];
    reject(@"picker_present_failed", error, nil);
  }];
}

- (void)attemptPresentPickerWithTypes:(NSArray<NSString *> *)documentTypes
                             deadline:(NSDate *)deadline
                             onFinish:(void (^)(NSString *error))onFinish
{
  self.selectFilePresentAttempts += 1;
  UIViewController *top = [self lx_stableTopViewController];
  if (top == nil) {
    if ([deadline timeIntervalSinceNow] <= 0) {
      onFinish(@"no stable view controller within budget (modal transition never settled)");
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLXPickerWaitInterval * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self attemptPresentPickerWithTypes:documentTypes deadline:deadline onFinish:onFinish];
    });
    return;
  }
  UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initWithDocumentTypes:documentTypes inMode:UIDocumentPickerModeImport];
  picker.delegate = self;
  self.selectFilePicker = picker;
  __block BOOL completionFired = NO;
  __weak typeof(self) weakSelf = self;
  [top presentViewController:picker animated:YES completion:^{
    completionFired = YES;
    // completion 不等于存活：被并发退场吞掉时 completion 照样回调，picker 随后被收走
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLXPickerAliveDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      __strong typeof(weakSelf) self = weakSelf;
      if (self == nil) return;
      BOOL alive = picker.presentingViewController != nil && picker.view.window != nil;
      if (alive) {
        onFinish(nil);
        return;
      }
      if ([deadline timeIntervalSinceNow] <= 0) {
        onFinish(@"picker presented but swallowed by concurrent dismiss");
        return;
      }
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLXPickerWaitInterval * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self attemptPresentPickerWithTypes:documentTypes deadline:deadline onFinish:onFinish];
      });
    });
  }];
  // completion 看门狗：目标 VC 已不在窗口层级时 UIKit 根本不回调 completion，
  // 没有看门狗重试链会停在这里，成为另一处静默挂起
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLXPickerCompletionWatchdog * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    __strong typeof(weakSelf) self = weakSelf;
    if (self == nil || completionFired) return;
    if ([deadline timeIntervalSinceNow] <= 0) {
      onFinish(@"present completion never fired within watchdog");
      return;
    }
    [self attemptPresentPickerWithTypes:documentTypes deadline:deadline onFinish:onFinish];
  });
}

- (void)clearSelectFileState
{
  self.selectFileResolve = nil;
  self.selectFileToPath = nil;
  self.selectFilePicker = nil;
}

// CI 自测（任务 9.4）：无头复现「下拉退场与 selectFile 呈现同拍」。从稳定
// 顶层 VC 呈现临时 VC，动画完成后同一主队列拍内先退场、再走生产入口
// selectFile（退场先行是确定性时序，等价两条命令同拍到达主队列时退场先
// 被处理的一支；JS 侧 Menu.tsx menuPress 的 onPress → onHide 即此结构）。
// 旧式直接呈现会把选择器落在正在退场的临时 VC 上被 UIKit 吞掉：无回调、
// Promise 永挂，轮询到截止判负；修复后的管线等层级稳定再呈现，必须判活。
// 探针走生产入口 selectFile 而非内部管线，回退旧实现时必然红。
// 双保险门控：仅沙箱存在 .lx-ci-selftest 标记时生效，正式包恒拒绝。
RCT_EXPORT_METHOD(selectFileRaceProbe:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) {
    reject(@"not_allowed", @"selectFileRaceProbe requires the CI self-test marker", nil);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *top = [self lx_stableTopViewController];
    if (top == nil) {
      resolve(@{ @"presented": @(NO), @"attempts": @0, @"elapsedMs": @0, @"error": @"no stable top view controller to stage race" });
      return;
    }
    NSTimeInterval t0 = [NSDate date].timeIntervalSince1970;
    UIViewController *transient = [[UIViewController alloc] init];
    transient.modalPresentationStyle = UIModalPresentationFullScreen;
    transient.view.backgroundColor = [UIColor clearColor];
    __weak typeof(self) weakSelf = self;
    [top presentViewController:transient animated:YES completion:^{
      __strong typeof(weakSelf) self = weakSelf;
      if (self == nil) return;
      // 同一拍：先退场临时 VC，再走生产入口（复刻 onPress 与 onHide 同拍）
      [transient dismissViewControllerAnimated:YES completion:nil];
      self.raceProbeRejectReason = nil;
      RCTPromiseResolveBlock swallowResolve = ^(id result) {
        // cancelDocumentPicker 等价用户取消时走这里；探针只判「是否呈现过」
      };
      RCTPromiseRejectBlock swallowReject = ^(NSString *code, NSString *message, NSError *err) {
        // 预算耗尽：记下原因，轮询分支读走判负
        self.raceProbeRejectReason = message ?: code;
      };
      [self selectFile:options resolver:swallowResolve rejecter:swallowReject];
      [self pollRaceProbeResultFrom:t0 resolve:resolve];
    }];
  });
}

- (void)pollRaceProbeResultFrom:(NSTimeInterval)t0 resolve:(RCTPromiseResolveBlock)resolve
{
  NSTimeInterval deadline = t0 + kLXPickerPresentBudget + 1.5;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    UIDocumentPickerViewController *picker = self.selectFilePicker;
    BOOL alive = picker != nil && picker.presentingViewController != nil && picker.view.window != nil;
    NSTimeInterval elapsedMs = ([NSDate date].timeIntervalSince1970 - t0) * 1000.0;
    if (alive) {
      resolve(@{ @"presented": @(YES), @"attempts": @(self.selectFilePresentAttempts), @"elapsedMs": @(elapsedMs), @"error": [NSNull null] });
      return;
    }
    if (self.raceProbeRejectReason != nil) {
      resolve(@{ @"presented": @(NO), @"attempts": @(self.selectFilePresentAttempts), @"elapsedMs": @(elapsedMs), @"error": self.raceProbeRejectReason });
      self.raceProbeRejectReason = nil;
      return;
    }
    if ([NSDate date].timeIntervalSince1970 >= deadline) {
      resolve(@{ @"presented": @(NO), @"attempts": @(self.selectFilePresentAttempts), @"elapsedMs": @(elapsedMs), @"error": @"poll deadline reached without alive picker or reject" });
      return;
    }
    [self pollRaceProbeResultFrom:t0 resolve:resolve];
  });
}

// CI 自测（任务 9.4）：无头环境没有用户点选文件，竞态探针判活后用本方法
// 关闭选择器（等价用户取消：resolve(null)，与 documentPickerWasCancelled
// 同一通道）。双保险门控：仅沙箱存在 .lx-ci-selftest 标记时生效。
RCT_EXPORT_METHOD(cancelDocumentPicker:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *tmp = NSTemporaryDirectory();
  NSString *marker = [tmp stringByAppendingPathComponent:@".lx-ci-selftest"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:marker]) {
    reject(@"not_allowed", @"cancelDocumentPicker requires the CI self-test marker", nil);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIDocumentPickerViewController *picker = self.selectFilePicker;
    BOOL hadPicker = picker != nil && (picker.presentingViewController != nil || picker.view.window != nil);
    if (picker != nil && picker.presentingViewController != nil) {
      picker.delegate = nil; // 程序化关闭不应再触发 delegate 回调
      [picker dismissViewControllerAnimated:NO completion:nil];
    }
    RCTPromiseResolveBlock stored = self.selectFileResolve;
    [self clearSelectFileState];
    if (stored != nil) stored([NSNull null]);
    resolve(@{ @"hadPicker": @(hadPicker), @"resolved": @(stored != nil) });
  });
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
