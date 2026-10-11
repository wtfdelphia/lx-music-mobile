## 背景与技术语境

完整方案与全部取证见 `docs/download-feature-design.md`（r2 定稿，642 行）。本文只列关键决策、退路与停止条件。

方案核心事实（详见长文档 §0、§1，均已逐项核实源码）：

1. 移动版已预留下载骨架：类型定义、`LIST_IDS.DOWNLOAD`、播放路由的 `'progress' in musicInfo` 分支、被注释的导航项与两处菜单项、占位下载页
2. `react-native-fs` 不能当 iOS 下载引擎，上游源码缺陷四条：错误时 Promise 悬空、非 2xx 误报完成、随机 UUID 会话杀进程丢续传、在 iOS 上从未被调用（`version.ios.js:69` 走 `Linking.openURL`）
3. 后台会话的 delegate 必须先于 RN 存在：本工程 `AppDelegate.mm:43` 手动建 bridge，系统后台唤醒时 RN 模块实例可能未创建
4. 本机为 Linux，iOS 构建全部走 GitHub Actions macOS Runner；真机能力依赖「CI 出未签名 IPA → AltStore 重签侧载」链路
5. `dev-ios` 的 Android 行为变更触发 `AGENTS.md:158` 停止条件，Android 下载另立 change

## 关键决策

### D1 iOS 专属，JS 调度 + 原生传输，单 change 不拆

队列、状态机、取链接、重试、持久化按桌面版移植到 JS；字节传输交原生。拆成两个 change 会产生「有下载页但下不了」的中间态，且导航重构与菜单接线天然耦合。

### D2 原生层拆 Manager 单例 + Module 外壳

`LxDownloadManager`（纯 ObjC）在 `didFinishLaunching` 开头创建，持有固定 identifier 后台会话、自身为 delegate、独立完成 move 与事件记账，不依赖 RN 在场；`DownloadModule` 只做转发。

### D3 事件一律写日志 + seq + ack

`RCTEventEmitter` 无监听者时丢事件，原生无法判断 JS 是否订阅。完成与错误事件一律追加 `events.jsonl`，JS 持久化任务状态**完成后**才 ack（持久化有 100ms 节流，不可提前确认），重复领取按任务+类型幂等。

### D4 start 事件先校验 2xx

`NSURLSessionDownloadTask` 无 `didReceiveResponse:`，非 2xx 响应同样触发 `didWriteData`。首个 `didWriteData` 读 `task.response.statusCode`，2xx 才发 start/progress，否则错误页会清零重试计数造成刷新死循环。

### D5 本地优先挂在播放器入口，双 id 索引

挂载点为 `player.ts:96` `getMusicPlayUrl`，按歌曲原 id 与 `toggleMusicInfo` id 双索引；**不放 `online.ts`**——下载器的链接获取调同一函数，放那里会让已下载歌曲的新任务拿到本地路径。有意偏离桌面版（桌面版只在下载列表内走本地），移动端离线是刚需。

### D6 取消三分类

JS 主动取消（忽略）/ 用户强退 `UserForceQuitApplication`（存 resumeData 置暂停）/ 系统资源取消（同强退处理）。强退分类依赖真机实证。

### D7 蜂窝与低数据模式按请求级控制

会话层常开，每个请求按 `download.allowsCellular` 当前值赋值，开关即时生效。**需实证**：后台会话是否遵守请求级属性；证伪回退「下次冷启动生效」并在设置页标注。

### D8 内部文件放 Application Support

`Caches/` 会被系统清理；`Documents/` 因 `UIFileSharingEnabled` 对用户可见且进备份。`Library/Application Support/lx-download/` 两者皆免，整目录排除备份。

### D9 导航走 Platform.OS，不建平台扩展

两个 `as const` 元组取并集，容忍 Android 类型层死值（运行时由可见菜单驱动，永不路由到死值）。先例为 `Setting/Main.tsx:31` 的 `SETTING_SCREENS`；平台扩展路线撞 `AGENTS.md` 记录的 `tsc` 报红规律（只有 `.ios` 变体无基础文件即报错）。

### D10 engine 接口在 P1a 按完整形态冻结

P1a 未实现的方法抛 `not supported`，P1b 纯填实现零重构。`ciSelfTest` 维持 35 项不加下载项；正确性靠 vitest + 真机实证。

## 分期与退路

| 期 | 内容 | 依赖 |
|---|---|---|
| P1a | 四工件 + 全部 JS + 原生最小集（start/cancel/complete/error + 事件日志） | 无 |
| P1b | pause/resume、resumeData、后台唤醒、强退恢复 | §17 四项实证全部通过 |
| P2 | TagLib 元数据嵌入、嵌入类设置 | P1 完成 |
| P3 | 跨 URL Range 续传、扫描去重、空间清理、下载后入列表 | 按需 |

退路：

1. §17 任一项实证证伪 → 停下重估，不并行开工；P1b 塌掉时 P1a 的前台下载能力独立成立（放歌期间 `UIBackgroundModes = audio` 保活，覆盖「边听边下」主场景），可作为长期最终态
2. 请求级蜂窝控制证伪 → 回退冷启动生效，设置页如实标注
3. 实证周期阻塞 → P1a 收尾提交触发 CI 出包后，期间并行写 P1b 的非依赖代码（JS 状态机部分），实证通过即接线

## 停止条件

- 四项实证中有任一项证伪，且找不到等价退路 → 停下问人，不擅自收缩或扩大 P1b 范围
- 导航无行为变化重构在 `android-regression` 或双布局手测中暴露行为差异 → 停下，先定位再决定是否继续
- `spec/requirements.md:73` 修订措辞引发合规争议 → 停下问人，条款修订是外部可见行为，不能由实现方单方定稿

## 验证口径

- 每个提交独立过 `npm run lint` + `npm test`（`dev-ios` push 不触发 CI lint）
- `npx tsc --noEmit` 错误数不超 21（存量口径，平台扩展按 D9 规避新增）
- CI 回归：`ios-verify.yml` 现有 job 全绿（含 `android-regression`、35 项模拟器自测）
- 真机实证 4 项 + 前台功能 12 项清单见长文档 §13、§17；未实际运行的项不得写成「通过」
- 实证留痕：`evidence/p1b-empirics.md`，逐项「操作 → 观察 → 结论」
