## Purpose

在 iOS 上提供可用的在线播放体验：后台不中断、锁屏可控，缓存能力按平台现实降级。

## ADDED Requirements

### Requirement: 后台播放

App 切后台后音频 SHALL 不中断（音频后台模式 + 播放器 iOS 类别配置生效）。

#### Scenario: 切后台出声

- **WHEN** 播放中按 Home 键或锁屏
- **THEN** 音频继续播放

### Requirement: 锁屏控制

锁屏界面 SHALL 显示歌名与封面，播放/暂停/上下曲可用，标题随歌词更新。

#### Scenario: 锁屏切歌

- **WHEN** 锁屏状态下操作播放控件
- **THEN** 对应操作生效且元数据正确显示

### Requirement: 缓存能力降级

`getCacheSize`、`clearCache`、`isCached` 在 iOS 首版 SHALL 可安全调用（允许降级为 0 / false），不得崩溃或抛出未处理异常。

#### Scenario: 设置页缓存管理

- **WHEN** 在设置页查看/清理缓存、触发 `preloadNextMusic`
- **THEN** 不报错，流程正常结束

### Requirement: 播放装载失败归因面

播放装载失败 SHALL 落错误日志，不得静默：`PlaybackError` 事件与自定义源取链超时/失败 SHALL 带轨道 URL、action/source 与错误原文写入错误日志；对 `http(s)` 轨道的装载失败 SHALL 触发媒体通道原生探针（裸 AVPlayer 重装载同一 URL，带回 NSError domain/code），探针结论 `[av stream probe]` 写入同一份错误日志。媒体通道 ATS 判别的错误码 `-1022`（`AVFoundationErrorDomain` 外层包裹时从 `NSUnderlyingErrorKey` 内层提取）是媒体通道被拦截的确定性信号。

#### Scenario: 真机播放失败可归因

- **WHEN** 真机播放装载失败
- **THEN** 「设置-错误日志」含 `[player] playback-error` 行（带轨道 URL）与 `[av stream probe]` 媒体通道装载结论

### Requirement: 远程流装载运行时证据

CI 冒烟 SHALL 包含 `remote_stream_playback` 自测：宿主起 loopback HTTP（Range 支持）服务投递夹具，应用经生产同一链路（`setResource` → `TrackPlayer.add` → AVPlayer）装载远程流并硬断言位置推进；`atsMediaProbe.errorCode` SHALL 不为 `-1022`。CI 环境宿主恒起 loopback，该用例的跳过（`skipped`）SHALL 被宿主断言端判失败；本地手跑允许跳过但须可判读。

#### Scenario: CI 远程流装载证据

- **WHEN** CI 冒烟套件运行到播放段
- **THEN** `remote_stream_playback` 经 `127.0.0.1` loopback 完成远程流装载且位置推进，报告 `atsMediaProbe.errorCode != -1022`
