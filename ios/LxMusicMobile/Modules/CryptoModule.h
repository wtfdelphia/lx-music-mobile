#import <React/RCTBridgeModule.h>

// iOS 加密模块薄封装（任务 3.4 / design D2）：
// 经纯 C ABI 调用 lxcore-crypto (Rust staticlib)，契约与黄金基准
// 见 rust/lxcore/lxcore-crypto 与 test/crypto-golden-vectors.json。
@interface CryptoModule : NSObject <RCTBridgeModule>
@end
