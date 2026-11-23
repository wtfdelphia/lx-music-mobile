# add-ios-local-library 设计摘要

本文是 `add-ios-local-library` 变更的设计摘要，完整设计见
`openspec/changes/add-ios-local-library/design.md`，规格见同目录 `specs/`。
本版按 2026-10-12 的设计评审与定稿决策更新，落入四组结论：净室风险
的真实性质与执行门禁、实现层面的修正、「已下载曲目自动关联」增量
设计、功能范围定稿（每日推荐砍掉、歌词手动搜索提至 P1、三 Tab）。
全部内容已回写 openspec 工件（`design.md`、specs、`tasks.md`、
`proposal.md`）。净室复核已于同日确认通过，Bridge Plan 已产出
（`evidence/bridge-plan.md`），P1 实现进行中。

## 净室规则

- **依据范围**：只按三类材料实现
  - Apple 公开文档
  - Subsonic、OpenSubsonic、Jellyfin、Emby 的公开 API
  - LX 自己的代码
- **重新定义的部分**：定位符、表结构、元数据映射都是新设计，元数据按
  `AVMetadataIdentifier` 精确匹配。
- **实现要求**：实现者不看 LynMusic 源码；PR 里写明声明。
- **图标和样式**：全部用 LX 现有资源。

评审对净室部分的修正：

- 上游仓库 `wesley666/LynMusic` 的许可证是 **GPLv3**。净室纪律在这里
  不是姿态问题，是许可证问题：实现若被认定为衍生作品，copyleft 会直接
  冲击本仓库「iOS 包继续 Apache-2.0」的定位。
- 设计者为可行性评估读过 LynMusic 源码（design.md §0.5 已自曝），
  严格净室已经不成立，当前能做到的是降低推导性依赖。
- 「重新定义」的净室价值不宜高估。按 `AVMetadataIdentifier` 精确匹配、
  WAL+FTS5、bookmark+NSFileCoordinator，都是任何合格实现都会收敛到的
  做法；净室真正防的是结构、命名、算法细节的搬运，不能当法律护身符。
- 缓解措施（开工硬门禁）：实现开始前复核 `design.md` 与 specs（不
  复核代码）。优先请未接触上游源码的人；找不到这样的人时降级为
  结构化自审：逐节列出「本节设计依据的公开文档条目」，形成证据
  清单，并在 PR 中声明降级事实。
- 处置规则：复核认为某节设计疑似源自上游（结构、命名、算法层面的
  相似）时，该节按公开文档独立重写；重写后仍无法自证依据的，砍掉
  对应功能，不带病实施。

## 功能范围参照基线（2026-10-12 定稿）

功能范围以 LynMusic 公开描述（README 与截图可见功能）为参照基线，
逐项按本项目实际情况取舍；基线之外的功能记为 LX 自有需求，不属于
净室参照范围，也不受净室约束。

- 参照基线：本地文件夹导入、多维浏览、喜欢与歌单、歌词搜索、歌词
  分享、标签编辑（降级为只读查看）、Samba 与 WebDAV（延后到 P4）
- 参照基线但按实际情况变形：标签编辑只读（无 iOS 写入能力）；
  「在线回填」在本设计中只做播放回落（`library.onlineFallback`），
  元数据与歌词回填由现有 `getOtherSourceByLocal` 链路部分覆盖，
  不另做；TV、车机、投屏不做
- LX 自有需求（不受净室参照约束）：Subsonic 通用协议、Jellyfin、
  Emby、离线下载、播放上报、文本导入、已下载曲目自动关联
- 已砍：每日推荐（F12），编号留缺口不重排；曲库页定稿为三 Tab

## 架构

### 统一的歌曲表示

曲库歌曲一律当作 `MusicInfoLocal`（`source: 'local'`），不扩充
`LX.Source`。已核实依据：`Source` 是 `UserApiSources`、`QualityList`
等 `Record` 类型的键，并被同步协议、换源逻辑使用，扩充的波及面不可控。

### 定位符

`lxlib://<sourceId>/<itemKey>`，同时用作 `id` 和 `filePath`。

- 重签、重新授权都不会变。
- 重复加入列表时靠 id 天然去重。
- 拒绝含 `..` 的路径。
- 身份语义：本地来源的 `itemKey` 是相对路径，用户在文件夹内重命名或
  移动文件后，旧定位符作废，「喜欢」和列表引用一并失效。这是相对路径
  方案的固有代价，按「重命名等于新曲目」处理，不当缺陷修。
- 在线回落匹配时，`getOtherSourceByLocal` 会对 `filePath` 取最后一段
  当文件名；定位符的最后一段是 percent 编码，解析处需先
  `decodeURIComponent`。

### 原生模块 `LxLibraryModule`（不增加依赖）

- 系统 sqlite3：WAL、FTS5、结构化查询。
- `finishSync` 改为 upsert 即打 seen 标记：本地 1 万首、Subsonic 2 万首
  的全量定位符数组一次过 RN bridge 不可接受，`finishSync` 只负责删除
  未见记录。
- bookmark 授权：引用计数常驻持有，失效后重新关联不改变定位符。
- FileManager 加 NSFileCoordinator 扫描：白名单、识别 iCloud 未下载
  文件、增量扫描、删除保护。协调读取失败时回退普通枚举，避免在部分
  第三方 Provider 上整个来源不可扫。
- AVFoundation 元数据；ImageIO 封面（最长边 600px）。
- 内嵌歌词和同名 lrc：编码依次尝试 BOM、UTF-8、GB18030、Big5。
  已知局限：GB18030 对字节流容错极高，Big5 分支实际接近死代码，Big5
  文件会被当 GB18030 解出乱码。P1 接受现状，有实际反馈再考虑双解码
  打分。
- Keychain。

### JS 层 `core/library`

本地、Subsonic、Jellyfin 和 Emby 来源，负责同步编排、解析、播放上报、
文本导入、已下载曲目自动关联。

## 接入 LX

### 播放

- 新增 `music.ios.ts` 解析定位符，顺带修复重签后旧本地歌曲失效的问题
  （按当前容器重新拼接路径）。
- 远程曲目：离线文件优先，其次串流。
- 串流 URL 不写缓存，因为带 token。
- 预载路径无需改门控，但要纳入验证：`preloadNextMusic` 对全部曲目
  无条件走 `getMusicUrl`，`source !== 'local'` 只罩住 `lookupLocal`
  下载索引捷径，`lxlib` 曲目会照常经解析器预载。库的离线文件在曲库
  数据库而不在 `downloadIndex`，捷径覆盖不到它们，属于优化项不是
  断流缺陷。
- `E_CELLULAR` 的呈现路径要闭环：`getMusicUrl` 对 `getLocalFilePath`
  没有 try/catch，resolver 抛错会直接变成播放失败。蜂窝禁串流的本地化
  toast 接线写进实现规格。

### 列表

「喜欢」写入 LX「我的收藏」；歌单就是 LX 自建列表；播放走临时列表。

### 下载

- 下载引擎加 `kind: 'library'`，保存到 `Download/Library/艺人/专辑/`，
  完成后回写曲库。旧任务兼容。
- `LX.Download.FileExt` 当前只有 `mp3 | flac | wav | ape`，library 任务
  按服务端原始扩展名保存会出 m4a、aac，类型联合必须扩。

### UI

- 导航项 `nav_library`，图标 `sd-card`（已确认在现有 iconfont 里）。
- 歌曲、专辑、艺人三个 Tab（推荐已砍，不占位）；专辑和艺人有详情页。
- 来源管理和扫描报告。
- 组件复用 OnlineList、ListMenu、歌单网格、Dialog。

### 设置

9 项，包括串流音质、蜂窝网络、下载音质、在线回落、播放上报、收藏回写、
下载自动关联（`library.autoAssociateDownloads`，见下节）等。

### Android

行为零变化。注意 `core/music/local.ts`、`core/download/*`、
`types/download_list.d.ts` 是双端共享文件，改动靠前缀门控保证行为不变；
按仓库纪律这属于「触碰 Android 即停下确认」的口径，实施时在
bridge plan 里显式声明「共享文件、零行为变化」。

## 已下载曲目自动关联（增量设计，2026-10-12 补入）

目标：LX 下载完成的曲目自动进入「本地曲库」（`nav_library`），可浏览、
搜索、入列，不需要用户再手动导入。本节是对主设计的增量，基于对下载
引擎链路的通读。

### 语义定位

LX 已有「下载过的歌本地优先播放」的机制：`downloadIndex` 按歌曲 id
索引，播放器和预载经 `lookupLocal` 命中（`src/core/download/downloadIndex.ts`）。
但它只解决播放寻址，下载过的歌在曲库里不可见，进不了专辑、艺人、
搜索。自动关联补的就是可见性与组织：下载完成的曲目以曲库曲目
的身份出现，播放寻址仍由现有机制与曲库解析器共同覆盖。

### 身份模型

- 新增虚拟来源「下载」，`source.type = 'download'`，全库只允许一个，
  创建时机为首次关联，不在来源管理里走「添加」流程。
- 来源根目录是沙箱内 Documents，按 design.md §5.2 的沙箱分支记录，
  不需要 bookmark。
- `itemKey` 取下载任务的 `metadata.filePath`（相对 Documents 的路径）。
  下载模块本就按这个模式存储，读取时经 `resolveDownloadPath` 拼接，
  重签后定位符不变。
- 定位符仍是 `lxlib://<sourceId>/<itemKey>`，与主设计一致。

### 挂钩方式：订阅事件做差量，不改下载调度

读代码确认下载完成有三个入口，且都触发同一个事件：

- `scheduler.ts` 的 `handleComplete`（引擎 complete 事件）
- `handleStartTask` 的 `skipExistFile` 快路径（文件已存在直接置完成）
- `claimOrphanTasks` 的孤儿认领

三处都经 `store/download/action.ts` 的 `commit` / `updateDownloadTask`
落盘并触发 `global.app_event.downloadListUpdate`。因此关联模块不侵入
调度器，只订阅这一个事件做差量对账：

- 内存维护「已关联任务」集合，冷启动时用曲库中该来源的现有曲目
  重建：映射键是 `item_key == task.metadata.filePath`，不需要额外
  schema 字段。
- 每次事件到达（节流约 1 秒）：扫任务列表，`status === 'completed'`
  且 `isComplate` 且未关联的任务进入待入库集合；已关联但任务已不在
  列表（删除、清空已完成）的记录进入待移除集合。
- `reconcile` 标出的 `FILE_MISSING` 任务不进待入库；已关联的任务变成
  `FILE_MISSING` 时按文件缺失移除关联。触发时机共三处：冷启动、
  进入下载页、播放本地失败回落在线（`handleLocalPlayFallback`）。
  `reconcile` 自身只改内存状态，不发事件也不落盘，三个调用点之后
  也都不立即持久化；状态变化随后续任意一次 `updateDownloadTask`
  落盘并触发 `downloadListUpdate`，差量在下一个事件周期感知。两次触发之间被外部删除的文件会暂时留在曲库；播放不受
  影响，解析器找不到文件会返回空串走回落。

这个方式的收益：三个完成入口全覆盖，不修改双端共享的 `scheduler.ts`
与 `index.ts`（Android 隔离纪律上干净），孤儿认领、冷启动后台下完的
任务这类边缘路径也自然覆盖。事件在下载进行中高频触发，但差量逻辑
只是一次列表扫描加集合比对，任务数百首以内开销可忽略。

### 只关联 `kind: 'online'` 任务

`kind: 'library'` 任务（远程曲库曲目的离线下载）已由主设计 §10 的
`offline_path` 表示，同一首歌会以远程曲目加离线标记的形式出现。自动
关联跳过这类任务，避免同一文件出现两条曲目。

### 同歌多音质去重

任务键是 `${歌曲id}_${音质}_${扩展名}`，同一首歌换音质重下会产生第二
个任务。关联按歌曲 id 去重，比较规则与 `downloadIndex` 的 `qualityRank`
一致（该表是模块私有、不导出，实现时在关联模块内复刻）：新任务音质更
高时替换关联（旧行删除，新行入库），音质更低时忽略。
被替换任务的文件留在磁盘，归下载页管理。

实现契约：歌曲 id 只存在于任务元数据（`metadata.musicInfo.id`），
曲库表没有也不加这个字段。去重在差量计算时对全部 `completed` 任务
按歌曲 id 分组、每组只选最高音质的任务入库，冷启动首次差量同样执行，
不依赖数据库状态。

### 元数据与封面

- 任务里的 `musicInfo` 是在线曲目，字段不全（没有时长毫秒、码率、
  专辑艺人）。关联时用 `LxMediaProbe` 读已下载文件拿真实元数据，
  `musicInfo` 的 name、singer、albumName 作降级值。
- 内嵌封面走 `LxArtworkCache`，与其他本地曲目同路径。
- 歌词：`download.isDownloadLrc` 开启时，`handleComplete` 路径会写
  同名 `.lrc`（`lrc.ts`），`readLyric` 的 sidecar 分支直接命中。注意
  `skipExistFile` 快路径不调 `saveLrc`，这类任务即使开了开关也没有
  `.lrc`，歌词走 LX 缓存与在线回落。

### 删除与解绑语义

- 下载页删任务且删文件：差量移除关联，曲库曲目消失。
- 下载页删任务留文件：关联跟着任务走，一并移除。文件仍在
  `Download/` 下，用户想保留进曲库可以自行把该目录加为本地来源。
  已知后果：「清空已完成」是批量版本，一次能清掉大量曲库曲目，
  文件却都还在。定稿：关联跟任务走，不跟文件走，清空前提示
  「将从曲库移除 N 首」。
- 曲库侧删除「下载」来源的曲目：只解绑（删曲库行），不动下载任务与
  文件。曲库对沙箱内文件不提供删除操作，与主设计的安全边界一致。
- 「下载」虚拟来源本身可停用不可删除；提供「清空关联」操作（解绑
  全部，文件不动）。
- 已知行为：用户若把 `Download/` 目录手动加为本地来源，同一文件会
  同时以两个来源的曲目出现（定位符不同，去重不覆盖跨来源）。来源
  添加页对选中 `Download/` 给一行提示，不做硬拦截。

### 设置与开关

- 新增 `library.autoAssociateDownloads`，默认开启，受 `library.enable`
  门控；设置分组总数 8 项改为 9 项。
- 关闭开关只停止新的关联，已关联曲目保留；重新开启时差量对账会
  补齐关闭期间新完成的任务。
- 首次启用该功能时（升级安装或从未开过）对全部存量完成任务做
  一次批量导入，UI 上按扫描进度呈现。

### 初始化顺序

关联模块有两个初始化依赖：`initDownload` 完成（下载列表已加载）和
曲库 store 初始化完成（能查「下载」来源的现有曲目重建关联集合），
两者都就绪后才订阅事件并执行首次差量。启动链中的挂点与两个依赖的
先后关系在实现时确定，待决项只剩挂点位置。挂在
`core/library/associate.ios.ts` 平台扩展，基础文件 `associate.ts`
为空实现，Android 上不存在此行为。

### 工件落点（2026-10-12 已全部回写）

- `design.md`：§11 整节（身份模型、事件差量、互斥、去重、删除语义、
  设置与初始化），§10 补 `kind: 'library'` 互斥说明，§14.6 设置表
  9 项，功能清单加 F17。
- `specs/ios-local-library/spec.md`：新增 Requirement「已下载曲目自动
  关联」，四个场景（完成即入库含 `skipExistFile` 快路径与孤儿认领、
  多音质去重、删任务移除、跳过 `kind: 'library'`）。
- `specs/ios-download/spec.md`：不改。关联是曲库消费下载状态，不改变
  下载引擎行为。
- `tasks.md`：P2 任务 5.6（差量订阅、虚拟来源、去重、vitest 覆盖）。

## 分期

| 期 | 内容 | 估时 | 出口 |
|---|---|---|---|
| P1 | 原生模块、本地来源、三 Tab 浏览、播放接入、列表映射、标签查看、歌词手动搜索、设置 | 3 到 4 周 | 真机实证 1、4、6 必过；2、3、5 允许带观察项 |
| P2 | Subsonic 和 Navidrome、Keychain、播放上报、离线下载、已下载曲目自动关联 | 2 周 | 真机实证 7（Navidrome） |
| P3 | Jellyfin 和 Emby、文本导入、分享图 | 2 周 | 真机实证 7（Jellyfin） |
| P4 | WebDAV、飞牛、Samba | 另立 change | 无 |

P1 是主动扩容（歌词手动搜索与标签查看留在 P1，每日推荐砍掉部分对冲），
估时从 3 周放宽到 3 到 4 周。排期压力集中在六个原生子模块、三 Tab 加
详情页、来源管理、三语文案，再叠加真机实证本身的工作量（准备 1 万首
曲库、iCloud、第三方网盘、重签流程）。出口从「实证 1 到 6 全过」收窄
为「1、4、6 必过」，避免出口条件卡死里程碑。

真机实证共 7 项，重点是重签后授权是否有效、锁屏连播、iCloud 文件、
FLAC 标签覆盖，以及 1 万首规模的性能。

## 待决事项（原 §21，全部关闭）

2026-10-12 评审与定稿后逐项关闭：

1. 已关闭：每日推荐（F12）整体砍掉，曲库页为三 Tab，不做占位。
2. 保留至 P3：歌词分享图的截图方案进 P3 前单独决策。评审记录倾向
   `react-native-view-shot`：`UIGraphicsImageRenderer` 只能渲染
   UIKit 视图，RN 视图树没法离屏原生截图，自研等于用 CoreGraphics
   重画整张卡片。代价是打破「零新增依赖」的自我约束，但 design.md
   §3 已把它列为唯一例外。
3. 已关闭：`library.onlineFallback` 默认开启，与 LX 本地歌曲现状一致；
   在意私有曲库不混入在线源的用户可自行关闭。
4. 已关闭：「隐藏文件夹或曲目」不做，不进后续各期既定范围。
5. 已关闭：净室复核按开工硬门禁执行（见净室规则节），含降级路径与
   处置规则。
6. 已关闭：「清空已完成」按任务生命周期批量移除关联（关联跟任务走，
   不跟文件走），清空前提示「将从曲库移除 N 首」；`library
   .autoAssociateDownloads` 默认开启。

## 评审核验记录（2026-10-12）

以下设计论断已在 `dev-ios` 当前代码里核对属实：

- `LX.Source` 被 `UserApiSources`、`QualityList` 以 `Record` 使用，
  不扩充的决策成立（`src/types/common.d.ts`、`src/types/user_api.d.ts`）。
- `sd-card` 存在于现有 iconfont（`src/resources/fonts/selection.json`，
  共 52 个图标）。
- `NAV_MENUS_IOS` 结构与设计的插入点一致（`src/config/constant.ts`）。
- `createDownloadInfo` 任务键与 `buildSavePath` 相对 Documents 的约定
  兼容（`src/core/download/utils.ts`）。
- `LIST_IDS.LOVE` / `TEMP`、`formatPlayTime2`、`react-native-quick-md5`
  （Subsonic 认证可直接用）、`NSAllowsArbitraryLoads` 均存在。
- iOS 部署目标 13.4，系统 SQLite 自 iOS 10 起带 FTS5。
- `UtilsModule.m` 有稳定 VC 呈现与重试管线，选择器复用它可满足
  `ios-file-access` 规范的竞态要求。
- `openspec validate --all` 全绿（10 项通过）。
- 自动关联相关：下载完成三入口（`handleComplete`、`skipExistFile`
  快路径、`claimOrphanTasks` 孤儿认领）都经
  `store/download/action.ts` 落盘并触发 `downloadListUpdate` 事件；
  `path.ts` 的相对 Documents 路径模式与定位符的重签语义一致；
  `reconcile` 对缺失文件标 `FILE_MISSING` 并移出索引；
  `downloadIndex` 已有 `qualityRank` 可用于同歌多音质去重。

## 实现进度与实测基线（2026-10-12）

### 状态

- 净室复核：用户确认通过（§0.5 开工硬门禁满足）
- Bridge Plan：`evidence/bridge-plan.md`，含任务到执行步骤映射、
  停止条件与验证清单
- P1 JS 核心层已落地部分：`locator.ts`、`toMusicInfo.ts`、
  `native.ios.ts` / `native.ts`（薄封装与平台扩展）、`types.ts`、
  `resolver.ts`（P1 本地分支）、`utils/music.ios.ts`（定位符分支与
  旧路径 rebase）；`core/music/local.ts` 封面与歌词分支已接线；
  `saveMusicUrl` 已加 `lxlib` 不缓存守卫。vitest 28 用例（
  `test/library/`），全仓 93 用例全绿
- 环境边界：本机无 Xcode 工具链，原生模块（任务 1.1 至 1.7）、
  模拟器构建与全部真机实证需在 Mac 上执行

### 实测基线（与文档记载的偏差，已登记）

| 项 | 文档记载 | 实测 | 处理 |
|---|---|---|---|
| `tsc --noEmit` | 21 errors | 24 errors | 基线漂移，非本变更引入（`git stash` 排除本变更全部改动后复测仍为 24）；本变更新增文件零错误；实测分布记入 bridge plan |
| `npm run lint` | 退出码 0（债已清零） | HEAD 带 3 个既有错误（`core/download/index.ts` 未用导入、`scheduler.ts` 注释与可选链各一） | 非本变更引入，按「无关问题只登记不动手」纪律不修；清零与否另行决定 |
| `npm test` | — | 93 用例全绿（原 65 + 本变更新增 28） | 无偏差 |

两处基线偏差都是 `f2ed240` 基线本身的状态，实现完成前不更新
AGENTS.md 验证矩阵；归档时按实测值同步。
