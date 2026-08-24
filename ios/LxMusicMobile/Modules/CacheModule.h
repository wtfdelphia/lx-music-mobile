#import <React/RCTBridgeModule.h>

// 应用缓存管理（任务 5.6）：统计/清理 Caches 目录。
// 与 Android 一致，getAppCacheSize 以字符串字节数返回。
@interface CacheModule : NSObject <RCTBridgeModule>
@end
