#import <React/RCTBridgeModule.h>

// gzip 互通（任务 6.1）：libz，windowBits=31（gzip 容器），
// 契约复刻 react-native-file-system fork 的 Java 实现，
// 与 Android 双向可读（.lxmc 备份等）。
@interface GzipModule : NSObject <RCTBridgeModule>
@end
