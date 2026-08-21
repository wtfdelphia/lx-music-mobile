---
name: openspec-superpowers-bridge
description: Use when implementation is about to begin for an OpenSpec change and a bridge plan must connect specs, risks, tools, and verification.
---

# openspec-superpowers-bridge

## 何时使用

开始实现任何 OpenSpec change 前使用，包括纯文档、规则、工具配置类变更。它把 OpenSpec 工件、项目规则、CodeGraph/rg 证据和验证计划连成执行前检查点。

## 输入

- change name
- 当前分支与工作区状态
- 当前 change 的 proposal、design、tasks、specs
- AGENTS.md、spec/design.md、openspec/project.md

## 必读

- AGENTS.md
- spec/design.md
- openspec/project.md
- openspec/changes/<name>/proposal.md
- openspec/changes/<name>/design.md
- openspec/changes/<name>/tasks.md
- openspec/changes/<name>/specs/**/spec.md

## 步骤

1. 运行 openspec status --change <name> --json，确认 state 不是 blocked。
2. 读取必读文件，检查范围、非目标、任务和 Requirement 是否一致。
3. 运行 codegraph status；若有代码影响，再补 codegraph context/query/impact。
4. 用 rg 补盲配置、Docker、workflow、example、凭据路径等 CodeGraph 不覆盖的内容。
5. 写任务到执行步骤映射，说明每项任务如何验证和何时停止。
6. 明确 README/AGENTS/spec/openspec/specs 是否需要同步。

## 必产出

写入 openspec/changes/<name>/evidence/bridge-plan.md，至少包含：

- 范围、非目标、关键设计决策
- 高风险项
- CodeGraph 证据（命令与结论）
- rg / 源码补盲
- 任务到执行步骤表
- 必跑验证
- README/AGENTS/spec 同步判断
- 停止条件

## 停止条件

- OpenSpec 工件缺失、互相矛盾或状态 blocked。
- 发现未写入规格的高风险影响。
- 工作区存在会被提交的真实 config、credentials、token、Cookie 或本地缓存。
- 无法确定验证命令或剩余风险。
