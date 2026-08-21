---
name: openspec-new-change
description: Use when a new feature, cross-module change, or high-risk change must be captured as an OpenSpec change before implementation.
---

# openspec-new-change

## 何时使用

用于 AGENTS.md 规定的高风险场景，或任何需要在实现前先明确范围、非目标、验收标准的需求。已有完整快捷流程时也可使用 openspec-propose，但产物必须等价。

## 输入

- change name：短横线命名，能表达变更意图
- 需求描述：背景、范围、非目标、验收标准
- 影响面：涉及的 spec、README、源码模块或配置文件
- 风险类型：协议、凭据、认证、Admin、模型映射、Docker/发布、配置 schema 或重构

## 步骤

1. 运行 openspec list --json，确认是否已有可复用或冲突的活跃 change。
2. 运行 openspec new change <name>，或使用 openspec-propose 生成初稿。
3. 补齐 proposal.md：背景、范围、非目标、假设、影响面、成功标准、风险。
4. 补齐 design.md：当前实现、目标设计、数据流/影响面、异常路径、回滚、验证策略。
5. 补齐 tasks.md：使用 - [ ] 任务清单，任务应能逐项验证。
6. 补齐 specs/**/spec.md：使用 ADDED/MODIFIED/REMOVED Requirements，每个 Requirement 至少一个 Scenario。
7. 运行 openspec validate --all，并把失败原因修到通过。

## 必产出

openspec/changes/<name>/ 至少包含 proposal.md、design.md、tasks.md、specs/**/spec.md，且 openspec validate --all 通过。

## 停止条件

- 范围、非目标、验收标准不清。
- 变更会影响凭据、协议、发布或外部系统，但用户未确认边界。
- 与已有活跃 change 冲突，且无法判断应合并还是新建。
- validate 失败且错误原因无法从工件中修复。
