---
name: openspec-verify-change
description: Use when an OpenSpec change is ready for final verification or archive-readiness review, especially before archive.
---

# openspec-verify-change

## 何时使用

归档前必须使用；也可在完成实现后、最终回复前使用，用于确认 change 工件和证据能经得起回看。

## 输入

- change name；未提供时运行 openspec list，不要猜测
- proposal.md、design.md、tasks.md、specs/**/spec.md
- evidence 目录下的 Bridge、Compliance、Verification 证据
- openspec validate --all 的真实结果

## 步骤

1. 运行 openspec status --change <name> --json，确认工件完整。
2. 运行 openspec validate --all，确认 OpenSpec schema 通过。
3. 检查 tasks.md：每个已勾选任务是否有提交、文件或 evidence 支撑。
4. 检查 specs/**/spec.md：每个 Requirement 是否有 Scenario，且实现/规则能满足。
5. 检查 proposal/design：范围、非目标、风险、验证策略是否与实际改动一致。
6. 检查 evidence：Bridge、Compliance、Completion 是否存在且只记录真实命令。

## 验证维度

- Completeness：工件、tasks、Requirement、evidence 是否齐全。
- Correctness：完成内容是否符合 Scenario 意图和成功标准。
- Coherence：design、AGENTS、spec、README、tasks 是否一致。

## 必产出

写入 openspec/changes/<name>/evidence/openspec-verify-report.md，包含 Completeness/Correctness/Coherence 三维结论、证据路径、失败项或剩余风险。

## 停止条件

- 未提供 change name 且有多个活跃 change，必须请用户确认。
- tasks 未完成或缺少证据。
- validate 失败。
- 工件之间存在冲突，无法判断哪个事实源有效。
