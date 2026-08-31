# iOS 26 上游适配态势与本仓库影响评估

变更：add-ios-support
调研日期：2026-08-31 · 分支 `dev-ios`
来源：GitHub issue / PR / release 检索（具体编号见各条目），2026-05 至 2026-08 窗口

## 背景

冒烟全绿后，剩余 9 项全部是真机/外网手测。真机验证的目标设备可能是
iPhone 17 Pro（出厂系统即 iOS 26，无法降级），因此把上游各依赖在
iOS 26 上的已知问题摸了一遍，对照本仓库代码路径判断影响面。

## 案例清单

| 编号 | 仓库/issue | 状态 | 内容 |
|---|---|---|---|
| 1 | `doublesymmetry/SwiftAudioEx#105` | open（2026-07-17） | iOS 26 播放直播流（ICY/SHOUTcast，无限时长）整个 App 主线程卡死约 20s，卡死期间切后台被系统杀（0x8BADF00D）。根因：加载完成回调里读 `pendingAsset.duration` 前未做异步加载，未加载属性的 getter 触发主线程同步 XPC 查询，iOS 26 对无限时长流的回答要等内部约 20s 超时 |
| 2 | `doublesymmetry/SwiftAudioEx#106` | open，未合并 | #105 的修复。要点：元数据回调必须先 `loadValuesAsynchronously` 再读属性 |
| 3 | `doublesymmetry/SwiftAudioEx#104` | open | `AVPlayerWrapper.state` setter 在 `stateQueue` barrier 块内调 delegate，与主线程的 KVO 读互相阻塞，缓冲负载下主线程卡数秒 |
| 4 | `doublesymmetry/SwiftAudioEx#93` | open（2025-01） | 未加载属性同步查询阻塞主线程，HTTP 慢网场景必现。#105 是它在 iOS 26 上的放大版 |
| 5 | `doublesymmetry/react-native-track-player#2659` | open | iOS 26.3.1（iPhone 13 Pro）`Track.getArtwork` 桥接 URL 时崩溃，畸形/空/非预期 artwork 值触发 |
| 6 | `doublesymmetry/react-native-track-player#2664`、`#2666` | open | iOS 26 锁屏远程控制中心布局与配置不符；锁屏时长只在播放或 seek 后才更新 |
| 7 | `wix/react-native-navigation#8203` | open（25 评论） | iOS 26 上 bottomTabs 的 backgroundColor / drawBehind 全部失效。RNN 8.7.0 + RN 0.83.1 + Fabric 最新版仍复现 |
| 8 | `react-native-track-player` releases | v5.0.0（2026-05-06） | v5 基于新架构完全重写并转商业授权（个人/教育用途免费，商用付费）。v4 冻结在 `v4` 分支，不再更新 |
| 9 | `reactwg/react-native-releases#1258-1263` | 多数 closed | Xcode 26.4 构建修复官方 backport 到 0.81-0.85。RN 主线当前最新 0.87.1（2026-08-26） |
| 10 | `markclausing/vibecoach` PR #26（merged）、`Wulfgardr/mediflow#141`（open）、`isledecomp/isle-portable` PR #857 | 修复已合并 / 实锤 | iPhone 17 Pro 上，只声明 `UILaunchStoryboardName`（无 `UILaunchScreen` 键）的旧构建被 iOS 26 判为不支持现代屏幕尺寸，进 legacy 兼容模式：窗口按旧比例缩放，上下黑边、内容整体放大。修法统一为 Info.plist 补空 `UILaunchScreen` 字典 |

## 与本仓库的对照（逐条核过代码路径）

本仓库播放栈为 `lyswhut/react-native-track-player@d4a062f`（v2.1.2
fork）+ `SwiftAudioEx 0.14.7`，导航为 `react-native-navigation 7.39.2`，
RN `0.73.11`。

案例 1/2/4（主线程同步属性查询）：0.14.7 的 `AVPlayerWrapper.load` 走
`loadValuesAsynchronously(forKeys: ["playable"])` 只预加载 `playable`，
元数据回调（`AVPlayerWrapper.swift:221`）里 `availableMetadataFormats` 与
`metadata(forFormat:)` 仍是同步读取；`AVPlayerWrapper.duration` 直接读
`currentItem?.asset.duration.seconds`。两处都是 #93/#105 点名的模式。
0.14.7 没有 chapter 扫描代码（已确认源码），所以 #105 的直播流 20s 挂起
不会原样复现，但同款同步查询在慢网在线流上存在同类风险。
`playList.ts` 的 `updateMetaData` 在播放早期调用 `TrackPlayer.getDuration()`，
会踩到这条路径。本地文件资产已加载，不受影响。

案例 5（getArtwork 崩溃）：本仓库 `Track.getArtwork` 与上游同款实现
（本地 `UIImage(contentsOfFile:)`、远程 URLSession 分支）。CI 用例用
`picUrl: null` 与本地 `file://` 路径，畸形远程 URL 分支从未跑到过。

案例 6（锁屏行为）：任务 5.3 正待真机手测，手测时这两条是预期可见差异。

案例 7（bottomTabs 样式）：本仓库主导航就是 bottomTabs。模拟器冒烟在
18.5 上四 Tab 截图互异且无红屏，不能外推到 26。真机 17 Pro 验证 7.4 时
要把它算进预期差异。

案例 8（供给链）：上游免费修复通道已断。本仓库播放栈的 iOS 26 相关
修复只能自行 cherry-pick 或自写补丁。

案例 9（Xcode 26 构建）：`docs/ios-multi-version-plan.md` B 轨（用
Xcode 26 SDK 构建）的 RN 版本下限有依据了：官方修复最远到 0.81，
当前 0.73.11 距离更远。该文档「需升 RN 大版本」的判断可以具体化为
「至少 0.81」。

案例 10（legacy 兼容模式 letterbox）：本仓库 `Info.plist` 只有
`UILaunchStoryboardName = LaunchScreen`，无 `UILaunchScreen` 键
（RN 0.73 模板同款写法）。iPhone 17 Pro 真机反馈「竖屏宽窄都不对」
与此机制吻合：窗口被缩放到旧屏幕比例并居中，上下留黑边，RN 布局
按缩放后的窗口尺寸排版。修法：补空 `UILaunchScreen` 字典，已落地
（tasks.md 9.2）。注意该修复需经真机或 iOS 26 runtime 模拟器才能
验证，18.5 模拟器无此行为，CI 冒烟只能防回归不能证明修复。

## 结论

iOS 26 真机验证（如 iPhone 17 Pro / iOS 26.6）可以开展，但预期差异要
先立好归因口径，按 `docs/ios-multi-version-plan.md` §3.3 执行：把失败
归因到系统版本之前，先排除测试夹具、无头环境、fork 依赖自身缺陷。

按影响排序的三个行动项：

1. 真机验证时把「在线慢网流播放」列为专项，观察主线程卡死（对应案例
   1/4，成本低、概率高）。已并入手测清单。
2. 播放链路 `getDuration` 防御补丁（未加载时长返回 0 或回退
   `loadedTimeRanges`）：属播放链路高风险变更，须另立 change，不在本
   变更内实施。
3. 供给链事实（案例 8）写进长期规划：播放栈冻结在 v2.x fork，上游
   修复需自行 cherry-pick。已补进 design.md D5。
