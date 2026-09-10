# Spec Compliance Report: bootstrap-ai-baseline

日期：2026-09-10　审查方式：`spec-compliance-check` 六维审查　分支：`dev-ios`

审查对象：提交 `3e9bae5`（风格修复）、`18a9d62`（基线入库与归档欠账）及其工件。本次审查发现 7 项问题并全部当场修复，修复本身构成 `tasks.md` 第 9 节。

## 六维结论

| 维度 | 状态 | 结论与证据 |
|---|---|---|
| Scope | PASS（含两轮已记录的范围扩展） | 原始范围与非目标见 `proposal.md`；两轮扩展（清零 `src/` lint 债、同步 skills 副本）均经用户指示、登记在 `tasks.md` 8/9 节与 `proposal.md` 范围演进记录，无未声明越界 |
| Design | PASS | design 三项关键决策均被遵循：`ignorePatterns` 位置（`.eslintrc.cjs:83-84`）、tsc 不进 CI（`rg tsc .github/workflows/` 0 命中）、私有产物由仓库自身 `.gitignore` 兜底（`.gitignore:81-82`）。design 原称「三份 skills md5 一致」失实，见发现项 F1 |
| Scenarios | PASS | 9 个 Requirement、14 个 Scenario 逐项有实现或实跑证据，见下表 |
| Project Rules | PASS | OpenSpec 四工件齐、`openspec validate --all --strict` 7/7；提交信息过 `caveman-commit`（无 AI 归属）；新增改写的 Markdown 过 `humanizer-zh`；skills 三副本漂移违反 `AGENTS.md` 同步纪律，已按纪律修复（F1） |
| Verification | PASS | 本报告引用的命令均为本会话实跑；未运行项（iOS 构建、模拟器冒烟）在 `delivery-report.md` 显式标注原因（Linux 无 Xcode）；tsc 红项未被表述为门禁 |
| README/AGENTS Sync | PASS | 自测 35 项、任务 62/62 归档、归档路径、iOS 状态四处数字在 `README.md`、`AGENTS.md`、`spec/` 间一致（`rg` 全仓无残留旧值） |

## Scenario 证据表

| Requirement / Scenario | 证据（本次实跑） |
|---|---|
| 三层事实源可用 | `README.md`（入口）、`AGENTS.md`（规则）、`spec/{requirements,design,structure}.md`（架构）均在库；`CLAUDE.md:3` 声明以 `AGENTS.md` 为准 |
| 架构事实与代码结构一致 | `spec/structure.md` 列出的 43 个目录/文件按层级语境逐个 `fs.existsSync` 核验，全部存在（首次脚本误把表格相对路径当根路径，修正后通过） |
| 入口文档数字不漂移 | `rg -c "runTest\(" src/utils/ciSelfTest.ts` = 35；归档副本 `- [X]` 计数 62、无 `- [ ]`；`README.md:98-100` 指向归档路径 |
| 工具来源可审计 | `docs/tooling-sources.md` 8 项，本次抽测 `openspec --version` 1.8.0、`codegraph --version` 1.5.0、`node -v` v26.5.1、`npx tsc --version` 5.9.3，与表一致 |
| 本地私有产物不入库 | `git check-ignore -v .worktrees/probe .claude/settings.local.json` 命中 `.gitignore:81,82` |
| 门禁可真实通过 | `npm run lint` exit 0；tsc 21 errors 按红项登记于 `AGENTS.md:134` |
| 第三方脚本不受风格治理 | `npx eslint test/scripts-regression` 报 No files matching（ignorePatterns 生效）；`candidates/` 内无自研代码 |
| 门禁执行位置明确 | `AGENTS.md:129-140` 矩阵 10 行，与 `rg` 核对 `.github/workflows/` 一致（lint 仅 `build-test.yml:25` PR→dev；`npm test` 在 `ios-verify.yml:52`） |
| 任务计数真实 | 归档副本首行脏行已删（`rg -n '^\* \[ \]'` 无命中）；本变更 `openspec` progress 38/38 |

## 发现项（全部已修复）

| 编号 | 严重度 | 发现 | 修复 |
|---|---|---|---|
| F1 | 高 | skills 三副本漂移：7 个 openspec skills 中 `.codex` 停留 1.4.0（2026-08-24 `fa557d9` 升级只覆盖 `.agents`/`.claude`），6 个 `.claude` 副本含客户端改写行。design.md 交付时「三份副本内容 md5 完全一致」的声称失实 | 以 `.agents` 1.8.0 通用版为基准覆盖另两份，12×3 md5 全同；`.claude` 的客户端改写行（`AskUserQuestion`、`/opsx:apply`）被通用措辞替换，符合 `AGENTS.md`「内容一致」纪律 |
| F2 | 高 | tsc 数字失真三处：基线 21 errors 被写成 23（`AGENTS.md` 已对、`spec/design.md`、`docs/tooling-sources.md` 仍写 23）；`moduleSuffixes` 实验数字「23→25」过期 | 重跑实验实测 21→23（新暴露 `core/common.ts` 2、`ChoosePath/index.tsx` 1、`OpenStorageModal.tsx` 1），三处统一改为 21 与 21→23 |
| F3 | 中 | 平台扩展清单过期：`AGENTS.md` 与 `spec/design.md` 列 6 个，实际 9 个（`add-ios-support` 归档任务 9.2/9.3/9.16 新增 `statusbarHeight.ios.ts`、`DrawerLayoutFixed.ios.tsx`、`exportPicker.ios.ts`） | 两处补全为 9 个并注明差异原因 |
| F4 | 中 | `openspec validate --all --strict` 红：主规范 `ios-distribution`、`ios-playback` Purpose 不足 50 字符（21b6ff3 归档时带入） | 扩写两段 Purpose（仅补充该规范自身已有内容，不改需求语义），`--strict` 7/7 exit 0 |
| F5 | 低 | `spec/structure.md` 文件数漂移：`utils/` 128→133、`components/` 71→72 | 更新为实测值 |
| F6 | 低 | `spec/design.md` 已知技术债表过期（仍写「3 处 lint 违规 exit=1」） | 按现状更新：lint 债已清零、tsc 21、skills 漂移事件入表 |
| F7 | 低 | 原始非目标与实际改动存在两处相悖（修 `src/` lint 债、改 skills 副本），此前只在交付报告侧记录 | `proposal.md` 增「范围演进记录」章，明确两轮扩展的依据与批准来源 |

## 剩余风险

| 风险 | 等级 | 说明 |
|---|---|---|
| `tsc --noEmit` 21 errors 无 CI 覆盖 | 中 | 已登记于 `AGENTS.md`；加 `moduleSuffixes` 会 21→23，修复需独立 change |
| `dev-ios` push 不触发 CI lint | 中 | `build-test.yml` 仅 PR→`dev`；已写入 `AGENTS.md` 本地必跑纪律，建议另立 change 补触发条件 |
| skills 三副本靠手工同步 | 低 | 漂移已实际发生一次（F1）。修复后仍无机制防再漂移，可考虑校验脚本（非本变更范围） |
| iOS 构建与模拟器冒烟本次未跑 | 低 | Linux 无 Xcode；CI 历史绿（`delivery-report.md` 已标注），本变更后续修复均不触原生与业务代码 |

## 总体状态

**PASS**。7 项发现全部修复并实跑复验；无密钥风险（`rg` 扫描无凭据模式）；工作区仅剩用户未跟踪文件 `docs/ios-multi-version-plan.md`。剩余风险均为已登记项。

复验命令（本会话实跑）：`npm run lint` exit 0；`npx vitest run` 1 文件 4 用例；`openspec validate --all --strict` 7/7；12×3 skills md5 比对全同；`git status --short` 干净。
