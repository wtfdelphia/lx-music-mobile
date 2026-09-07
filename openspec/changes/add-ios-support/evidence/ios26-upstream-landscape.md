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
| 16 | 本仓库真机反馈续报 + CI 复现（2026-09-04，iPhone 17 Pro / iOS 26.6；run 33750828518 同根因） | 已修复（任务 9.9） | 案例 15 预判的「fork 远程装载卡滞」被 run 33832272067 证伪：裸 AVPlayer 装环回流 212ms `ready`、外网探针得 `-11850`（非音频内容报错）而非 `-1022`——媒体通道 ATS 与 AVFoundation 装载路径均无罪。精读 `SwiftAudioEx 0.14.7`（`QueueManager.removeItem`/`jump`）与 fork 的 `RNTrackPlayer.remove`（`playbackStates` 在队列操作后爆发的 `playing→ready→paused→idle` 序列即 `currentItem` 被清空又重建的痕迹）后定位真因：`src/plugins/player/playList.ts` 的 `handlePlayMusic` 裁剪旧轨用升序索引 `remove([0,1,...])`——iOS 每删一个低于 `currentIndex` 的项就把 `currentIndex` 减 1，升序删到第二项时索引漂移命中原生「不许删当前项」守卫被静默跳过（`if index == player.currentIndex { continue }`），原生队列残留旧轨而 JS `list` 按删净 `splice`，从第二首歌起索引永久错位：`getCurrentTrack` 用原生 index 查 JS list 返回 `default` 静音轨，`isEmpty()` 恒真，`PlaybackTrackChanged` 触发暂停/切歌，取链错误重试 2 次后进 5s `delayNext`——「无法播放 + 快速循环切歌」的完整机制。Android 侧 `LocalPlayback.remove` 内部 `Collections.sort` 后倒序遍历，输入顺序无影响，故 iOS 专属；这也解释了同一播放代码在 Android 正常。CI 此前从未暴露：全部播放用例都是空队列单首，`queue.length > 2` 裁剪分支零触发（案例 15 的「队列未切换」实为错位后守卫跳删的另一种显形）。修法：降序删除；新增 `queue_trim_switch` 双曲目自测（裁剪后原生队列恰 2 项、`getCurrentTrack` 返回目标真实轨、位置推进，三步断言先裁剪后对齐避免裁剪中假通过）。**判据部分达成**：run 33892639710（`0229cb86`）冒烟 `queue_trim_switch` PASS（2628ms，`detail={"trimmedTo":2}`）——注意该用例首跑（run 33842498724）是 32ms 假失败、根本没走到裁剪分支，判据修好后才首次真正验证到本修复，见案例 17。**真机判据未由本修复单独达成**：本修复构建上真机复测「点击排行里的歌曲就直接快速瞬间循环」依旧，真机起播是叠加案例 17 的守卫后才通过的（见案例 17 判据段），故此处不记真机功劳。遗留：降序删除目前只有 CI 行为证据，尚缺原生 `remove`/`getCurrentTrack`/`QueueManager.removeItem` 的源码级确认（该分析未回），即「所有索引组合下无死角」未经穷尽验证 |
| 17 | 本仓库真机反馈续报 + CI 复现（2026-09-05，iPhone 17 Pro / iOS 26.6；run 33842498724 失败全套件级联超时） | 已修复（任务 9.10） | 9.9 降序删除后真机复测「点击排行里的歌曲就直接快速瞬间循环」依旧——点击即循环说明故障在队列裁剪之前的更早段落。精读 `SwiftAudioEx 0.14.7` 与 fork 桥接源码定位真因：`QueuedAudioPlayer.stop()` 清空队列（`reset` → `clearQueue`）并**无条件发 `queueIndex` 事件**（`stop()` 末行），`QueueManager.removeItem` 每次 `currentIndex` 漂移也逐件发，两类事件形状与自然播完完全无法区分。JS 侧 `PlaybackTrackChanged` 处理器（`service.ts`）把空队列/`default` 兜底轨判为播放结束触发 `playerEnded` → `playNext` → `handlePlay` → `await setStop()` → 又发同款事件——桥往返级的自持循环瞬间刷完整张列表，被点歌曲的取链因 `playMusicInfo` 被循环改写永远过期，一首都播不出来。Android 不踩雷：其 `LocalPlayback.stop()` 不清队列、`onTrackUpdate` 发的是 `prevIndex=null` 形状，落在处理器 `info.track == null` 分支被过滤。CI run 33842498724 全套件级联超时（`queue_trim_switch` 后 `deeplink`/`user_api_import`/`mainflow_local` 全部超时、套件未完成）即同款循环在模拟器上演。另查得两处共生缺陷：① `setStop` 在 iOS `stop()` 后紧跟的 `skipToNext` 在空队列上命中原生 `noNextItem` 守卫必 reject，打断 `handlePlay` 的 await；② iOS `stop()` 清空原生队列但 JS `list` 镜像不清，下次 add 后索引错位。附带修复：9.9 的 `queue_trim_switch` 自测有竞态（`queueLen===2` 在 B 入队前即成立——A 稳定态本就是 2 项，不能当裁剪完成信号；改为先等切歌落地再等裁剪），且失败后未暂停，遗留夹具播完污染后续用例。修法：队列手术令牌守卫（`handlePlayMusic`/`initTrackInfo`/`setStop` 首个原生操作前置位、全部落地后按令牌释放，守卫期内不判播放结束；令牌防旧手术延迟释放覆盖新手术窗口；中途失败也释放）；`setStop` 同步清 JS 镜像、iOS 不再 `skipToNext`（Android 原行为逐字保留）；新增 `queue_stop_event_isolation` 判别用例（非空队列上 `setStop` 后 3s `playerEnded` 计数恒 0、起播链可恢复）。<br>**判据双向达成（2026-09-05）**：① run 33904863776（`3bf18542`）冒烟 success；② **iPhone 17 Pro / iOS 26.6 真机复测该构建确认「已经正确播放」**——跨 runtime 闭环（CI 固定 iOS 18.5 模拟器，案例 10/11/13 已三次证明 iOS 26 有专属行为差异，模拟器全绿不可外推，故真机确认不可替代）。**归因边界**：该真机通过验的是三项叠加——案例 16 的降序删除 + 本案例 (a)(b) 的判据/预载修复 + (c) 队列手术守卫，任一单独构建都未通过真机复测（降序删除单独构建仍循环，见案例 16），不得把这条真机证据记在其中任一单项名下。<br>另注 CI 级联超时与真机点击即循环是**两层不同故障**：(a)(b) 修的是套件级联超时（run 33892639710 在无守卫的 `0229cb86` 上即已 31/31 全绿），(c) 修的是真机点击即循环——模拟器套件覆盖不到该场景，故 CI 全绿不构成 (c) 的必要性反证 |
| 18 | 本仓库真机反馈（2026-09-07，iPhone 17 Pro / iOS 26.6） | 已修复（任务 9.11） | 真机「锁屏暂停播放，进度立即清零；继续播放从 0 重新计时，而实际音频位置正常」。逐层排除：JS 轮询链路有 `!position` 守卫，真实位置为 0 时冻结而非写零；`handleStop`/`handleEnded` 清零路径必然连带停播或换歌，与「实际播放正常继续」矛盾——故障不在应用内进度条，在锁屏/控制中心面板。面板进度由 `MPNowPlayingInfoCenter` 的 `elapsedPlaybackTime`（锚点）+ `playbackRate`（外推斜率）渲染：应用经 `setupPlayer` 传 `autoUpdateMetadata: false`（任务 5.4 让歌词走标题通道），关闭了 SwiftAudioEx 唯一写这对键的自动通道（`AudioPlayer.AVWrapper(didChangeState:)` 的 `updateNowPlayingPlaybackValues` 被该开关门控）；JS 侧 `Metadata.update` 只写 title/artist/album/artwork/duration，从不带 `elapsedTime`。面板因此没有锚点：iOS 26.6 上暂停回落 0、恢复从 0 外推。修法（仅 iOS 原生侧，`patches/react-native-track-player+2.1.2.patch`）：状态翻转（playing/paused/buffering）、seek、setRate 三处刷锚点——播放写实际速率与当前位置，暂停写速率 0 与暂停点（速率不归零面板会继续外推），seek 写目标值（异步 seek 未完成时 `currentTime` 仍是旧位置）。Android 的 `autoUpdateMetadata` 在 ExoPlayback 侧，与本补丁零交集。判别面：`getNowPlayingInfo` 探针补 `rate` 回读，`playback` 用例加四组锚点断言（起播锚点+速率非零、暂停锚点=暂停点且速率归零、恢复锚点速率回填、JS 元数据全量提交后锚点存活）。**判据**：待真机复测锁屏暂停/恢复进度；CI 锚点断言为回归面，模拟器面板键可回读但面板渲染行为不可外推至真机 |
| 19 | 本仓库真机反馈（2026-09-07，iPhone 17 Pro / iOS 26.6） | 已修复（任务 9.12，待冒烟判据） | 真机两处横屏故障同根因：自定义源管理与排行榜音源选择在横屏下一弹窗就被强制转回竖屏，无法操作。根因：应用所有弹窗（自定义源管理 `UserApiEditModal→Dialog→common/Modal`、排行榜音源 `SourceSelector→DorpDownMenu→Menu→common/Modal`）都经 `common/Modal.tsx` 这一个收口，它是 RN `Modal` 的包装且未传 `supportedOrientations`。RN 0.73 原生侧 `RCTModalHostView.m:211-215` `supportedOrientationsMask` 对该缺省在 iPhone 上返回 `UIInterfaceOrientationMaskPortrait` 竖屏独占（iPad 才是全方向）——弹窗的宿主 VC 只支持竖屏，横屏呈现时系统当场把界面转回去。这是 RN Modal 在 iPhone 上的默认行为，非 iOS 26 专属，但此前横屏用例只测旋转与截图、不呈现任何弹窗，CI 从未覆盖。修法：`common/Modal` 显式传 `supportedOrientations=[portrait, landscape-left, landscape-right]`（与 Info.plist 三口径对齐）；Android 侧 `ReactModalHostManager.setSupportedOrientations` 是空实现（`ReactModalHostManager.java:110`），传该 prop 不改变任何 Android 行为。判别面：`landscape` 用例横屏段经同一生产收口呈现真弹窗（`lxm.CiModalProbe` 屏 + `common/Modal`），原生探针 `modalOrientationProbe` 回读三条——弹窗已呈现、顶层呈现 VC 类名为 `RCTModalHostViewController`（防 RNN 外层模态假通过）、方向掩码含横屏位、当前场景仍横屏；旧实现三条全判负。**判据**：待下一轮冒烟 `landscape` 用例弹窗段通过；真机复测横屏打开自定义源管理、排行榜选音源不掉方向 |

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

案例 18（锁屏进度锚点缺失）：与案例 6 同属锁屏面板可见行为，但根因
不在系统版本而在本仓库配置——`autoUpdateMetadata: false` 关闭锚点自动
通道是任务 5.4 的刻意选择（歌词走标题通道），副作用此前没有真机证据。
修复不改变该选择：标题/歌词通道保持 JS 接管，只在原生侧补时间锚点两键。

案例 19（横屏弹窗强制转竖屏）：与案例 6/18 同属锁屏/方向可见行为，
但根因在 RN Modal 的 iPhone 默认行为而非系统版本。横屏用例此前只测
旋转与截图、不呈现任何弹窗，该缺陷对 CI 不可见；判别面补在 `landscape`
用例横屏段，经生产收口呈现真弹窗并用原生探针回读方向掩码。

案例 20（「文件」App 直开文档报文件不存在）：真机 2026-09-07 实测，
「文件」App 点开 `.lxmc` 能唤起应用但弹「调用失败：文件不存在」。
根因在 iOS 文档投递模型而非系统版本：`file://` URL 指向沙箱外
（其他应用容器 / iCloud），安全作用域访问授权只在
`application:openURL:` 回调内可靠可用；JS 收到 Linking 事件（异步、
晚数百毫秒）再走 `stat` 时授权已失效，读不到原路径。此前任务 6.4
判据曾误记为双路达成——方案 A 导出落应用自身 Documents（沙箱内直读，
不经授权问题）、方案 B 成功走的是应用内 `selectFile` 选择器链路
（任务 6.5/9.4，选择器回调内即时拷贝），两条都不是「外部直开」这条
实际被用户使用的路径。CI 判别面试过不可行：模拟器不强制沙箱隔离，
外部路径照样可读，造不出失败形态；回归面靠既有 `deeplink` 用例防
暂存机制破坏沙箱内路径，修复证明走真机复测（同任务 9.11 判据结构）。
修法：`AppDelegate` `openURL` 回调内（授权仍有效的窗口）同步把沙箱外
文件拷进暂存目录并转发暂存 URL，下游深链链看到的恒为沙箱内可读路径；
沙箱内文件（共享文档、CI 探针）原样透传零拷贝。

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
