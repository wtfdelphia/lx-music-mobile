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
| 11 | 本仓库真机反馈（2026-09-01，iPhone 17 Pro / iOS 26.6） | 已修复（任务 9.4） | 自定义源本地导入无反应。根因与系统版本无关，是 UIKit 呈现时序缺陷：导入下拉（RN Modal）关闭命令与 `selectFile` 呈现命令同拍进入原生主队列，`UIDocumentPickerViewController` 被 present 到正在退场的 VC 上，UIKit 静默吞掉呈现，无回调无报错、Promise 永挂。修法：原生侧等视图层级稳定再呈现 + 存活校验重试 + 预算耗尽走 reject，配标记门控竞态探针（`file_picker_race` 自测）。同类时序问题对所有「弹窗内触发系统选择器」入口通用。附记：无头模拟器上不能真呈现 `UIDocumentPickerViewController`（run 33498023646 实锤：DocumentProvider XPC 通道不可靠，呈现 completion 不回调，残留连接在横屏旋转时经 `DOCWeakProxy` 崩进程），竞态探针改用普通 VC 走同一呈现管线验证修复机制，真选择器行为留给真机复测 |
| 12 | 本仓库真机反馈（2026-09-02，iPhone 17 Pro / iOS 26.6） | 根因确认（任务 9.5 → 9.6 → 9.7） | 自定义源本地导入已确认修复生效；切换小枸音乐等源的排行榜加载失败，播放快速循环切歌。两条链路公共依赖 `global.fetch`，该管线在 iOS 上从无运行时证据（CI 出口到音源域名不可达，回归集只测加载→inited）。本地实证排除两条嫌疑：音源端点存活（kw `bang_info` 用本仓库加密契约实测返回 200 并解出完整歌曲列表、tx/mg 榜单端点 200）、上游 `dev` 分支排行榜实现与当前逐字相同（契约未换）。快速循环切歌的机制：取链接失败→5s `addDelayNextTimeout`→`playNext(true)`，秒级失败即秒级切。已补两处失败路径日志（`[request]`/`[userApi request]` 写 error.log）与两项零外网自测（`network_probe`：JSI md5/base64 黄金值 + AbortController/FileReader 全局 + file:// fetch 走生产同管线 + 外网端点软记录；`user_api_request_bridge`：沙箱 `lx.request` 经生产请求链 file:// 往返）。run 33609327722 自测报告给出首份运行时证据：同一管线 `file://` 200（94ms）而外网 `http://qukudata.kuwo.cn` 74ms 即时 `Network request failed`——故障精确落在「RN → NSURLSession 外网传输」段。排除的静态嫌疑：无 `NSURLProtocol` 注册、无 `RCTSetCustomNSURLSessionConfigurationProvider`、无 `global.fetch` 覆写、`NO_FLIPPER=1`。当时判断「ATS 已全放开」是错的——两键并存使 `NSAllowsArbitraryLoads` 被系统忽略，见案例 13 |
| 13 | 本仓库真机反馈（2026-09-02 续报，iPhone 17 Pro / iOS 26.6） | 根因确认并已修复（任务 9.6 → 9.7） | 星海音乐源（`zrcdy.dpdns.org/lx/xinghai-music-sourcev2.3.13.js`，脚本头 `@version v3.2.13`）无法搜索、无法播放。读脚本源码确认：`lx.request` 请求处理器只实现 `musicUrl`/`lyric`/`pic` 三个 action，其余抛「不支持的操作」；后端域名 `https://yy.zddyr.top`（fallback `zrcdy.dpdns.org`）全部 `https`。原生探针（任务 9.6）在 run 33626382403 拿到决定性证据：`http://qukudata.kuwo.cn` 经原生 `NSURLSession` 1ms 返回 `NSURLErrorDomain Code=-1022`（App Transport Security 拦截），同批 `https://yy.zddyr.top/ip.php` 与 `https://www.apple.com` 均 200，宿主侧 `curl` 三目标全 200——出口网络无恙，故障在应用配置。根因：`Info.plist` 的 `NSAppTransportSecurity` 同时写了 `NSAllowsArbitraryLoads=true` 与 `NSAllowsLocalNetworking=true`，Apple 文档规定两者并存时前者被系统忽略（`f3c79fe` 升 RN 0.73 时模板把两键都带进来）。内置源搜索、榜单、取链几乎全是明文 `http`（kw/kg/tx/wy/mg 的 `musicSdk` 与音频直链），被 -1022 全量拦截——完整解释搜索挂、榜单挂、播放秒级失败循环切歌。星海脚本自身全 `https`，其失败另有脚本侧原因（见任务 9.7 记录）。修法：`Info.plist` 移除 `NSAllowsLocalNetworking` 键，让 `NSAllowsArbitraryLoads=true` 实际生效；`network_probe` 对 `http` 探针的原生侧错误码加 `-1022` 硬断言（ATS 评估发生在 DNS/连接之前，是确定性本地信号，不依赖外网可达性）；`specs/ios-distribution` 补「ATS 明文请求放行」契约。判据：下一轮 CI 冒烟 `network_probe` 的 `http` 探针不再返回 -1022；真机复测内置源搜索/榜单/播放 |
| 14 | 本仓库真机反馈（2026-09-03，iPhone 17 Pro / iOS 26.6） | 归因面建设完成，待真机复测判读（任务 9.8） | 9.7 的 ATS 修复生效面实证：星海源搜索恢复（偶尔不稳），内置源 `http` 数据通道放行；播放仍全失败。归因收敛：故障落在「取链结果 → AVPlayer 装载」段——该段在 iOS 上零运行时证据（CI 播放自测只用 `file://` 夹具），且三个失败点全是静默的（`PlaybackError` 只进 `console.log`、自定义源取链超时/失败只进 `console.log`）。本机实证排除项：星海后端取链 8/8 全通（128k/320k/flac/hires 均可播直链）、播放直链 Range 206 `audio/mpeg`、应用传纯数字 songmid 契约正确、`user-api-preload.js` 对 `musicUrl` 的 `result.data.url` 封装与应用侧取值一致。三个互斥嫌疑无运行时证据前不可裁决：媒体通道 ATS 辖区差异（声明 `audio` 后台模式的应用，AVFoundation 媒体通道另由 `NSAllowsArbitraryLoadsForMedia` 管辖，数据通道放行不蕴含媒体通道放行；绝不盲加例外键——9.7 实证并存键会让 `NSAllowsArbitraryLoads` 整体被忽略）、脚本取链不稳（用户自述「偶尔也不行」）、fork 播放栈远程流装载缺陷。修法：三处静默点补日志（`PlaybackError` 带轨道 URL、`userApi` 超时/失败带 action/source 与脚本原文）；`UtilsModule.avStreamProbe` 媒体通道判别探针（裸 AVPlayer 装载同一 URL 带回 NSError，`AVFoundationErrorDomain` 外层包裹的 -1022 向内层提取，无标记门控真机可用）；`PlaybackError` 对 `http(s)` 轨道联动发射媒体通道探针（`[av stream probe]` 行落错误日志）；新增 `remote_stream_playback` 自测（宿主 loopback Range 媒体服务 `test/range-http-server.py`，模拟器与宿主共享网络栈，硬断言「远程 `http` URL → 生产同链路装载 → 位置推进」；两级端点都不可达才落 `skipped`，宿主断言端对 CI 上的 `skipped` 判失败）。判据：下一轮冒烟 `remote_stream_playback` PASS 且 `atsMediaProbe.errorCode != -1022`；真机复测读错误日志 `[player] playback-error` / `[av stream probe]` / `[userApi]` 行三叉归因——-1022 补 `NSAllowsArbitraryLoadsForMedia`（先评估并存键影响）、非 -1022 装载失败归因传输/解码层、取链失败归因脚本侧 |
| 15 | 本仓库 CI 冒烟（run 33750828518，2026-09-03） | 实锤：fork 播放栈远程项装载卡滞（任务 9.9 另立 change） | 9.8 新增的 `remote_stream_playback` 硬门禁用例把远程流经生产队列装载链，首跑即复现。证据链：range-server 收到 5 个 `206` Range 请求（AVPlayer 确实在拉环回流；整轮无 `-1022`，媒体通道 ATS 放行）；`playbackStates` 在 22.9s 爆发 `loading→buffering→playing→ready→paused→idle` 后永久静默——正是远程轨道经 `add`/`skip` 进原生装载的时刻；队列切换断言 30s 内从未成立；此后全应用节流，进程全程 `PID_ALIVE` 无崩溃：tab 标记从 2 分钟一个恶化到 180s TIMEOUT、`bg-ready` 从未出现、`drawer_menu` 的 120s 预算烧 500s 墙钟、45min 套件 watchdog 未开火，套件只跑 22/30。与案例 1/4 的 SwiftAudioEx 同步装载路径模式吻合——真机「不能播放」嫌疑链首次拿到模拟器运行时证据。附带发现并修复：`test/range-http-server.py` 有界 Range 206 未截断复制长度，HTTP 帧违规（BrokenPipe 重试循环）。处置：fork 修复属播放链路高风险变更另立 change（任务 9.9）；落地前用例改两段独立判别、不再以远程 URL 触碰生产队列（ATS 媒体通道探针 + 裸 AVPlayer 可装载性），失败只影响本用例；`avStreamProbe` 截止 12s→6s、探针实例显式释放防拥塞叠加。判据：下一轮冒烟 `remote_stream_playback` 两段判别可判读、套件 30/30 完成且无节流 |

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
