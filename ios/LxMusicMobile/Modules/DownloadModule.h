#import <React/RCTEventEmitter.h>

// 下载传输层 RN 外壳（add-ios-download §4.1）。只做两件事：
// 转发 JS 调用到 LxDownloadManager；把 manager 事件转成
// `LxDownloadEvent` 事件发给 JS。取链接、重试、排队均在 JS 侧。
@interface DownloadModule : RCTEventEmitter <RCTBridgeModule>
@end
