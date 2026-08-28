# 播放位置读数根因：秒/毫秒单位错配（2026-08-28）

关联任务：5.2 后台续播、5.7 完整听完一首、7.4 横屏布局。

## 现象

多轮 CI 自测中 `playback` / `background_play` 稳定失败，表征为「播放状态
进入 playing，但媒体时钟几乎不推进」：

- `playback`：`pos=0.028394`、`player={"rate":1,"volume":1,"duration":0.09}`
- `background_play`：`before=0.068970 after=0.029516 restartSeeked=true`

此前据此推断为「时钟以 ~1/1000 速率爬升」，并加了 `rebuildPlayer()`
（让 AVPlayer 创建晚于 AVAudioSession 配置）作为修复尝试。

## 根因

读数被多除了一次 1000，时钟没有停摆。

夹具时长精确 90.0000s（WAV header：data chunk 7938000 ÷ byteRate 88200），
`getDuration` 报 0.09，恰好 1000 倍差。按此换算，全部观测自洽：

| 报告读数 | 实际值 |
|---|---|
| `pos=0.028394` | 28.4s |
| `before=0.068970` | 69.0s |
| `after=0.029516` | 29.5s（seek 到 0 后续播） |

播放链路一直正常工作。

传导路径：fork 的 JS 层 `lib/trackPlayer.js:350/363/376` 对
`getDuration` / `getBufferedPosition` / `getPosition` 一律 `/1000`，因为
Android 侧返回 ExoPlayer 毫秒（`MusicModule.java:479/506` 的 `long`）。
iOS 侧 `RNTrackPlayer.swift` 原样返回 SwiftAudioEx 的 `CMTime.seconds`
（`AVPlayerWrapper.swift:93-110`），已是秒，再除一次即缩小 1000 倍。

于是 `pos > 0.5`、`posAfter > posBefore + 0.5` 这类以秒书写的断言永不成立：
`background_play` 因此误入重启分支，seek 回 0 后等 `posAfter > 0.5`，
相当于要求 90s 夹具走到 500s，必然超时。

## 修复

在原生侧乘 1000（`patches/react-native-track-player+2.1.2.patch` 第 4 个
hunk），而非改 JS 层。改 JS 会连带变更 Android 行为，撞 `dev-ios` 分支的
non-goal。

`seekTo` 不在此列：两端本就都按秒（Android 侧 `MusicModule.java:398`
自行 `toMillis`），已核对无需改动。

`rebuildPlayer()` 的原始前提由此证伪，该函数不解决任何已知缺陷。保留仅因
「会话先于播放器」本身是更稳妥的顺序，移除需另跑一轮 CI 验证无回归。patch
内注释已记录这点。

## 判读边界

单位修复经 CI 编译验证，**播放位置读数是否恢复正确量级尚待下一轮 run
实测**。真机后台出声（5.2）与锁屏控制（5.3）不在模拟器可验范围，仍留手测。
