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
