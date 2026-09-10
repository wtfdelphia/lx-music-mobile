# verification-gates Specification

## Purpose
保证项目声明的验证门禁是真实可执行、可通过的，避免出现「永远为红因此被忽略」的门禁，并让每个门禁的口径、执行位置与已知缺口都被明确记录。

## Requirements

### Requirement: 门禁可真实通过

项目声明为门禁的检查命令 SHALL 在干净工作区上可以真实通过；若某项检查当前无法通过，MUST NOT 将其表述为生效中的门禁，而 SHALL 记录其真实状态与后续处理路径。

#### Scenario: 代码风格门禁

- **WHEN** 在干净工作区运行 `npm run lint`
- **THEN** 退出码为 0，且报告的问题数不包含第三方社区音源脚本产生的违规

#### Scenario: 已知不通过的检查

- **WHEN** `npx tsc --noEmit` 当前存在未修复错误
- **THEN** `AGENTS.md` MUST 记录其为已知红项、给出实测错误数与主要分布，MUST NOT 将其列为必须通过的门禁

### Requirement: 第三方脚本不受项目风格治理

代码风格检查 SHALL 排除入库的第三方社区音源脚本原文，这些文件 MUST NOT 被本项目格式规则改写。

#### Scenario: 忽略范围

- **WHEN** 运行 `npm run lint`
- **THEN** `test/scripts-regression/candidates/` 下的文件不参与检查

#### Scenario: 自研代码不得借道豁免

- **WHEN** 需要新增自研测试代码
- **THEN** 该代码 MUST NOT 放入 `test/scripts-regression/candidates/`，以免失去 lint 覆盖

### Requirement: 门禁执行位置明确

每个验证命令 SHALL 明确其执行位置（本地、哪个 CI 工作流、哪个触发条件），使「未被任何 CI 覆盖」的检查可被识别。

#### Scenario: 覆盖缺口可见

- **WHEN** 查阅 `AGENTS.md` 的验证矩阵
- **THEN** 能看出 `npm run lint` 仅由 `build-test.yml` 在 PR→`dev` 时执行、`npm test` 由 `ios-verify.yml` 执行、类型检查当前无 CI 覆盖

### Requirement: 任务计数真实

OpenSpec change 的 `tasks.md` SHALL NOT 包含脚手架残留的空任务行，使 `openspec list` 与 `openspec status` 报告的任务总数等于真实任务数。

#### Scenario: 计数核验

- **WHEN** 运行 `openspec list` 或 `openspec status` 查看某个 change（含归档副本）的任务计数
- **THEN** 报告的任务总数等于该 `tasks.md` 中真实任务条目数，不含脚手架占位行
