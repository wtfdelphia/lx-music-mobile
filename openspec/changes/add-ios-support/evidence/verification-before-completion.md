# 完成前验证：add-ios-support（2026-09-05 会话）

本轮范围：修 `queue_trim_switch` 假判据、隔离预载外网请求（自测门控 +
生产超时）、补真机日志导出通道。提交 `0229cb86`，CI run 33892639710。

> **本文档不覆盖后续两轮**：`3bf18542`（队列手术事件守卫，他人提交，
> CI run 33904863776 success + 真机确认起播）与榜单空白 / 播放页子页
> 高度塌缩的 UI 修复（本文档所在提交，`viewTreeProbe` 原生探针尚未
> 编译过、`leaderboard_drawer` 与 `lyric_page` 两条用例尚未执行过，
> 待 CI 首跑）。

## Verification

只列本会话真实运行过的命令与真实输出。

| 命令 | 结果 | 结论 |
| --- | --- | --- |
| `cargo check --release --all-targets`（`rust/lxcore`） | `Finished release profile in 22.41s`，**warning 数 0** | 通过。本轮无 Rust 改动，0 告警即 0 新增告警 |
| `npx tsc --noEmit`（改动后，`0229cb86`） | 37 条错误 | 见下方基线对比：非新增 |
| `npx tsc --noEmit`（改动前基线，checkout `d36a5670`） | 37 条错误 | **前后同为 37，本轮零新增类型错误**。既有 37 条集中在 `ciSelfTest.ts` 与 `utils/toast` 模块解析，属存量问题，本轮未触碰 |
| `npx eslint`（4 个改动文件） | `LINT_CLEAN`（无输出） | 通过。过程中修掉自己引入的 2 处 `no-confusing-void-expression` 后复跑干净 |
| `gh run view 33892639710` | 5/5 job `success`，sha `0229cb86` | 通过。含「JS 门禁（单测 + Metro 双端打包）」「iOS 模拟器冒烟」「iOS unsigned 构建」「Rust iOS 交叉编译」「Android release 回归」 |
| 冒烟报告 `ci-report.json`（artifact 实读） | `ok=true` `finished=true`，**31/31 用例 PASS，0 失败**，套件 223s | 通过。上一轮 run 33842498724 为 6 项失败、22/30、被 45min 看门狗兜掉 |

### 关键断言的实测值（artifact 实读，非推断）

- `queue_trim_switch`：`ok=true`，**2628ms**，`detail={"trimmedTo": 2}`。
  上一轮为 32ms 假失败。这是 `d36a5670` 降序删除修复**首次真正走到裁剪
  分支**并通过「原生队列恰 2 项 + `getCurrentTrack` 返回目标真轨 + url
  对齐」三步断言 —— 此前该修复无任何运行时证据。
- 预载隔离生效：`consoleTail` 中 `preload next music url` **0 次**
  （失败那轮 10 次）。此前超时的三个用例恢复正常：`deeplink` 24.2s
  （原 120s 超时）、`user_api_import` 257ms（原 120s 超时）、
  `mainflow_local` 876ms（原 300s 超时）。
- `remote_stream_playback`：`skipped=false`，`atsMediaProbe.errorCode
  = -11850`（非 -1022）。媒体通道 ATS 无罪的结论维持。
- `env.ciRuntime = iOS 18.5`。

### 真机验证（用户报告，非本会话可复算）

用户在 **iPhone 17 Pro / iOS 26.6 真机确认「已经正确播放」**，测的构建是
**run 33904863776 / `3bf18542`**（非本轮的 `0229cb86`）—— CI 侧只有
iOS 18.5 模拟器证据，真机确认补上了跨 runtime 的一环。

**归因边界（本轮更正）**：该真机通过验的是三项叠加，不是案例 16 降序删除
单独的功劳 —— 降序删除（案例 16 / `d36a5670`）+ 本轮判据与预载修复
（案例 17 (a)(b) / `0229cb86`）+ 队列手术事件守卫（案例 17 (c) /
`3bf18542`，他人提交）。降序删除单独构建上真机复测「点击排行里的歌曲
就直接快速瞬间循环」依旧，故不得把这条真机证据记在任一单项名下。

真机同时报出一条**与播放无关**的错误（版本检查首源
`raw.githubusercontent.com` 得 `NSURLErrorDomain/-1000 bad URL`，
`_kCFStreamErrorCodeKey=22`=EINVAL，1~2ms 即失败）。已定性为设备侧 DNS
解析层问题、非应用缺陷，依据：失败无网络往返、`NSURLErrorNWPathKey
=satisfied` `LQM:good` 网络通畅、**原生裸探针 `httpProbe`（走
`dataTaskWithURL:`、无自定义 header、不经 RN fetch 封装）报同一错误**
——排除应用侧 header 构造 / fetch polyfill / ATS 三个嫌疑；URL 字符串经
`package.json` 拼装核对为干净的 85 字符。功能未受影响：8 源兜底链跌到第
2 源 `registry.npmjs.org` 即成功（日志中 3 组重试后无后续错误行，与
`version.ios.js` 每源重试 3 次的预算吻合）。

**该定性中「DNS 返回不可用地址」一步是推断，未经设备端实测证实**（无法
读取用户设备解析结果）。已向用户给出验证方法（同 SIM 热点下
`dig +short raw.githubusercontent.com`）。

## Documentation Sync

| 目标 | 是否需要同步 | 状态 |
| --- | --- | --- |
| `evidence/ios26-upstream-landscape.md` | 是 | **已补（2026-09-05，2026-09-06 更正归因）**。案例 16 判据栏写入 run 33892639710 实测值，并标注该用例首跑是假失败、本修复直到判据修好才首次真被验证；**真机判据不记在案例 16 名下**（该构建真机仍循环），改记入案例 17 并标明是三项叠加、run 33904863776 / `3bf18542`。案例 17 记录三个根因：(a) `queue_trim_switch` 判据不变量假通过、(b) 预载外网请求占桥（二者为本轮，修 CI 级联超时）、(c) `stop()` 事件被误判播完的自持循环（他人提交，修真机点击即循环） |
| `openspec/changes/add-ios-support/tasks.md` | 是 | **部分完成**。5.7 补入真机证据与阻塞项清除说明，但**故意不勾选**——真机只确认「能播放」，该条另两项判据（完整听完一首在线歌、锁屏不中断可控）未经确认，勾选即为虚报。其余条目本轮无新证据，未动 |
| `specs/ios-playback/spec.md` | 是 | **已补**。「切歌队列索引对齐」契约无需改（`d36a5670` 已写入且正确）；新增 **Requirement: 下一首预载不得占用请求通道** ——本轮生产侧确有行为变更（整轮预载受 10s 硬超时约束、失败静默放弃），此前 spec 未覆盖该约束 |
| `README` / `CLAUDE.md` / `openspec/specs` | 否 | 无面向用户的行为变更需登记；新增的「导出日志」按钮属设置页既有功能区内的取证通道 |
| `AGENTS.md` | 不适用 | **本仓库不存在该文件**（skill 规则假设其存在）。「零新增编译告警」仍按规则执行并已报告 |

## Residual Risk

1. ~~文档未同步~~ **已补（2026-09-05）**：案例 16 判据达成 + 新增案例 17 +
   spec 补预载契约 + 5.7 补真机证据（2026-09-06 更正：真机证据改记案例 17
   并标明三项叠加，详见上文「归因边界」）。**新发现的文档不一致**：证据文档
   多处引用「任务 9.4 / 9.5 / 9.6 / 9.7 / 9.8 / 9.9」，但 `tasks.md`
   **只有第 1~7 章，不存在第 9 章**；且文件第 1 行有一个残留的空
   `* [ ]` 条目。这些 9.x 任务的验收状态因此无处登记。本轮未擅自补建
   章节（属结构性变更，需先确认这些任务的原始定义来源）。
2. **未 archive、未开 PR/merge**：change `add-ios-support` 仍在
   `openspec/changes/`；`dev-ios` 已 push 到 origin，但未向 `master`
   开 PR。
3. **CI runtime 与真机存在差距**：冒烟固定在 **iOS 18.5** 模拟器，用户
   设备是 **iOS 26.6**。案例 10/11/13 已多次证明 iOS 26 有专属行为差异，
   模拟器全绿不能外推到真机。
4. **既有 37 条 tsc 错误未清**：与本轮无关（前后同值），但 `ciSelfTest.ts`
   的类型错误意味着自测代码本身缺少类型保护，未来改动风险偏高。
5. **真机 DNS 定性未经实测**：见上，属推断。
6. **日志噪音未处理**：每次启动 `checkUpdate` 会向 `error.log` 写约 9 行
   ERROR（含数百字符 NSError dump），会淹没刚建好的真机归因通道。已向
   用户提出两个方案，**等用户裁决，尚未动代码**。
7. **未运行的验证**：无 iOS 原生单测可跑；`remote_stream_playback` 的
   真机段（真实在线音源装载）仍只有环回流证据。真机「完整听完一首在线歌」
   （任务 5.7）与「锁屏控制目视确认」（5.3）等 9 项手测项依旧待办。
8. **后台原生队列语义分析未回**：我此前启动的原生 `remove` /
   `getCurrentTrack` / `QueueManager.removeItem` 源码级分析**结果尚未
   返回**。降序删除目前只有 CI 行为证据（`queue_trim_switch` PASS），
   真机证据属三项叠加、不能单独归因于它，仍缺原生源码级确认它在所有
   索引组合下无死角。

## 安全检查

- `git status --short`：**空**（工作区干净，无待提交内容，基线对比用的
  checkout 已还原至 `dev-ios` / `0229cb86`，无残留 stash）。
- 敏感文件扫描（`git ls-files` 匹配 `config.json|credentials|.codegraph/|
  .env|.p12|.mobileprovision|id_rsa`）：命中 3 项均为无害 ——
  `.codegraph/.gitignore`（自排除规则，`.codegraph/` 下仅此一个受跟踪
  文件）、`ios/.xcode.env`（RN 模板，仅 `export NODE_BINARY=$(command -v
  node)`，无密钥）、`tsconfig.json`。
- 本文档及会话输出未包含 token、账号、Cookie 或真实配置。
