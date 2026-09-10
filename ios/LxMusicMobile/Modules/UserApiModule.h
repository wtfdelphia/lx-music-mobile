#import <React/RCTEventEmitter.h>

// 自定义源沙箱（任务 4.1-4.3 / design D3）：JavaScriptCore 复刻
// Android QuickJS 侧注入契约（7 个 __lx_native_call__* + console +
// lx_setup + __lx_native__ 反向通道 + set_timeout），事件面 'api-action'。
@interface UserApiModule : RCTEventEmitter <RCTBridgeModule>
@end
