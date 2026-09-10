# ai-collab-baseline Specification

## Purpose
为多 AI 客户端协作提供分层的项目事实源与规则入口，使任意新会话的 AI agent 无需反复探查代码即可获得项目技术栈底线、变更规格化条件、门禁与验证纪律，并保证入口文档不与代码实际状态漂移。

## Requirements

### Requirement: 三层事实源可用

仓库根目录 SHALL 同时提供三层事实源：入口事实（`README.md`）、规则事实（`AGENTS.md`）、架构事实（`spec/`）。三层内容 MUST NOT 互相矛盾。

#### Scenario: 新会话获取工程纪律

- **WHEN** 一个无历史上下文的 AI agent 打开仓库并读取 `AGENTS.md`
- **THEN** 能直接获得技术栈与版本底线、何时必须建 OpenSpec change、skills 门禁、高风险检查项与可执行的验证命令，无需先探查 `src/` 或 CI 配置

#### Scenario: 架构事实与代码结构一致

- **WHEN** 读取 `spec/structure.md` 描述的目录职责
- **THEN** 其列出的每个目录在仓库中真实存在，且职责描述与该目录实际内容一致

#### Scenario: 客户端专属规则不冲突

- **WHEN** Claude Code 读取 `CLAUDE.md`
- **THEN** 只得到 Claude 专属差异，且被显式告知项目通用规则以 `AGENTS.md` 为准

### Requirement: 长期事实与单次变更分离

`spec/` SHALL 只记录长期成立的事实，单次变更过程 SHALL 只存在于 `openspec/changes/<change-name>/`，历史方案与专题材料 SHALL 留在 `docs/`。

#### Scenario: 进行中能力的表述

- **WHEN** `spec/` 描述一项尚未交付的能力（例如 iOS 支持）
- **THEN** 该能力 MUST 标注为进行中并指向对应 change，MUST NOT 表述为已交付能力

#### Scenario: 变更过程不入长期文档

- **WHEN** 一次变更产生了 CI run 编号、验证证据或任务勾选变化
- **THEN** 这些信息 MUST 写在 `openspec/changes/<change-name>/`，MUST NOT 写进 `README.md`、`AGENTS.md` 或 `spec/`

### Requirement: 入口文档数字不漂移

`README.md` 中引用的任务进度、用例数量等可从仓库内直接核验的数字 SHALL 与其事实源一致。

#### Scenario: 进度数字核验

- **WHEN** `README.md` 声明某项变更的任务进度或应用内自测项数
- **THEN** 该数字 MUST 等于对应 change 的 `tasks.md`（归档后为 `openspec/changes/archive/` 下副本）的实际已勾选任务数、以及 `src/utils/ciSelfTest.ts` 的实际用例数

### Requirement: 工具来源可审计

项目 SHALL 提供工具来源与核验版本记录，覆盖来源地址、本机核验版本、用途与不应提交的产物。

#### Scenario: 工具版本核验

- **WHEN** 需要确认 OpenSpec 或 CodeGraph 的项目口径版本
- **THEN** `docs/tooling-sources.md` 给出核验日期与该日期实测版本，且明确标注哪些产物（如索引数据库、本地 settings）不得提交

### Requirement: 本地私有产物不入库

版本控制 SHALL 排除工具缓存、隔离工作区与客户端本地配置，MUST NOT 依赖仓库外的用户级忽略规则来兜底。

#### Scenario: 换机器克隆后的安全性

- **WHEN** 在一台没有配置用户级 git ignore 的机器上克隆仓库并生成本地客户端配置
- **THEN** 该配置文件 MUST 被仓库自身的 `.gitignore` 忽略，不出现在 `git status` 的待提交列表中
