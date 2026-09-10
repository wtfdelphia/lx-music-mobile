# AGENTS.md

面向所有 AI agent（Codex、Claude Code、Cursor、OpenCode、Gemini、Copilot 等）的项目统一规则入口。
客户端专属差异写在各自文件（如 `CLAUDE.md`），有冲突时以本文为准。

回答语言：中文。技术术语与代码标识符保留原文。

## 事实源顺序

进入任务前按序读取，不跳级：

1. `README.md` — 项目入口、命令、AI 工作流入口
2. 本文 — 规则、门禁、验证矩阵、高风险清单
3. `spec/` — 长期需求（`requirements.md`）、架构（`design.md`）、目录职责（`structure.md`）
4. `openspec/changes/<name>/` — 当前变更的 proposal / specs / design / tasks
5. `docs/tooling-sources.md` — 工具版本与安装口径

`openspec/changes/` 内是单次变更的过程事实，会被归档。`README.md`、本文、`spec/` 是长期事实，需持续维护。判断冲突时长期事实优先，但发现长期事实已过期要当场指出，不要绕过。

## 项目上下文

LX Music 移动版（`lx-music-mobile`），基于 React Native 的音乐播放器。iOS 支持已于 2026-09-09 完成并归档（`add-ios-support`，单设备验证通过，多设备覆盖为观察项），2026-09-10 随上游 v1.8.1→v1.8.4 的 24 个提交一起并入 `main`（合并提交 `bf16638`）；`dev-ios` 与上游 `master` 保留。上游开发分支为 `dev`。

技术栈与版本底线（来源 `package.json`、`.nvmrc`）：

| 项 | 版本 | 说明 |
|---|---|---|
| React Native | 0.73.11 | 不擅自升级 |
| React | 18.2.0 | 固定版本，非 `^` |
| TypeScript | ^5.9.3 | `tsconfig` 继承 `@react-native/typescript-config` |
| Node | >= 18（CI 实跑 v22） | 下限来自 `engines`，CI 用 `.nvmrc` 的 `v22` |
| 导航 | react-native-navigation 7.39.2 | 非 React Navigation |
| 测试 | vitest ^4.1.11 | `npm test` |
| Rust | stable（CI 用 `dtolnay/rust-toolchain@stable`） | 仅 iOS 加密核心 `rust/lxcore`，Android 不链接 |

平台差异靠 Metro 的平台扩展解析（`*.ios.ts` / `*.android.ts`），业务代码不做 `Platform.OS` 分支散落。现有平台扩展文件：`src/components/common/DrawerLayoutFixed.ios.tsx`、`src/utils/exportPicker.ios.ts`、`src/utils/fs.ios.ts`、`src/utils/localMediaMetadata.ios.ts`、`src/utils/nativeModules/lyricDesktop.ios.ts`、`src/utils/statusbarHeight.ios.ts`、`src/utils/toast.android.ts`、`src/utils/toast.ios.tsx`、`src/utils/version.ios.js`。

长期架构事实见 `spec/design.md`，目录职责见 `spec/structure.md`，业务边界见 `spec/requirements.md`。

## AI 协作纪律

- **Think Before Coding**：不静默猜测需求、原生桥接契约、加密语义或平台行为差异；有多种解释时先列取舍或提问。
- **Simplicity First**：只做当前规格范围内的最小可行改动，不增加未要求的抽象、配置或扩展点。
- **Surgical Changes**：只改当前变更直接相关文件；不顺手格式化、重构或删除无关代码。发现无关问题只登记，不动手。
- **Goal-Driven Execution**：每个任务先定义成功标准与验证命令；未实际运行的验证不得声称通过。

## OpenSpec 门禁

必须先建 `openspec/changes/<change-name>/` 的场景：

- 新增业务能力或用户可见行为
- 跨模块改动（`src/` 多目录、或 JS 与原生同时改）
- 新增或修改原生模块（`android/app/src/main/java/cn/toside/music/mobile/`、`ios/LxMusicMobile/Modules/`）
- 加密实现变更（任何触及 AES/RSA 契约的改动）
- 自定义源沙箱（`userApi`）行为或注入面变更
- 播放链路、后台播放、锁屏控制
- 深链与文件导入（`.lxmc`、`CFBundleDocumentTypes`、`Linking`）
- 数据同步协议（`src/plugins/sync/`）
- CI 工作流 job 结构、触发条件、门禁增删
- 发布配置（Bundle ID、版本号、签名、`Info.plist`、`build.gradle`）
- 依赖新增、升级或 fork 切换
- 大范围重构

无需建 change：拼写修正、注释小修、单行无行为变化的修复。但行为纪律与验证纪律仍适用。

停止条件（出现即停下问人）：

- 需求有多种解释且影响原生契约、加密语义、沙箱边界或发布配置
- 无法判断改动边界或影响面
- 无法确定验证方式
- 多个活跃 change 无法判断当前目标
- 需要改动工作区里的未提交内容

## Skills 门禁

项目内 skills 有三份内容一致的副本，各 12 个：`.agents/skills/`（通用）、`.codex/skills/`、`.claude/skills/`。客户端不支持时必须等价遵循流程并输出同样的证据。**任一副本变更时同步另两份**，否则不同客户端拿到不同规则。

| 场景 | 必用或等价遵循 | 必须产出 |
|---|---|---|
| 需求不清、想先探讨再动手 | `openspec-explore` | 澄清后的需求或问题边界 |
| 新需求、跨模块、高风险变更 | `openspec-new-change` | `openspec/changes/<name>/` 四工件 |
| 需求已明确，要一次生成完整提案 | `openspec-propose` | proposal + design + specs + tasks |
| 补齐未完成变更工件 | `openspec-apply-change` | proposal / specs / design / tasks |
| 开始实现某个 change | `openspec-superpowers-bridge` | Bridge Plan（范围、非目标、高风险项、影响面证据、任务到执行步骤、必跑验证、停止条件） |
| 实现中发现设计偏差 | 先更新工件再改代码 | 更新后的 design / tasks / specs |
| 实现后、代码审查前后、归档前 | `spec-compliance-check` | Spec Compliance Report |
| 归档前 | `openspec-verify-change` | Verification Report |
| 最终回复、PR、归档、合并前 | `verification-before-completion` | Verification + Documentation Sync + Residual Risk |
| 不归档但要同步长期规范 | `openspec-sync-specs` | 更新后的 `openspec/specs/` |
| 归档已完成变更 | `openspec-archive-change` | 归档结果 + 长期事实同步说明 |
| 写提交信息 / PR 标题 / squash 信息 | `caveman-commit` | 见「提交信息纪律」 |
| 新增或改写 Markdown 文档 | `humanizer-zh` | 见「文档去 AI 痕迹」 |

## 上下文获取

CodeGraph 已在本仓库索引（`.codegraph/`，本机产物，由该目录自带 `.gitignore` 自忽略）：

```bash
codegraph sync .                       # 改动后先同步
codegraph query "<符号名>"
codegraph callers "<函数>"             # 谁调用
codegraph callees "<函数>"             # 调用了谁
codegraph impact "<符号>"              # 影响面
codegraph explore "<业务问题>"          # 区域上下文 + 调用链
codegraph node "<文件或符号>"           # 源码 + 调用轨迹
```

已知参数坑：`codegraph files` **不支持** `--depth`。

改 iOS 原生代码或 CI 工作流前，先用 `codegraph impact` 或 `rg` 拿到影响面证据再动手，不凭记忆判断波及范围。

CodeGraph 只用于发现入口、调用链、影响面与候选测试。以下必须另外用 `rg` 或源码精读补盲：

| 盲区 | 补盲方式 |
|---|---|
| 原生桥接实参与返回契约 | 精读 `ios/LxMusicMobile/Modules/*.m` 与 `android/.../*Module.java` 两侧，逐参数比对 |
| Objective-C / Java 运行时行为 | 索引不覆盖动态派发与 fork 依赖内部；改桥接必须实机或模拟器验证 |
| CI 工作流与门禁位置 | `rg -n 'npm run lint\|npm test\|tsc\|cargo' .github/workflows/` |
| 平台扩展文件解析 | `find src -name '*.ios.*' -o -name '*.android.*'`；注意 TS 与 Metro 的解析规则不同 |
| Info.plist / Podfile / build.gradle | 直接读文件；配置项不进代码图谱 |
| 自定义源脚本注入面 | 精读 `assets/script/user-api-preload.js` 与 `src/utils/nativeModules/userApi.ts` |
| 加密字节级契约 | `test/crypto-golden-vectors.json` 是唯一权威；不靠读实现推断 |
| fork 依赖行为 | `react-native-track-player`、`react-native-file-system` 等为 fork commit 锁定，行为可能与上游文档不符 |

## 验证矩阵

每项均标注真实执行位置。**已知红项不得表述为生效中的门禁。**

| 验证项 | 命令 | 状态 | CI 执行位置 |
|---|---|---|---|
| 单元测试 | `npm test` | 绿（1 文件 4 用例） | `ios-verify.yml` js-verify job |
| 代码风格 | `npm run lint` | 绿（退出码 0，登记债已清零） | `build-test.yml`，**仅 PR→`dev` 触发** |
| 类型检查 | `npx tsc --noEmit` | **红：21 errors**，15 个在 `src/utils/ciSelfTest.ts`，6 个在既有业务文件 | **无 CI 覆盖** |
| Rust 加密黄金基准 | `cd rust/lxcore && cargo test --locked` | 绿 | `rust.yml`、`ios-verify.yml` rust-ios-target job |
| Rust iOS 交叉编译 | `cargo build --locked --release --target aarch64-apple-ios` | 绿 | `ios-verify.yml` rust-ios-target job |
| Metro 双端打包 | 见 `ios-verify.yml` js-verify job | 绿 | 同上 |
| iOS 未签名构建 | `xcodebuild` + IPA 打包 | 绿 | `ios-verify.yml` ios-build job |
| iOS 模拟器冒烟 | 应用内 35 项自测 + `node test/ci-report-assert.js` | 绿 | `ios-verify.yml` ios-simulator-smoke job，runtime 钉死 `iOS 18.5`（找不到目标 runtime 即 `exit 1`，报告 `env.ciRuntime` 自报执行环境、断言端核对） |
| Android release 回归 | preload 入包校验 | 绿 | `ios-verify.yml` android-regression job |
| OpenSpec 一致性 | `openspec validate --all` | 绿 | 无 CI 覆盖，本地必跑 |

既有 lint 债已于 2026-09-10 清零（`Main.tsx:33` 2 个 `array-bracket-spacing`、`userApi.ts:85` 的 `no-unsafe-argument`、`common.ts:74` 的 `no-multiple-empty-lines`，均为无行为变化的风格修复），`npm run lint` 退出码 0。历史背景：前两处由 `dev-ios` 分支自身的提交引入（`fecd1a7`、`78611eb`），根因是 `build-test.yml` 只在 PR→`dev` 触发，`dev-ios` 的 push 从不跑 lint。**在 `main` / `dev-ios` 上改代码后请本地跑 `npm run lint`，不要依赖 CI 兜底。**

类型检查现状：`tsc --noEmit` 未进 CI 是因为当前红，加了会立即阻断 `main`。2026-09-10 复测：在 `tsconfig.json` 加 `moduleSuffixes: [".ios", ".android", ".native", ""]` 可消除平台扩展解析类错误（`tools.ts` 的 `./toast`），但会新暴露 4 个此前被掩盖的错误（`src/core/common.ts` 2 个、`ChoosePath/index.tsx` 1 个、`OpenStorageModal.tsx` 1 个），错误总数 21→23。修复应另立 change。

## 高风险检查

| 变更范围 | 必须检查 |
|---|---|
| 加密实现 | 黄金基准 `cargo test --locked` 全通过；`test/crypto-golden-vectors.json` 是权威，不改基准来迁就实现；iOS 侧另需经桥实测 |
| 原生模块 | 两侧签名与返回类型逐项比对；`Promise` vs 同步方法语义不得混用；模块注册（`*Package.java` / `RCT_EXPORT_MODULE`）已挂载 |
| 自定义源沙箱 | 注入面变化必须跑脚本回归集；`assets/script/user-api-preload.js` 为双端共用，改动同时影响 Android |
| 播放链路 | 后台播放、锁屏元数据、缓存降级三项分别验证；`react-native-track-player` 为 fork，行为以实测为准 |
| 深链 / 文件导入 | `Info.plist` 的 `CFBundleDocumentTypes`、`Linking` 监听器数量、`.lxmc` 导入弹窗 |
| 数据同步 | 协议兼容性（旧客户端连新服务、反之）；加密握手路径 |
| 发布配置 | Bundle ID、版本号与 `versionCode` 一致性、字体入包、`UIAppFonts`、arm64 |
| CI 工作流 | 改触发条件前确认不会让现有门禁静默失效 |
| Android 行为 | 不引入任何 Android 行为变更（iOS 适配并入 `main` 后仍是硬约束）；触碰即停下确认 |

## 安全边界

- 不提交 token、Cookie、账号密码、keystore、签名证书、`.env`
- 不提交 `.worktrees/`、`.claude/settings.local.json`（已在根 `.gitignore`）；`.codegraph/` 由目录内自带的 `.gitignore` 自忽略
- 报告与文档中不粘贴真实凭据；引用时只写键名不写值
- `test/scripts-regression/candidates/` 只放第三方社区音源脚本原文，已从 lint 豁免。**自研测试代码不得放这里**，否则失去风格覆盖
- 第三方脚本不做格式化、不加 `eslint-disable`、不改写原文

## 提交信息纪律

提交信息、PR 标题、squash 信息统一走 `caveman-commit`。客户端不支持 skill 时按 `.agents/skills/caveman-commit/SKILL.md` 规则等价产出。

**门禁时点是执行命令之前，不是事后补救。** 以下命令在跑之前必须已经过 `caveman-commit`：

- `git commit`（含 `-m`、`-F`、走编辑器三种形式）
- `git commit --amend` 改动信息时
- squash / `git rebase` 重写信息时
- `gh pr create` 的标题与 `--body`

不允许「先随手 `-m` 提上去，再 `--amend` 修文案」。`--amend` 会重写已有提交，在已推送的分支上要么强推要么留下分叉，代价远高于提交前多花一步。

要点（完整规则见 skill）：

- Conventional Commits：`<type>(<scope>): <祈使式摘要>`，摘要用中文祈使式，代码标识符保持原文
- 长度按显示宽度计（CJK 算 2 宽度）：目标 ≤50，硬上限 72；结尾不加句号
- scope 复用既有词表，不新造同义词
- 正文默认省略，只写非显而易见的 why；breaking change、安全修复、schema 迁移、revert、告警门禁/发布路径/凭据相关改动必须写正文
- 禁止「本次提交做了 X」式复述、emoji、在正文里叙述 AI 参与过程
- 提交信息、PR 标题、squash 信息不写 `Assisted-by`、`Co-Authored-By`、`Co-authored-by` 等 AI 归属；真人共同作者的 `Co-authored-by` trailer 按实际协作保留

只在用户明确要求时创建提交。

## 文档去 AI 痕迹

所有新增或改写的 Markdown 文档在交付前必须过一遍 `humanizer-zh`。适用范围：`docs/`、`README*.md`、`AGENTS.md`、`CLAUDE.md`、`spec/`、`openspec/changes/<name>/` 下的 proposal 与 design。

重点清理：夸大意义的套话（「标志着」「至关重要的作用」「不断演变的格局」）、三段式强行列举、`-ing` 式肤浅收尾、否定式排比（「不仅……而且……」）、模糊归因（「专家认为」「行业报告显示」）、破折号与粗体滥用、通用积极结论、emoji 装饰。

例外与边界：

- 提交信息、PR 标题、squash 信息走 `caveman-commit`，不走本条
- `openspec/specs/**/spec.md` 的规范条款保留 MUST / SHALL / SHOULD 原文与编号结构，只清理说明性段落
- 代码块、命令、配置、表格中的字段名与路径一字不改
- 技术判断的强度不因「去痕迹」而软化：该说破坏性变更就直说，不改成模糊限定
- 排查记录、证据清单、结论编号表里的「粗体前缀 + 冒号」是索引结构而非装饰，保留

## 文档同步纪律

每次变更完成前必须判断，并在最终报告说明结论与原因：

| 文件 | 何时必须更新 |
|---|---|
| `README.md` | 启动/构建/测试/部署命令变化、新增主要能力、AI 开发流程入口变化、依赖工具变化。README 中引用的进度数字与用例数必须与 `tasks.md`、`ciSelfTest.ts` 实际值一致 |
| `AGENTS.md` | 新增高风险类型、验证命令增删或状态翻转（红↔绿）、OpenSpec/skills 门禁变化、编码规范变化、新增 AI 客户端或 MCP |
| `spec/` | 长期需求、架构、模块边界、目录职责发生变化 |
| `openspec/specs/` | change 归档时同步长期 capability 事实 |
| `docs/tooling-sources.md` | 工具版本口径或安装方式变化 |

不把单次变更过程（CI run 编号、任务勾选、验证证据）写进 `README.md`、`AGENTS.md` 或 `spec/`；这些留在 `openspec/changes/<change-name>/`。

`docs/` 下的方案文档若把待做项写成了现状（或反之，已落地却仍列为待做），发现即修正。方案文档必须能被读者当作行动依据，标注失真比内容缺失更有害。

## 工作区边界

不修改用户未提交的工作区内容。开工前跑 `git status --short` 记录基线，完成前再跑一次比对，确认改动面与变更声明一致。

需要改动未提交内容时停下问人（见「停止条件」）。若某项改动依赖未提交文件（例如规则文件本身尚未入库），在提交信息或报告里说明其归属，不擅自纳入本次提交。

## 完成前自检

- [ ] 已运行必要验证，且只报告真实运行过的命令与结果
- [ ] 未运行的必要验证已说明原因与剩余风险
- [ ] `tasks.md` 勾选状态真实
- [ ] `openspec validate --all` 通过或已说明失败原因
- [ ] `git status --short` 已检查，未误纳入本地配置、日志、构建产物、凭据
- [ ] 未改动用户未提交的工作区内容
- [ ] 文档同步判断已完成并写入报告
- [ ] 新增或改写的 Markdown 已过 `humanizer-zh`
- [ ] 提交信息 / PR 标题在执行命令前已过 `caveman-commit`，无 AI 归属 trailer
- [ ] 在 `main` / `dev-ios` 改过代码则已本地跑 `npm run lint`（两分支 push 都不触发 lint）
