---
name: spec-compliance-check
description: Use when implementation for an OpenSpec change needs a scope, design, scenario, project-rule, verification, and documentation-sync compliance review.
---

# spec-compliance-check

## 何时使用

实现后、提交前、审查前或归档前使用。目标是确认实际改动既没有漏做规格，也没有越界改动。

## 输入

- change name
- 当前 diff 或提交范围
- proposal.md、design.md、tasks.md、specs/**/spec.md
- AGENTS.md、openspec/project.md、spec/、README.md（如受影响）
- 本会话真实运行过的验证命令与结果

## 审查维度

| 维度 | 检查点 |
| --- | --- |
| Scope | 改动是否只覆盖 proposal/design/tasks 的范围；是否触碰非目标 |
| Design | 实现是否符合 design.md 与长期 spec/design.md |
| Scenarios | 每个 Requirement 的 Scenario 是否有对应实现或证据 |
| Project Rules | 是否遵守 AGENTS.md 的 OpenSpec、CodeGraph、验证、安全纪律 |
| Verification | 是否只报告真实运行命令；失败和 SKIPPED 是否明示 |
| README/AGENTS Sync | 入口、规则、长期事实是否按影响同步或说明无需同步 |

## 状态规则

- PASS：满足要求，只有可接受的剩余风险。
- WARN：有非阻塞风险或明确 SKIPPED，但不影响当前 change 完成。
- FAIL：缺少必需工件、越界改动、验证缺失、密钥风险或 CRITICAL 未处理。

CRITICAL 必须修复，或更新 OpenSpec 工件后重新审查。

## 必产出

写入 openspec/changes/<name>/evidence/spec-compliance-report.md。报告必须包含六维表、总体状态 PASS/WARN/FAIL、发现项、证据路径与剩余风险。

## 停止条件

- 发现 src、admin-ui/src、Cargo.toml、Cargo.lock 等非授权范围被修改。
- 发现真实凭据或本地缓存会进入提交。
- Requirement/Scenario 与实现无法对应。
- validate 失败或关键验证缺失且没有 SKIPPED 说明。
