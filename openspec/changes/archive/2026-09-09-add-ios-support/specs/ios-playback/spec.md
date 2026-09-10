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

CI 冒烟 SHALL 包含 `remote_stream_playback` 自测，采用两段独立判别（修复落地前不以远程 URL 触碰生产队列，失败只影响本用例）：A 段媒体通道 ATS——`avStreamProbe` 打外网 `http` 端点，`atsMediaProbe.errorCode` SHALL 不为 `-1022`（外网不可达只会落 `timeout`/传输层错误码，不产生 `-1022` 误报）；B 段远程流可装载性——`avStreamProbe` 打宿主 loopback 流（模拟器与宿主共享网络栈、零外网），SHALL 返回 `ready`。裸 AVPlayer 独立实例 + 原生侧 6s 截止。CI 环境宿主恒起 loopback，该用例的跳过（`skipped`，仅 loopback 不可达）SHALL 被宿主断言端判失败；本地手跑允许跳过但须可判读。

#### Scenario: CI 远程流装载证据

- **WHEN** CI 冒烟套件运行到播放段
- **THEN** `remote_stream_playback` 报告 `atsMediaProbe.errorCode != -1022` 且 `streamProbe.status == ready`

### Requirement: 切歌队列索引对齐

切歌后裁剪旧轨道时，原生播放队列与 JS 轨道列表（`playList.list`）SHALL 保持索引对齐。裁剪旧轨的删除索引序列 SHALL 为降序（先删高索引）——iOS `QueueManager.removeItem` 每删一个低于 `currentIndex` 的项即把 `currentIndex` 减 1，升序删除会使待删索引漂移撞上「不许删当前项」守卫被静默跳过，导致原生队列残留旧轨而 JS 列表按删净裁剪，从第二首歌起索引永久错位、`getCurrentTrack` 返回 `default` 静音轨并触发循环切歌。

#### Scenario: 双曲目切换后队列对齐

- **WHEN** 在已播放一首歌的队列上切换到下一首歌
- **THEN** 裁剪完成后原生播放队列恰为 2 项（新轨 + 其 `default` 轨），`getCurrentTrack` 返回目标真实轨（url 与 id 双判），位置推进

### Requirement: 队列手术事件隔离

fork 的 iOS `QueuedAudioPlayer.stop()` 清空队列并无条件发射 `queueIndex` 事件，`QueueManager.removeItem` 每次索引漂移逐件发射，两类事件形状与自然播放结束无法区分。任何队列手术（`handlePlayMusic` 的 add/skip/remove、`initTrackInfo` 的 add/skip、`setStop`）SHALL 在首个原生操作前置位手术守卫，全部原生操作落地后释放；守卫期内 `PlaybackTrackChanged` 处理器 SHALL 只同步当前轨 id，不得把「当前轨为 `default` 兜底轨或空队列」判为播放结束。守卫释放 SHALL 采用令牌语义：释放只认领取时的令牌，旧手术的延迟释放不得覆盖新手术窗口；手术中途失败亦须释放，不得永久吞掉播完判定。Android 侧两类手术事件均为 `prevIndex/track=null` 形状、本被 `info.track == null` 分支过滤，守卫对 Android SHALL 是恒不生效的无操作。

`setStop` 在 iOS 上 SHALL 同步清空 JS 轨道镜像（原生队列已被 `stop()` 清空，镜像残留旧轨会导致下次 add 后索引错位），且不得在空队列上调用 `skipToNext`（原生 `noNextItem` 守卫 reject 会打断 `handlePlay` 的 await，后续歌曲永远拿不到 URL）；Android 上队列不清空，`skipToNext` 跳 `default` 轨的行为 SHALL 保持不变。

#### Scenario: 点击歌曲不再瞬间循环切歌

- **WHEN** 在播放列表/排行中点击一首歌（触发 `handlePlay` → `setStop` → 取链 → 队列重建）
- **THEN** 队列手术期间不触发 `playerEnded`/`playNext`，目标歌取链落地后正常起播；不出现快速循环切歌

### Requirement: 播放器销毁不触发自动切歌

`destroy()`（退出应用、定时退出等路径）内部经 `player.stop()` 清空队列，逐件发射的 `PlaybackTrackChanged` 事件形状与自然播放结束一致。`destroy()` SHALL 在首个原生操作前置位队列手术守卫，且本地不释放——`stop()` 事件经桥异步投递，可能晚于 `destroy()` resolve 才到，立即释放会漏接；守卫由下一次队列手术（`handlePlayMusic`/`initTrackInfo`/`setStop`）的令牌释放兜住。`destroy()` SHALL 同步清空 JS 轨道镜像（同 `setStop` 口径）。

#### Scenario: 退出应用后后台不再切歌播放

- **WHEN** 播放中点击「退出应用」（`core/common.ts` `exitApp` → `destroy()` → 挂起）
- **THEN** 销毁过程不触发 `playerEnded`/`playNext`，播放器不重新初始化、不自动起播；挂起后无音频残留

#### Scenario: CI 冒烟套件不被队列手术卡死

- **WHEN** CI 冒烟运行 `queue_trim_switch` 等触碰队列裁剪的用例
- **THEN** 用例不因手术事件的误判播完而级联超时，后续用例正常完成

### Requirement: 下一首预载不得占用请求通道

预载下一首链接是纯优化旁路，SHALL NOT 因源缓慢或不可达而占用请求通道影响当前播放。整轮预载（取链 + 可用性校验 + 换源重取）SHALL 受单一硬超时约束并在超时后短路放弃——`getMusicUrl` 会串行试换源、`checkUrl` 默认超时 15s，二者叠加时单轮可挂数十秒，期间 RN 桥被占用会使前台播放/切歌调用一并变慢。预载失败 SHALL 静默放弃（下一首改为播放时现取），不得向上传播错误。

#### Scenario: 源不可达时预载不拖累时间预算

- **WHEN** 播放接近结束触发预载，而取链目标不可达
- **THEN** 该轮预载在硬超时内结束并放弃，当前播放与后续切歌调用的响应不因此延长

### Requirement: 锁屏面板进度锚点

锁屏/控制中心面板的进度渲染依赖 `MPNowPlayingInfoCenter` 的 `elapsedPlaybackTime`（锚点）与 `playbackRate`（外推斜率）两键。应用经 `setupPlayer` 传 `autoUpdateMetadata: false`（歌词走标题通道接管元数据，任务 5.4），关闭了 SwiftAudioEx 唯一写这对键的自动通道；JS 侧元数据写入又从不带这两键。iOS 原生侧 SHALL 在播放状态翻转（playing/paused/buffering）、seek、变速时写入进度锚点：播放中写实际速率与当前位置，暂停写速率 0 与暂停点，seek 写目标值（异步 seek 期间 `currentTime` 仍是旧位置）。速率键在暂停时 SHALL 为 0，使面板在暂停期间不外推进度。标题/歌手/封面仍由 JS 侧元数据写入；锚点写入与元数据写入同走 `NowPlayingInfoController` 全量提交，锚点两键不得因后续元数据写入而丢失。本契约仅作用于 iOS 原生实例，SHALL NOT 改变 Android 行为。

#### Scenario: 锁屏暂停进度不清零

- **WHEN** 播放中锁屏暂停，随后继续播放
- **THEN** 锁屏面板进度从实际播放位置继续，不从 0 重新计时；Now Playing 的 `elapsedPlaybackTime` 在暂停与恢复时分别为暂停点与恢复点

#### Scenario: 暂停期间面板进度不外推

- **WHEN** 播放处于暂停状态
- **THEN** Now Playing 的 `playbackRate` 键为 0，锁屏面板进度保持冻结
