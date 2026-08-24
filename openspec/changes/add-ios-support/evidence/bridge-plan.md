# Bridge Plan: add-ios-support

> 生成日期：2026-08-24 · 分支：`dev-ios` · OpenSpec 状态：`isPlanningComplete=true`，四工件 done，未 blocked
> 规格依据：`openspec/changes/add-ios-support/` 全部工件；决策源 `docs/ios-optimal-plan.md`

## 1. 范围、非目标、关键设计决策

**范围**：在现有 RN 工程内补齐 iOS（五个原生模块、平台扩展文件、工程配置、验证基础设施、CI 编译回归）。

**非目标**（与 proposal 一致，执行中任何一条被触碰即触发停止条件）：桌面歌词、App Store 上架、TestFlight 外部测试、应用内更新、本地音乐标签写入、Rust 全栈/全平台重写、任何 Android 行为变更（唯一例外：`build.gradle` 一处 assets 路径映射，见任务 7.7）。

**关键决策**（详见 design.md）：D2 加密核心 Rust 化（仅 iOS 链接，纯 C ABI，有当天退路）；D3 沙箱用 JSC；D6 G1 闸门在 Phase 1 末判读，二期另立 change。

## 2. 高风险项

| 风险 | 暴露点 | 应对 |
|---|---|---|
| ECB 隐式填充误实现（错了不报错） | 任务 3.2 | 黄金基准含非对齐明文用例；`cargo test` 门禁 |
| RSA SPKI/PKCS#8 ↔ PKCS#1 转换 | 任务 3.2 | `spki`/`pkcs8` crate；跨端密钥往返场景 |
| 本工作区是 Linux，无 Xcode/模拟器 | Phase 0/1.4 起 | CI 级验证走 GH Actions macos-15（已首次通过，见 `evidence/ci-verify.md`）；交互式任务待本机macOS（macOS 15 / Intel） |
| 黄金基准缺 Android 真机 | 任务 2.2 | JDK 8 引导路径 + 真机替换要求（见停止条件） |
| rquickjs 分叉差异（二期风险） | 不在本变更 | G1 只测 JSC；分叉实测属二期前置 |
| 工作区含无关改动（`.claude/skills` 修改、`.agents/` 未跟踪） | 提交时 | 本变更只提交 `openspec/` 与实现代码，其余不动 |

## 3. CodeGraph 证据

索引：654 文件 / 6,883 节点 / 16,208 边（`codegraph status`，2026-08-24）。

| 命令 | 结论 |
|---|---|
| `codegraph impact exitApp` | 21 个受影响符号：`tools.ts:149`、`setting.ts:79`、`Aside.tsx`、`DrawerNav.tsx`、`core/common.ts` 等 —— 佐证任务 1.3 必须先于任何 UI 验证（启动链第一阻塞） |
| `codegraph impact readDir` | 7 个符号：`ChoosePath/List.tsx:20`、`localMediaMetadata.ts:16`、`listAction.ts` —— 任务 1.4 的适配层必须覆盖这些消费点的字段预期 |
| 文档基线（已复核） | `rsaEncrypt` 触达 13 符号；`nativeModules/utils` 被 15 文件 + 1 个 `.tsx.bak` 引用；`wy/utils/crypto.js` 被 8 文件引用 |

## 4. rg / 源码补盲

| 项 | 发现 | 对执行的影响 |
|---|---|---|
| `tsconfig.json` | 无 `moduleSuffixes`；Metro 原生解析 `.ios.ts`，但 TS 类型检查需要它 | 任务 1.4 若用平台后缀方案，补 `moduleSuffixes`（ios-support-plan §4.2.3） |
| 字体 | `src/resources/fonts/icomoon.ttf`，无 `react-native.config.js`，Android 走 assets 拷贝 | 任务 1.5 需手工把字体加进 iOS 工程 + `UIAppFonts`，不能依赖 asset 自动链接 |
| preload 加载路径 | `QuickJS.java:44` 经 `getAssets().open("script/user-api-preload.js")` 读取 | 任务 7.7 移动文件后，`build.gradle` 必须保持该 assets 路径可用 |
| CI 触发 | `release.yml` 仅 `on: push: branches: [master]` | 任务 7.5 的 iOS job 需**新增**触发条件（如 pull_request），不是改现有的 |
| 凭据排查 | `.gitignore` 已覆盖 `keystore.properties`/`*.keystore`；本地仅有上游 `debug.keystore`；无 env/token/cookie 残留 | 通过停止条件检查；实现中若新增签名配置，只走 secrets |
| npm scripts | 无 `test`；有 `lint` | 任务 2.1 需新建测试入口；`npm run lint` 是现成回归 |
| `node_modules` | 未安装 | 任何 JS 侧验证前先装依赖（Node 18，见 `.nvmrc`） |
| README.md:28 | 「目前没有计划支持 iOS」 | 交付时需同步（§7） |
| 缺失文件 | 仓库无 `AGENTS.md`、`spec/design.md`、`openspec/project.md`（OpenSpec 未 init） | 不阻塞本变更；归档前建议 `openspec init --tools none` |

## 5. 任务 → 执行步骤映射

环境标记：`L` = 本 Linux 工作区可执行；`M` = 需 macOS + Xcode；`D` = 需 Android 真机；`LM` = L 编写、M 验证。

| 任务 | 执行步骤 | 验证 | 环境 |
|---|---|---|---|
| 1.1-1.6 Phase 0 | pod install（关 Flipper）→ pbxproj 配置 → UtilsModule 骨架 → `fs.ios.ts` → 字体 | 模拟器四 Tab 无红屏；27 导出断言脚本 | M |
| 2.1 测试框架 | 选型（vitest 优先，纯逻辑无需 RN 运行时）+ `test` script | `npm test` 可执行 | L |
| 2.2 黄金基准 | 首选 Android 真机跑取证脚本；无真机时用 JDK 8 复刻 `AES.java`/`RSA.java` 路径引导，产出 `test/crypto-golden-vectors.json` | JSON 覆盖两种 mode + 非对齐 + 空/短 IV + RSA 双 padding | D→L |
| 2.3 脚本回归集 | 收集 ≥10 个社区脚本 + 加载/搜索/取链接断言 | 一键可跑 | L |
| 3.1 Rust 工作区 | `rust/lxcore` + staticlib；iOS target 编译已在 GH Actions macos-15 通过 | `cargo build` 过；哑函数经桥调通 | L+M（编译部分已 GH 验证） |
| 3.2-3.3 加密核心 | 按 design.md 契约表 8 条实现；黄金基准入 `cargo test` | `cargo test` 100% 字节级 | L |
| 3.4 iOS 薄封装 | 4 个同步宏 + `requiresMainQueueSetup=NO` | 经桥复跑基准一致 | M |
| 4.1-4.3 JSC 沙箱 | JSContext + console → 7 注入 → 反向通道 + 定时器 | 逐函数对照 + `inited` 事件 | M |
| 4.4 门槛 | 导入社区源 | 设置页"已加载"+搜索有结果 | M |
| 4.5 G1 | 回归集全量跑 | 报告落盘，按 D6 判读 | M |
| 5.1-5.7 播放 | track-player → `iosCategory` → 锁屏 → 缓存降级 → CacheModule | 后台/锁屏实测；不兼容则 1 天切上游 4.x | M |
| 6.1-6.9 功能 | gzip(`windowBits=31`) → toast → 深链 → 文档类型 → ChoosePath → 杂项 → 同步 → tools 分支 | 主流程全通；`.lxmc` 双向 | M（6.7 需双端） |
| 7.1-7.7 打磨 | 降级桩 → 布局 → CI job → 真机 → Android 构建回归 | 30 分钟无崩溃；CI 绿；Android release 构建过 | M+L（7.5 已完成：GH Actions unsigned build 过） |

**何时停止（阶段级）**：每组门槛任务（1.6 / G1 / 5.7 / 6.9 / 7.6）未过不进下一组；3.1 当天不过即走 D2 退路并回改 design。

## 6. 必跑验证

- `cargo test -p lxcore-crypto`（黄金基准全量，字节级）—— 加密合入前置
- `npm test`（框架建成后）与 `npm run lint`
- 模拟器：启动无红屏 / 搜索有结果 / 后台出声 / 锁屏可控（M 环境）
- 跨端：`.lxmc` 与同步报文双向互通；Android 侧解出 iOS 生成的 RSA 公钥
- G1 回归集报告（落盘 `evidence/g1-report.md`）
- CI：iOS unsigned build job 通过一次真实触发 ✅（run 32705189097，2026-08-24）
- `openspec validate add-ios-support`（归档前）

## 7. README / AGENTS / spec 同步判断

| 目标 | 判断 |
|---|---|
| README | **需同步**：第 28 行「没有计划支持 iOS」与本变更直接冲突，交付时更新平台说明与自编译指引（分发主推路径） |
| AGENTS.md | 仓库不存在；无需同步。可选：实施期间补一份承载构建/验证命令 |
| `openspec/project.md` | 不存在（未 init）；建议归档前 `openspec init --tools none`，不阻塞 |
| `openspec/specs/` | 归档时由 6 份 delta spec 自动建立 |
| docs/ 五份 | 已是决策源，实施中若发生设计偏离（如 D2 退路被触发），**先改 design.md 再继续** |

## 8. 停止条件

1. 非目标被触碰（尤其任何 Android 行为变更超出 assets 路径映射）。
2. 任务 3.1 在 macOS 环境具备后仍无法链接 Rust staticlib → 触发 D2 退路，本计划作废重写加密部分。
3. 黄金基准只有 JDK 引导版且始终拿不到 Android 真机 → Phase 1 验收暂停（JDK 向量不能替代真机基准进入发布）。
4. 工作区出现未受 `.gitignore` 保护的凭据/密钥文件 → 停止提交并上报。
5. G1 判读为核心音源系统性失败 → 本变更止步于沙箱验收，二期评估另立 change，不带病放行。
