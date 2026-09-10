# 交付报告：bootstrap-ai-baseline

日期：2026-08-26　分支：`dev-ios`

本文含三部分：Spec Compliance Report（任务 7.4）、Verification Report（任务 7.5）、Verification before Completion（任务 7.6）。所有命令输出均为本次实跑，未实跑项显式标注。

---

## 一、Spec Compliance Report

### capability: ai-collab-baseline

| Requirement | 状态 | 实现证据 |
|---|---|---|
| 三层事实源可用 | 满足 | `README.md`（入口，新增 SpecCoding 段）→ `AGENTS.md`（规则）→ `spec/{requirements,design,structure}.md`（架构）。README 中三层均有可点击链接 |
| 长期事实与单次变更分离 | 满足 | `AGENTS.md` 文档同步纪律章明确「不把单次变更过程（CI run 编号、任务勾选、验证证据）写进 README/AGENTS/spec」；本报告本身落在 `openspec/changes/<name>/evidence/` |
| 入口文档数字不漂移 | 满足 | README 两处 `13 项`→`25 项`、`23/41`→`27/41`；实测 `rg -c "await runTest\('" src/utils/ciSelfTest.ts` = 25，`openspec list` = 27/41 |
| 工具来源可审计 | 满足 | `docs/tooling-sources.md` 列 8 项工具，每项含取值命令；版本均为本次 `--version` 实测（openspec 1.8.0、codegraph 1.5.0、node v26.5.1、npm 12.0.2、vitest 4.1.11、eslint 8.57.1、tsc 5.9.3、rustc 1.97.1） |
| 本地私有产物不入库 | 满足 | `.gitignore` 新增 `.worktrees/`、`.claude/settings.local.json`；`git check-ignore -v` 命中 `.gitignore:81`、`.gitignore:82` 而非用户级规则 |

### capability: verification-gates

| Requirement | 状态 | 实现证据 |
|---|---|---|
| 门禁可真实通过 | **部分满足** | `npm run lint` 从 92708 errors 降至 3 errors + 1 warning，exit 仍为 1。剩余 3 处为既有源码债，用户明确「只报告不改」，已在 `AGENTS.md` 逐条登记（含文件、行号、规则名、引入提交） |
| 第三方脚本不受项目风格治理 | 满足 | `.eslintrc.cjs` ignorePatterns 追加 `test/scripts-regression/candidates`（第 83-84 行含说明注释）；`AGENTS.md` 安全边界章补「自研测试代码不得放这里」 |
| 门禁执行位置明确 | 满足 | `AGENTS.md` 验证矩阵 10 行，每行标注真实 CI 位置；由 `rg -n 'npm run lint\|npm test\|tsc\|cargo' .github/workflows/` 逐条核对 |
| 任务计数真实 | 满足 | 删 `add-ios-support/tasks.md` 首行脚手架残留 `* [ ]`；`openspec list` 从 27/42 变为 27/41 |

### 偏差说明

1. **「门禁可真实通过」未完全满足**：`npm run lint` exit=1。范围决策为「仅忽略第三方脚本」，`src/` 3 处既有违规只报告不改。已转为 `AGENTS.md` 中的显式登记债项，不伪装为绿。
2. **`tsc --noEmit` 23 errors 未修**：proposal 非目标已声明。已在 `AGENTS.md` 验证矩阵与 `spec/design.md` 已知技术债表登记为「无 CI 覆盖」的红项。

无未声明的偏差。

---

## 二、Verification Report

### 实跑命令

| 命令 | 结果 | 说明 |
|---|---|---|
| `npx vitest run` | **PASS** exit=0 | 1 文件 4 用例，270ms |
| `openspec validate --all --strict` | **PASS** exit=0 | 2 passed, 0 failed |
| `openspec list` | add-ios-support 27/41、bootstrap-ai-baseline `✓ Complete` | 计数与实际一致 |
| `npm run lint` | 3 errors + 1 warning，exit=1 | 与改动前基线（92708 errors）对比降幅 99.997%；本次未新增违规 |
| `git check-ignore -v .worktrees/probe .claude/settings.local.json` | 命中 `.gitignore:81`、`.gitignore:82` | 不再依赖仓库外规则 |
| `git status --short` | 4 M + 6 ?? | 见下 |

### 事实核对（防幻觉）

| 核对项 | 命令 | 结果 |
|---|---|---|
| workflows 门禁位置 | `rg -n 'npm run lint\|npm test\|tsc\|cargo' .github/workflows/` | lint 仅 `build-test.yml:25`；`npm test` 在 `ios-verify.yml:52`；`tsc` **0 处命中** |
| `build-test.yml` 触发 | `rg -n -A6 '^on:'` | 仅 `pull_request: branches: [dev]` |
| `ios-verify.yml` job 名 | `rg -n '^  [a-z0-9-]+:$'` | js-verify / rust-ios-target / ios-build / ios-simulator-smoke / android-regression，共 5 个 |
| 平台扩展文件 | `find src -name '*.ios.*' -o -name '*.android.*'` | 6 个，与 `spec/design.md` 表格逐项一致 |
| 自测用例数 | `rg -c "await runTest\('"` | 25，无被注释项 |
| `spec/structure.md` 目录 | 逐项 `[ -e ]` | 12/12 存在 |
| skills 名称 | `ls .claude/skills/ .agents/skills/` | 12 个，两份一致，`AGENTS.md` 表中 8 个引用名均存在 |
| fork 依赖 | `rg 'track-player\|file-system' package.json` | 两者均为 `github:lyswhut/...#<commit>` |
| `.codegraph` 忽略机制 | `git check-ignore -v .codegraph/codegraph.db` | 命中 `.codegraph/.gitignore:4`，**非**根 `.gitignore` |
| `moduleSuffixes` 现状 | `rg moduleSuffixes tsconfig.json` | 未配置，与 `spec/design.md` 描述一致 |

`.codegraph` 一项推翻了初稿写法（原写「已在 `.gitignore`」），已在 `AGENTS.md`、`spec/structure.md`、`docs/tooling-sources.md` 三处更正。

### 未验证项

| 项 | 原因 | 风险 |
|---|---|---|
| iOS 模拟器冒烟、iOS 构建 | 需 macOS Runner，本地 Linux 无法执行 | 低：本次未改任何 iOS 原生代码、CI 工作流或 JS 业务代码 |
| Rust 黄金基准、交叉编译 | 未执行（本次不涉及 `rust/`） | 低：`rust/` 零改动 |
| Android release 回归 | 未执行 | 低：`android/`、`assets/` 零改动 |
| `npx tsc --noEmit` | 已知红项，非本次门禁 | 已登记，状态与改动前相同（本次只增 `.md`，不影响类型检查） |

### 工作区边界核查

```
 M .eslintrc.cjs
 M .gitignore
 M README.md
 M openspec/changes/add-ios-support/tasks.md
?? AGENTS.md
?? CLAUDE.md
?? docs/tooling-sources.md
?? openspec/changes/add-ios-support/evidence/g1-report.md   ← 用户未提交内容，全程未触碰
?? openspec/changes/bootstrap-ai-baseline/
?? spec/
```

改动 4 个既有文件、新增 5 项。`evidence/g1-report.md` 保持 `??` 原样。无凭据、无构建产物、无本机配置进入改动面。

---

## 三、Verification before Completion

### Verification

见上节。核心结论：`vitest` 与 `openspec validate --all --strict` 两项绿；`npm run lint` exit=1 但为已登记既有债、本次无新增；iOS/Rust/Android 三类门禁未跑，因本次零改动于对应目录。

### Documentation Sync

| 文件 | 判断 | 处置 |
|---|---|---|
| `README.md` | 需更新 | 追加 SpecCoding 工作流入口段（含三层事实源表、四工件流程图、常用命令）；修正 3 处过期数字。既有业务说明与协议条款零改动 |
| `AGENTS.md` | 新建 | 项目规则唯一来源 |
| `CLAUDE.md` | 新建 | 仅客户端差异，指向 `AGENTS.md` |
| `spec/` | 新建三件套 | 长期需求 / 架构 / 目录职责 |
| `docs/tooling-sources.md` | 新建 | 工具版本口径与不应提交清单 |
| `openspec/specs/` | 无需更新 | 目录为空；本 change 未归档，capability 事实待归档时回写 |
| `.agents/` `.codex/` `.claude/` skills | 无需更新 | 未改 skill 内容 |

### Residual Risk

| 风险 | 等级 | 说明与缓解 |
|---|---|---|
| `npm run lint` 仍 exit=1 | 中 | 3 处既有违规未修（范围外）。已在 `AGENTS.md` 逐条登记含引入提交。修复应另立 change |
| `dev-ios` push 不跑 lint | 中 | 根因已定位：`build-test.yml` 仅 PR→`dev` 触发。这是 `Main.tsx:33`、`userApi.ts:85` 两处违规在 iOS 适配期无人拦截的原因（分别由本 change 分支的 `fecd1a7`、`78611eb` 引入）。本次未改 CI 触发条件（proposal 非目标），改为在 `AGENTS.md` 与 `CLAUDE.md` 写入「`dev-ios` 改代码后本地必跑 lint」。**建议后续单独立 change 给 `dev-ios` push 加 lint job** |
| `tsc --noEmit` 23 errors 无 CI 覆盖 | 中 | 已登记。实测加 `moduleSuffixes` 会使总数 23→25（暴露此前被掩盖的 4 个），故修复需独立 change |
| skills 三副本手工同步 | 低 | 已写入 `spec/design.md` 已知技术债与 `docs/tooling-sources.md`，有漂移时可发现 |
| 新增文档随代码演进而过期 | 低 | `AGENTS.md` 文档同步纪律表给出每份文件的更新触发条件；完成前自检清单含文档同步判断项 |
| 本报告的 iOS 相关结论依赖历史 CI | 低 | 本次未跑 iOS 门禁，README 中 27/41、25 项等数字来自代码与 `tasks.md` 静态核对，非本次 CI 运行结果 |

### 归档判断

本 change **暂不归档**。`openspec/specs/` 目录当前为空，归档需一并建立长期 capability 事实并同步；且 lint 门禁尚未全绿。建议在 `dev-ios` 合并前，与 `add-ios-support` 一起走归档流程。

---

## 五、归档前验证跟进（2026-09-10）

2026-09-10 按 `openspec-verify-change` 复验，发现 1 个 CRITICAL（实现产物未提交）与 4 个 WARNING，均为交付后世界状态变化所致：`add-ios-support` 在 2026-09-09 由 `21b6ff3` 归档（62 项全勾，32 条需求入主规范），本 change 交付时引用的数字与路径随之过期；任务 1.4 的脏行删除因当时未提交而随归档复发。同日按用户要求全部修复：

| 问题 | 修复 | 复验（本次实跑） |
|---|---|---|
| `npm run lint` exit 1（3 errors + 1 warning 登记债） | 三处无行为变化的风格修复：`Main.tsx:33` 数组括号空格、`userApi.ts:85` 补 `as string`（`typeof` 守卫已保证运行期类型，类型断言编译期擦除）、`common.ts:74` 删多余空行 | `npm run lint` exit 0 |
| README/AGENTS 自测 29 项、进度 33/51、任务清单旧路径、iOS「适配中」 | 同步为 35 项（`rg -c "runTest\(" src/utils/ciSelfTest.ts` 实测）、62/62 全勾归档、路径改指 `archive/2026-09-09-add-ios-support/tasks.md`、状态改「已归档（单设备验证通过，多设备覆盖为观察项）」 | `rg` 复核四处一致 |
| 归档副本 `tasks.md` 首行脏行 `* [ ]` 复发 | 删除该行与紧随空行 | `rg -n '^\* \[ \]'` 无命中；`- [X]` 计数仍为 62 |
| `spec/structure.md` 列 `ios/rust-libs/` 但本机不存在 | 标注为 macOS Runner 构建期产物 | — |

未修复项（维持登记）：`tsc --noEmit` 21 errors（15 在 `ciSelfTest.ts`，6 在业务文件），与 `AGENTS.md` 记录一致，修复仍应另立 change。

复验命令（2026-09-10 实跑）：`npm run lint` exit 0、`npx vitest run` 1 文件 4 用例、`openspec validate --all` 7 passed、`git check-ignore -v` 命中仓库 `.gitignore:81,82`。

归档判断更新：文档欠账已清，待实现产物随提交入库后即可归档。
