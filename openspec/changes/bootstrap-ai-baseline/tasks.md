# Tasks

## 1. 门禁真实化

- [X] 1.1 记录 `npm run lint` 改动前基线（92708 errors，26 个文件，其中 23 个为第三方脚本）
- [X] 1.2 `.eslintrc.cjs` 的 `ignorePatterns` 追加 `test/scripts-regression/candidates`
- [X] 1.3 验证：`npx eslint test/scripts-regression` 无文件被检查；`npm run lint` 退出码与剩余违规如实记录
- [X] 1.4 删除 `openspec/changes/add-ios-support/tasks.md` 第 1 行脚手架残留 `* [ ]` 及紧随空行
- [X] 1.5 验证：`openspec list` 对 `add-ios-support` 显示 27/41

## 2. 私有产物忽略

- [X] 2.1 `.gitignore` 追加 `.worktrees/` 与 `.claude/settings.local.json`
- [X] 2.2 验证：`git check-ignore -v` 对两者命中仓库自身 `.gitignore` 而非用户级规则

## 3. 规则事实层

- [X] 3.1 新增 `AGENTS.md`：技术栈与版本底线、OpenSpec 建 change 条件、skills 门禁矩阵、高风险检查项、验证矩阵（含每项的 CI 执行位置与已知红项）、README/AGENTS 同步纪律、第三方脚本目录约定
- [X] 3.2 新增 `CLAUDE.md`：Claude Code 专属差异，显式声明项目通用规则以 `AGENTS.md` 为准
- [X] 3.3 验证：交叉检查 `AGENTS.md` 中每条验证命令均为本次实跑过或已注明未跑及原因

## 4. 架构事实层

- [X] 4.1 新增 `spec/requirements.md`：长期需求、业务边界、非目标（iOS 标注为 `dev-ios` 进行中）
- [X] 4.2 新增 `spec/design.md`：架构风格、五个原生模块桥接契约、平台扩展文件机制、加密契约、测试策略
- [X] 4.3 新增 `spec/structure.md`：目录结构与职责归属（含实测文件数）
- [X] 4.4 验证：`spec/structure.md` 列出的每个目录真实存在

## 5. 工具来源

- [X] 5.1 新增 `docs/tooling-sources.md`：来源、本次核验日期与实测版本、用途、不应提交列
- [X] 5.2 验证：表中版本号均来自本次 `--version` 实测输出

## 6. 入口事实同步

- [X] 6.1 `README.md` 增量追加 SpecCoding/OpenSpec 工作流入口段（不覆盖既有业务说明与协议条款）
- [X] 6.2 修正 README 任务进度 23/41 → 27/41
- [X] 6.3 修正 README 应用内自测 13 项 → 25 项（两处）
- [X] 6.4 验证：README 数字与 `tasks.md`、`ciSelfTest.ts` 实测值一致

## 7. 交付验证

- [X] 7.1 运行 `npx vitest run`（回归基线不破）
- [X] 7.2 运行 `openspec validate --all`
- [X] 7.3 运行 `git status --short`，确认 `evidence/g1-report.md` 仍为未跟踪且无意外改动
- [X] 7.4 等价执行 `spec-compliance-check`，输出 Spec Compliance Report
- [X] 7.5 等价执行 `openspec-verify-change`，输出 Verification Report
- [X] 7.6 等价执行 `verification-before-completion`，输出 Verification + Documentation Sync + Residual Risk

## 8. 归档前验证跟进（2026-09-10，超出原 proposal 范围，用户明确要求修复）

- [X] 8.1 清零三处登记 lint 债（`Main.tsx:33`、`userApi.ts:85`、`common.ts:74`，均无行为变化），`npm run lint` 退出码 0；`AGENTS.md` 验证矩阵与登记段同步
- [X] 8.2 同步 `add-ios-support` 归档（`21b6ff3`）后的文档欠账：自测 29→35 项（README 两处、AGENTS.md）、任务进度 33/51→62/62 全勾归档、任务清单路径改指 `openspec/changes/archive/2026-09-09-add-ios-support/tasks.md`、iOS 状态「适配中」→「已归档」（README、`AGENTS.md`、`spec/requirements.md`）
- [X] 8.3 删除归档副本 `2026-09-09-add-ios-support/tasks.md` 复发的脚手架脏行 `* [ ]`（任务 1.4 的删除在归档时未随工作区带入，归档后复发）
- [X] 8.4 `spec/structure.md` 标注 `ios/rust-libs/` 为 macOS Runner 构建期产物（无构建环境本地不存在）
- [X] 8.5 复验：`npm run lint` exit 0、`npx vitest run` 1 文件 4 用例、`openspec validate --all` 通过、`npx tsc --noEmit` 仍 21 errors 无新增
