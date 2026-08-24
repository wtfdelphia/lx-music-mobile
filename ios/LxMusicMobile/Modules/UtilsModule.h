#import <React/RCTEventEmitter.h>

// iOS 侧 UtilsModule：与 Android UtilsModule 的 JS 面语义对齐（任务 1.3）。
// exitApp 桩化（iOS 不允许主动退出）；电池优化类方法恒返回 true。
@interface UtilsModule : RCTEventEmitter <RCTBridgeModule>
@end
