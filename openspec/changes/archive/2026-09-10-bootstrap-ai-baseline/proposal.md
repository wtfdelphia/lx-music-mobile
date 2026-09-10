## Why

项目已有 OpenSpec（1 个活跃 change，四工件齐）、CodeGraph 索引和三套 skills 目录，但缺少 `docs/AI 辅助开发工程化落地白皮书.md` 阶段 3 要求的「三层事实资产」中的第二、三层：没有 `AGENTS.md`（规则事实），没有 `spec/`（架构事实）。新会话的 AI 只能读 README（业务向、无工程纪律）和用户级 `CLAUDE.md`（跨项目通用、不含本项目底线），必须靠反复探查才能拿到「技术栈底线、OpenSpec 条件、验证命令」这类每次都要用的事实。

同时白皮书「验证真实化」在本项目当前不成立，三处已实测：

- `npm run lint` 报 92708 errors，其中 92705 个来自 `test/scripts-regression/candidates/` 的 23 个第三方社区音源脚本（非本项目代码风格治理对象）。门禁事实上永远红，等于无门禁。
- `npx tsc --noEmit` 报 23 个错误，且没有任何 CI 工作流跑类型检查。
- `openspec status` 报 `27/42 tasks`，真实是 27/41 —— `add-ios-support/tasks.md` 第 1 行有一个脚手架残留脏行 `* [ ]`。

以及 Gate 8「README 同步」有两处过期数字：README 写「任务进度 23/41」（真实 27/41）、「应用内 13 项自测」（`ciSelfTest.ts` 实际 25 个 `runTest` 用例）。

## What Changes

- 新增 `AGENTS.md`：AI agent 统一规则入口（技术栈底线、OpenSpec 条件、skills 门禁、高风险检查矩阵、真实验证命令、README/AGENTS 同步纪律）
- 新增 `CLAUDE.md`：只写 Claude Code 专属差异并指向 `AGENTS.md`，不与之冲突
- 新增 `spec/requirements.md`、`spec/design.md`、`spec/structure.md`：从现有代码结构、`docs/ios-optimal-plan.md` 和 `add-ios-support` 工件提炼长期事实
- 新增 `docs/tooling-sources.md`：工具来源与本机核验版本表，含「不应提交」列
- `.eslintrc.cjs` `ignorePatterns` 追加 `test/scripts-regression/candidates`，使 `npm run lint` 成为真实可通过的门禁
- `.gitignore` 追加 `.worktrees/`、`.claude/settings.local.json`（当前仅靠用户级全局 ignore 兜住，换机器即泄露）
- `README.md` 增量追加 SpecCoding/OpenSpec 工作流入口段，并修正两处过期数字
- 删除 `add-ios-support/tasks.md` 第 1 行脏行 `* [ ]`，使 openspec 任务计数真实

## Capabilities

### New Capabilities

- `ai-collab-baseline`: AI 协作的事实源分层、规则入口与文档同步纪律
- `verification-gates`: 项目验证门禁的真实可用性（lint / test / typecheck / openspec 的口径与执行位置）

### Modified Capabilities

无（`openspec/specs/` 当前为空，项目尚无已归档的长期 spec）。

## Impact

- 文档：新增 `AGENTS.md`、`CLAUDE.md`、`spec/` 三件套、`docs/tooling-sources.md`；增量改 `README.md`
- 配置：`.eslintrc.cjs` 一处 `ignorePatterns`、`.gitignore` 两行
- OpenSpec：`add-ios-support/tasks.md` 删一行脏行（不改任何任务勾选状态）
- 零业务代码改动：不动 `src/`、`ios/`、`android/`、`rust/`、`test/`
- 不动工作区未提交内容：`openspec/changes/add-ios-support/evidence/g1-report.md`（untracked）保持原样

## 非目标

- 不修 `tsc --noEmit` 的 23 个既有类型错误（其中 17 个在 `src/utils/ciSelfTest.ts`，属 `add-ios-support` 范围；6 个在既有业务文件，属独立技术债）
- 不把 `tsc --noEmit` 加进 CI 门禁 —— 当前红，加了即阻断 `dev-ios`；本次只在 `AGENTS.md` 记录真实状态与后续 change 建议
- 不修 `src/` 那 3 处 lint 违规（`Main.tsx` 2 个 `array-bracket-spacing`、`userApi.ts` 1 个 `no-unsafe-argument`），属既有代码、超出本次范围，只在报告中登记
- 不合并、裁剪或改动 `.agents/` `.codex/` `.claude/` 三套 skills（内容 md5 相同，合并涉及各客户端发现机制，需独立 change 评估）
- 不改任何 CI 工作流的 job 结构与触发条件
- 不归档 `add-ios-support`
- 不引入新依赖

## 成功标准

- 场景：新会话 AI 读 `AGENTS.md` 即可拿到技术栈底线、OpenSpec 条件、skills 门禁与真实验证命令，无需探查
- 场景：`npm run lint` 退出码 0（第三方脚本被忽略后，本项目源码违规为已登记的 3 处以内 —— 若仍非 0 则不得声称本项目达成，须在报告说明）
- 场景：`openspec validate --all` 通过，且 `openspec list` 对 `add-ios-support` 显示 27/41 而非 27/42
- 场景：README 的进度数字与 `tasks.md`、`ciSelfTest.ts` 实际值一致
- 验证：`npm run lint`、`npx vitest run`、`openspec validate --all`、`openspec list`、`git status --short`

## 假设

- 假设 1：`test/scripts-regression/candidates/` 是入库的第三方社区音源脚本原文，不应被本项目 ESLint 风格规则治理（依据：`test/scripts-regression/README.md` 与 `.gitignore` 中「入库的是解压后的 .js」注释）
- 假设 2：`spec/` 三件套只记录当前已成立的事实，iOS 相关能力标注为「`dev-ios` 进行中」而非已交付
- 假设 3：用户级 `CLAUDE.md`（全局，含 Karpathy 四原则）继续生效，项目 `CLAUDE.md` 只做不冲突的补充

## 风险

- 风险：`ignorePatterns` 忽略第三方脚本后，若将来有人把自研代码放进 `candidates/`，将失去 lint 覆盖
  - 缓解：`AGENTS.md` 明确 `candidates/` 只放第三方脚本原文，自研测试代码放 `test/` 其他位置
- 风险：新增 `AGENTS.md` 与用户级 `CLAUDE.md` 或 `.claude/skills/` 规则冲突
  - 缓解：`AGENTS.md` 只写项目事实与项目门禁，行为纪律引用而不重述；`CLAUDE.md` 显式声明以 `AGENTS.md` 为准
- 风险：`spec/` 写入未核验事实，成为新的幻觉源
  - 缓解：每条事实标注来源（文件路径或本次实跑命令）；不确定处标「待核验」

## 范围演进记录（交付后补记）

原始范围与「非目标」以上文为准，交付后有两轮经用户指示的范围扩展，均已在 `tasks.md` 与 `evidence/` 登记：

1. 2026-09-10 验证跟进（`tasks.md` 第 8 节）：清零三处登记 lint 债（触碰 `src/` 3 个文件，均无行为变化，与原非目标「不修 `src/` 3 处 lint 违规」相悖，用户明确要求修复）；同步 `add-ios-support` 归档后的数字与路径欠账。
2. 2026-09-10 深度审核修复（`tasks.md` 第 9 节）：修复审核发现的文档失真（平台扩展清单 6→9、tsc 数字 23→21 与 `moduleSuffixes` 实验数字、`structure.md` 文件数、`tooling-sources.md`）；同步 skills 三副本漂移（7 个 openspec skills 停在 1.4.0，与原非目标「不改动三套 skills」相悖，漂移本身违反 `AGENTS.md` 同步纪律，以 `.agents` 1.8.0 为基准修复）；扩写 `openspec/specs/` 两个主规范 Purpose 使 `--strict` 通过。
