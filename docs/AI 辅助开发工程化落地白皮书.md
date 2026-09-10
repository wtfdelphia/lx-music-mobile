# AI 辅助开发工程化落地白皮书

## 0. 文档定位与核心准则

本文用于把团队的 AI 辅助开发从“临时问答、盲目写代码、凭感觉验收”升级为可审计、可验证、可迁移的工程工作流。

它以“完整实操版”为主稿，补齐三类落地缺口：

- 前置保护：先确认工作区、事实源和工具来源，避免 AI 覆盖用户改动或把未核验命令写成事实。
- 执行门禁：把 OpenSpec、CodeGraph、ECC、Karpathy 行为纪律和项目内 Skills 串成可执行闭环。
- 知识回流：把 README、AGENTS、spec、openspec/specs 的同步判断纳入最终交付证据。

AI 协作无法同时做到完全自主、不越界和百分百正确。工程化破局方式是：

```text
事实基线化
  -> 变更规格化
  -> 上下文证据化
  -> 执行隔离化
  -> 合规审查化
  -> 验证真实化
  -> 文档同步化
```

本白皮书不鼓励“让 AI 全自动接管项目”。它的目标是让 AI 在明确事实、边界、风险、验证标准之后，小步完成可审查的变更。

## 1. 工具角色与边界

### 1.1 OpenSpec

OpenSpec 管“为什么做、做什么、如何验收”。它把单次变更收敛到 `openspec/changes/<change-name>/`，避免需求、设计、任务和验收只存在聊天记录里。

推荐职责：

- 创建 proposal、design、specs、tasks、plan 等变更工件。
- 明确范围、非目标、场景、影响面、验证策略和停止条件。
- 归档完成变更，并把长期事实同步到 `spec/` 或 `openspec/specs/`。

边界：

- 不替代代码审查。
- 不替代测试和运行时验证。
- 不替代业务 owner 的最终验收。

### 1.2 CodeGraph

CodeGraph 用于本地预索引代码图谱，帮助定位入口、调用链、影响面和候选测试。

适合回答：

- 入口在哪里。
- 谁调用了这个函数。
- 这个函数调用了谁。
- 改某个类可能影响哪些地方。
- 某个业务问题附近有哪些代码上下文。

不应该承担：

- 不替代 OpenSpec 的范围和验收标准。
- 不替代 `rg` 和源码精读。
- 不替代 SQL、XML、配置、脚本、生成物、运行时注入、权限传播、事务边界和发布包审查。
- 不替代测试结果。

### 1.3 ECC

ECC 更像跨 AI harness 的 rules、skills、agents、hooks、MCP 配置集合。项目落地时应按需裁剪，而不是整包覆盖。

推荐策略：

| 档位 | 适用情况 | 动作 |
| --- | --- | --- |
| 最小档 | 团队刚开始统一 AI 规则 | 只借鉴 rules / skills 结构，写入 `AGENTS.md` |
| 标准档 | 多客户端协作，已有稳定测试 | 裁剪少量 skills、agents、commands、MCP 配置 |
| 增强档 | 团队能维护 hook、评审和安全策略 | 接入 hooks、security review、verification loop、multi-agent |

不要：

- 全量复制 ECC。
- 同时使用 plugin 和 manual installer 导致重复。
- 让外部 skill 覆盖项目规则。
- 把用户级 token、账号、私有配置提交到项目。

### 1.4 Karpathy 行为纪律

Karpathy 四原则是所有客户端通用的 AI 编码纪律。

| 原则 | 防止的问题 | 项目化要求 |
| --- | --- | --- |
| Think Before Coding | 静默假设、隐藏困惑、遗漏取舍 | 不确定需求、接口、权限、SQL、调度、性能或上线影响时，先列假设或提问 |
| Simplicity First | 过度抽象、未要求扩展点 | 只做当前规格需要的最小可行改动 |
| Surgical Changes | 顺手重构、无关格式化、误删旧代码 | 每个改动都应能追溯到当前 change 或 task |
| Goal-Driven Execution | 只跑命令、不定义成功标准、虚报完成 | 开始前定义成功标准，完成前报告真实运行结果 |

一句话规则：

```text
不确定就先澄清；能简单就不抽象；非本任务不改；没有证据不说完成。
```

## 2. 0 到 1 接入流程

### 阶段 0：保护工作区和事实源

在任何安装、初始化、改文档或改代码之前，先确认仓库状态：

```bash
git status --short
git branch --show-current
git remote -v
```

要求：

- 不覆盖用户未提交改动。
- 不提交本地密钥、token、Cookie、构建产物、工具缓存和临时报告。
- 如果工作区已有改动，先区分哪些属于本次接入，哪些只是旁路变更。
- 如果发现多个规则入口互相冲突，应停止并请求人工确认。

`.gitignore` 至少应覆盖：

```gitignore
.codegraph/
.worktrees/
.claude/settings.local.json
*.log
target/
build/
dist/
node_modules/
```

### 阶段 1：安装和核验工具

工具版本会变化。以下版本信息应作为核验口径示例，实际项目应记录自己的核验日期、版本、安装方式和不提交内容。

```bash
# OpenSpec，要求 Node 版本满足工具当前 engines 声明。
npm install -g @fission-ai/openspec@latest
openspec --version

# CodeGraph。
npm i -g @colbymchenry/codegraph
codegraph --version

# ripgrep。
rg --version
```

建议新增或更新 `spec/devlog.md`、`docs/tooling-sources.md` 或项目规则中的工具来源表：

| 工具 | 来源 | 参考版本口径 | 用途 | 不应提交 |
| --- | --- | --- | --- | --- |
| OpenSpec | `https://github.com/Fission-AI/OpenSpec` | 2026-05-28 参考：`@fission-ai/openspec@1.3.1`，Node `>=20.19.0` | 规格驱动和变更归档 | token、本机缓存 |
| CodeGraph | `https://github.com/colbymchenry/codegraph` | 2026-05-28 参考：`@colbymchenry/codegraph@0.9.6` | 本地代码图谱和影响面分析 | `.codegraph/` |
| ECC | `https://github.com/affaan-m/ECC` | 2026-05-28 参考：`ecc-universal@1.10.0` | rules / skills / agents 参考 | 用户级配置、密钥 |
| Karpathy skills | `https://github.com/multica-ai/andrej-karpathy-skills` | 2026-05-28 参考：默认分支 `main` | 行为纪律 | 未裁剪外部配置 |
| ripgrep | `https://github.com/BurntSushi/ripgrep` | 以本机实际输出为准 | 文本补盲 | 无 |

企业网络、代理、镜像或离线包应写为环境说明，不要把个人代理、账号或 token 写入项目文件。

### 阶段 2：扫描入口文件

AI 介入新项目时，不要先全仓分析代码。先扫描入口文件和规则文档：

```bash
find . -maxdepth 3 -type f \( \
  -name 'README*' -o \
  -name 'AGENTS.md' -o \
  -name 'CLAUDE.md' -o \
  -name 'GEMINI.md' -o \
  -name 'copilot-instructions.md' -o \
  -name '*.md' \
\) | sort
```

入口文件职责：

| 文件 | 主要读者 | 应包含 | 不应包含 |
| --- | --- | --- | --- |
| `README.md` | 人类开发者、新成员、AI 新会话 | 项目定位、技术栈、启动方式、测试方式、SpecCoding/OpenSpec 入口、关键文档链接 | 过长实现细节、单次变更过程、密钥、本地路径 |
| `AGENTS.md` | Codex、OpenCode、Copilot、通用 AI agent | 回答语言、项目上下文、编码规则、OpenSpec 条件、skills 门禁、高风险检查、验证要求 | 长篇业务设计、历史方案、未验证愿景 |
| `CLAUDE.md` | Claude Code | Claude 专用上下文、命令、项目补充规则 | 与 `AGENTS.md` 冲突的规则 |
| `spec/requirements.md` | 人和 AI | 长期需求事实、业务边界、非目标 | 单次变更任务 |
| `spec/design.md` | 人和 AI | 长期架构、模块边界、接口/数据/权限/测试策略 | 临时方案 |
| `openspec/changes/<name>/` | 当前变更参与者 | proposal、design、specs、tasks、plan、验证证据 | 项目长期入口 |

如果缺失 `README.md` 或 `AGENTS.md`，创建最小可用版；如果已经存在，只能增量合并，不覆盖原有业务说明、部署命令和团队规则。

### 阶段 3：建立三层事实资产

推荐建立三层事实源：

1. 入口事实：`README.md`
   - 项目是什么。
   - 如何启动、测试、构建和部署。
   - 规范在哪里。
2. 规则事实：`AGENTS.md`
   - 技术栈和版本底线。
   - OpenSpec 条件。
   - Skills 门禁。
   - 高风险检查和验证纪律。
3. 架构事实：`spec/`
   - `spec/requirements.md`：长期需求、业务边界、非目标。
   - `spec/design.md`：架构风格、模块边界、接口、数据、权限、调度、发布包和测试策略。
   - `spec/structure.md`：目录结构、源码结构、配置和脚本归属。

规则：

- 只写当前真实事实。
- 不把“未来想改”写成已存在能力。
- 不确定处标为待核验，并安排后续变更。
- 项目级长期事实放在 `spec/`；单次变更过程放在 `openspec/changes/<change-name>/`；历史方案和专题材料放在 `docs/`。

### 阶段 4：初始化或合并 OpenSpec

首次接入：

```bash
openspec init
openspec validate --all
```

如果项目已有 `openspec/`，不要覆盖，先读取当前状态：

```bash
openspec list
openspec validate --all
find openspec -maxdepth 3 -type f | sort
```

要求：

- `openspec/project.md` 与 `AGENTS.md` 不冲突。
- `openspec/specs/` 存放长期 capability facts。
- `openspec/changes/` 只存单次变更。
- 已完成变更应归档，或明确保留原因。

### 阶段 5：接入 CodeGraph / ECC

CodeGraph：

```bash
codegraph init -i
codegraph status
```

变更设计中建议记录：

```markdown
## CodeGraph 影响面

- 查询命令：
- 入口：
- 调用链：
- 影响面：
- 候选测试：
- 需要 `rg` / 源码精读补盲：
```

固定补盲矩阵：

| 盲区 | 补充方式 |
| --- | --- |
| MyBatis XML / SQL 文件 | `rg -n "<select|<insert|<update|<delete|namespace=|id="`，再精读 mapper |
| 数据迁移脚本 | `rg --files sql db migration`，检查兼容和回滚 |
| 配置外置 | `rg -n "@Value|ConfigurationProperties|application-|bootstrap"` |
| 权限上下文 | 搜索 security、auth、tenant、owner、principal、context |
| 调度任务 | 搜索 scheduled、cron、job、handler、xxl、queue |
| 发布包 | 检查 assembly、Dockerfile、profile、scripts、target layout |
| API 契约 | 搜索 route/controller/request/response/schema/docs |

ECC：

- 只选一个安装路径。
- 只裁剪需要的 rules、skills、commands、agents、MCP。
- 不覆盖项目现有规则。
- 外部 skill 必须转成项目语境，不直接替代项目内 `.codex/skills/`。

### 阶段 6：选择首个试点

首个试点应满足：

- 有真实业务价值。
- 范围小。
- 有明确测试命令。
- 能覆盖 OpenSpec、Bridge、Compliance、Verify、Completion 全链路。
- 不涉及大规模数据迁移、权限模型重写或发布包大改。

避免选择：

- 大重构。
- 多系统联调。
- 权限模型重写。
- 数据库大迁移。
- 无测试基础的核心链路大改。

## 3. 单次变更全生命周期门禁

每一次新需求、跨模块修改、高风险修复或接口/SQL/权限/调度/发布包变更，都必须走完以下闭环。纯拼写、注释小修、单行无行为变化修复可以不创建 OpenSpec change，但仍必须遵守行为纪律和验证纪律。

### Gate 0：分类与准入判断

先回答：

- 这是 bug、增强、重构、配置、文档还是发布变更。
- 是否涉及高风险矩阵。
- 是否必须创建 OpenSpec change。
- 入口和影响面在哪里。
- 验证命令是什么。

需要 OpenSpec 的典型场景：

- 新业务能力。
- 跨模块变更。
- API 契约变化。
- SQL / Mapper / 数据迁移。
- 权限、机构隔离、资源归属。
- 任务调度、异步链路、执行记录。
- 模型执行、ClickHouse SQL、熔断降级。
- 发布包、配置外置、部署脚本。
- 大范围重构。

停止条件：

- 需求有多种解释且会影响接口、SQL、权限或调度。
- 无法判断改动边界。
- 无法确定验证方式。
- 多个活跃 change 无法判断当前目标。

### Gate 1：探索与防幻觉上下文收集

推荐探索顺序：

```text
项目规则 / spec/
  -> 当前 openspec change 工件
  -> CodeGraph / ECC / rg 上下文
  -> 源码精读
  -> 测试和构建脚本
```

推荐命令：

```bash
rg -n "<业务关键词>|<接口名>|<服务名>" .
codegraph context "<业务问题或变更目标>"
codegraph query "<核心类或函数>"
codegraph callers "<核心函数>"
codegraph callees "<核心函数>"
codegraph impact "<核心类或函数>"
```

探索输出至少包含：

- 当前理解。
- 假设和不确定点。
- 非目标。
- 影响面候选。
- 是否需要 OpenSpec change。
- 初始验证策略。

### Gate 2：创建或补齐 OpenSpec 工件

最低工件：

```text
openspec/changes/<change-name>/
├── proposal.md
├── design.md
├── tasks.md
└── specs/<capability>/spec.md
```

复杂变更增加：

```text
openspec/changes/<change-name>/
└── plan.md
```

`proposal.md` 应包含：

- 背景。
- 范围。
- 非目标。
- 假设。
- 影响面。
- 成功标准。
- 风险。

`design.md` 应包含：

- 当前实现。
- 目标设计。
- CodeGraph 影响面。
- `rg` / 源码精读补盲。
- 异常路径。
- 回滚策略。
- 验证策略。

`tasks.md` 应包含可勾选的小步任务，并能映射到测试或验证依据。

### Gate 3：隔离执行与 Bridge Plan

建议每个 OpenSpec change 对应一个 branch 或 worktree：

```bash
git switch -c feature/<change-name>

# 可选：worktree
git worktree add .worktrees/<change-name> -b feature/<change-name>
git config branch.feature/<change-name>.parent "$(git branch --show-current)"
```

开始实现前，必须使用或等价遵循 `openspec-superpowers-bridge`，把规格工件转成 Bridge Plan。

必读上下文：

- `AGENTS.md`
- `CLAUDE.md`（如果存在）
- `spec/design.md`
- `openspec/project.md`
- `openspec/AGENTS.md`（如果存在）
- `openspec/changes/<change-name>/proposal.md`
- `openspec/changes/<change-name>/design.md`
- `openspec/changes/<change-name>/specs/**/spec.md`
- `openspec/changes/<change-name>/tasks.md`
- `openspec/changes/<change-name>/plan.md`（如果存在）

推荐命令：

```bash
openspec status --change "<change-name>" --json
openspec instructions apply --change "<change-name>" --json
```

Bridge Plan 模板：

```markdown
## Bridge Plan: <change-name>

### 规格摘要
- 范围：
- 非目标：
- 关键设计决策：

### 高风险项
- SQL：
- 接口：
- 权限：
- 调度 / 执行：
- 发布包 / 配置：
- 安全 / 密钥：

### Impact Evidence

#### CodeGraph
- 查询命令：
- 入口：
- 调用者：
- 被调用者：
- 候选测试：

#### rg / 源码精读补盲
- SQL / XML：
- 配置：
- 权限：
- 调度：
- 发布包：

### 任务到执行步骤
| OpenSpec Task | 执行步骤 | 测试依据 | 完成标记 |
| --- | --- | --- | --- |

### 必跑验证
- ...

### README / AGENTS 同步判断
- 是否可能影响 README：
- 是否可能影响 AGENTS：
- 是否可能影响 spec/：
- 是否可能影响 openspec/specs/：
- 初始结论：

### 停止条件
- ...
```

Bridge 停止条件：

- OpenSpec 工件缺失。
- change 状态 blocked。
- proposal、design、specs、tasks 互相矛盾。
- 新发现 SQL、权限、接口、发布包影响，但 proposal/design 未说明。
- 用户要求跳过必要验证但未明确承担风险。

### Gate 4：TDD / 小步实现

实现纪律：

- 先写或补测试；不能先写测试时说明原因。
- 每个 task 拆成“测试 / 最小实现 / 定向验证 / 勾选任务”。
- 只做当前 OpenSpec 范围内的最小改动。
- 不做无关格式化和顺手重构。
- 不删除不理解的旧代码。
- 发现设计偏差先更新工件，再继续代码。
- 每个改动行都能追溯到当前 change。

推荐任务粒度：

```markdown
- [ ] 1. 补失败用例或现状验证。
- [ ] 2. 实现最小代码改动。
- [ ] 3. 运行定向测试。
- [ ] 4. 更新文档或规格。
- [ ] 5. 勾选 OpenSpec task。
```

### Gate 5：Spec Compliance Check

实现后、代码审查前后或归档前，必须使用或等价遵循 `spec-compliance-check`。

审查维度：

| 维度 | 核心问题 |
| --- | --- |
| Scope | 有没有实现范围外功能，违反非目标，改无关模块 |
| Design | 是否遵守 design.md 的技术决策 |
| Scenarios | 每个 Requirement / Scenario 是否有实现和测试证据 |
| Project Rules | 是否符合项目长期规则和编码约束 |
| Verification | 是否有匹配高风险类型的验证命令和结果 |
| README/AGENTS Sync | README、AGENTS、spec、openspec/specs 是否需要更新，若需要是否已更新 |

报告模板：

```markdown
## Spec Compliance Report: <change-name>

### Summary
| Dimension | Status | Notes |
| --- | --- | --- |
| Scope | PASS/WARN/FAIL | ... |
| Design | PASS/WARN/FAIL | ... |
| Scenarios | PASS/WARN/FAIL | ... |
| Project Rules | PASS/WARN/FAIL | ... |
| Verification | PASS/WARN/FAIL | ... |
| README/AGENTS Sync | PASS/WARN/FAIL | ... |

### CRITICAL
- ...

### WARNING
- ...

### SUGGESTION
- ...

### Evidence
- Specs read:
- Code searched:
- Tests or reports checked:
```

CRITICAL 必须修复，或更新规格后重新审查。

### Gate 6：OpenSpec Verify

归档前必须使用或等价遵循 `openspec-verify-change`。

检查三个维度：

| 维度 | 检查 |
| --- | --- |
| Completeness | tasks 是否完成，Requirement 是否有实现迹象 |
| Correctness | 实现是否符合需求和场景意图 |
| Coherence | 实现是否遵守 design 和项目模式 |

如果未提供 change name：

- 不要猜。
- 使用 `openspec list --json` 查可用变更。
- 多个活跃变更时由用户确认。

降级策略：

- 只有 `tasks.md`：只验证任务完成。
- 有 tasks + specs：验证完整性与正确性。
- 有全量工件：验证 Completeness、Correctness、Coherence。
- 跳过任何检查都必须说明原因。

### Gate 7：Verification Before Completion

最终回复、PR、归档、合并前，必须使用或等价遵循 `verification-before-completion`。

规则：

- 只能报告本次会话真实运行过的命令和结果。
- 未运行的必要验证必须说明原因。
- 不能用“应该通过”代替“已通过”。
- 不能隐藏失败命令。
- 不能粘贴真实 token、账号、密码、Cookie 或敏感报告。
- 完成前检查 `git status --short`，确认没有误纳入本地配置、日志、构建产物或真实密钥。

最终报告模板：

```markdown
## Verification

- `<command>`: PASS/FAIL/SKIPPED，关键结果或原因

## Documentation Sync

- README.md: UPDATED / NOT NEEDED / SKIPPED，原因：
- AGENTS.md: UPDATED / NOT NEEDED / SKIPPED，原因：
- spec/: UPDATED / NOT NEEDED / SKIPPED，原因：
- openspec/specs/: UPDATED / NOT NEEDED / SKIPPED，原因：

## Residual Risk

- ...
```

### Gate 8：README / AGENTS / spec 同步判断

每次变更完成后、最终回复前，必须判断是否需要更新入口文件和长期事实。

必须更新 README.md 的情况：

| 变更类型 | README 更新内容 |
| --- | --- |
| 启动方式变化 | 快速开始、环境变量、脚本命令 |
| 构建或测试命令变化 | build/test/package 命令 |
| 部署方式变化 | 部署步骤、配置路径、发布包说明 |
| 新增主要能力或模块 | 项目能力、模块说明、关键入口 |
| API 使用方式变化 | API 文档链接、调用方式说明 |
| AI 开发流程变化 | OpenSpec / skills / CodeGraph 使用入口 |
| 依赖工具变化 | 工具版本、安装方式、代理说明 |

必须更新 AGENTS.md 的情况：

| 变更类型 | AGENTS 更新内容 |
| --- | --- |
| 新增高风险类型 | 高风险检查矩阵 |
| 新增或变更验证命令 | 验证要求 |
| 新增 OpenSpec / skills 门禁 | OpenSpec / SpecCoding 纪律 |
| 新增 AI 客户端或 MCP | 多客户端规则、MCP 边界 |
| 新增编码规范 | 项目上下文或编码标准 |
| 权限、SQL、调度、发布包规则变化 | 高风险检查 |
| README 同步规则变化 | README / AGENTS 同步纪律 |

通常不需要更新：

- 单个 bugfix，不改变使用方式、规则、命令和长期事实。
- 测试内部重构，不改变验证命令。
- 局部代码整理，不改变模块边界。
- 单次变更过程信息，这类信息应保留在 `openspec/changes/<change-name>/`。

同步检查表：

```markdown
## Documentation Sync Check

| 文件 | 是否需要更新 | 判断原因 | 状态 |
| --- | --- | --- | --- |
| README.md | yes/no | ... | updated/not-needed/skipped |
| AGENTS.md | yes/no | ... | updated/not-needed/skipped |
| spec/ | yes/no | ... | updated/not-needed/skipped |
| openspec/specs/ | yes/no | ... | updated/not-needed/skipped |
```

### Gate 9：归档与合并

归档前：

```bash
openspec validate --all
openspec archive <change-name>
```

合并前要求：

- `tasks.md` 已真实反映完成状态。
- 验证命令和结果已记录。
- OpenSpec validate 通过，或明确说明失败原因。
- 评审问题已处理或登记。
- README/AGENTS/spec 同步状态已说明。
- 合并目标由人工确认，不默认合并主干。

## 4. Skills 门禁矩阵

如果客户端支持项目内 Skills，优先使用项目内 Skills；如果不支持，也必须等价遵循流程并输出对应证据。

| 场景 | 必用或等价遵循 | 输入 | 必须产出 | 停止条件 |
| --- | --- | --- | --- | --- |
| 新需求、跨模块改动、高风险变更 | `openspec-new-change` 或等价创建流程 | 需求描述、项目事实、高风险类型 | `openspec/changes/<change-name>/` | 范围、非目标、验收不清 |
| 补齐未完成变更工件 | `openspec-continue-change` 或 `openspec-ff-change` | 已有 change | proposal/design/specs/tasks/plan | 工件互相矛盾 |
| 开始实现 OpenSpec change | `openspec-superpowers-bridge` | project facts + change artifacts | Bridge Plan | 工件缺失、状态 blocked、影响面未说明 |
| 实现过程中发现设计偏差 | 更新 OpenSpec 工件，再继续 | 新事实、设计偏差 | 更新后的 design/tasks/specs | 代码已偏离设计但未更新规格 |
| 实现后或代码审查前 | `spec-compliance-check` | 工件、实现 diff、项目规则 | Spec Compliance Report | CRITICAL 未修复 |
| 归档前验证 OpenSpec 一致性 | `openspec-verify-change` | change name、contextFiles、代码证据 | Verification Report | tasks 未完成、需求缺实现 |
| 最终回复、PR、归档、合并前 | `verification-before-completion` | 本次会话真实命令和结果 | Verification + Residual Risk | 缺必要验证且无明确原因 |
| 业务 API 闭环 | `postman-business-api-verification` | Postman/Newman/OpenAPI/API 环境 | 只读或一次性 smoke 报告 | 真实 token、账号、Cookie 泄露风险 |
| 归档已完成变更 | `openspec-archive-change` | 已验证 change | archived change + 同步说明 | 验证未完成或长期事实未处理 |

## 5. DPM-ILDA 高风险检查增强

本节适用于 DPM-ILDA，也可作为 Java/Spring 模块化单体项目模板。

### 5.1 项目硬约束

- Java 8 + Spring Boot 2.7.18，不使用 Java 9+ 语法。
- 接口以 POST + `@RequestBody` 为主，统一返回 `Result<T>`。
- 分页使用 `PageParam<T>` 与 `PageResult<T>`。
- Service 不直接构造 MyBatis-Plus `Page<T>`。
- Service 不直接消费 `IPage<T>`。
- Service 不调用 `PageResult.of(...)` 处理数据库分页结果。
- 自定义 MyBatis SQL 必须放在 `src/main/resources/mapper/**/*.xml`。
- Mapper 接口不得使用 SQL 注解或 Provider SQL 注解。
- 主体、角色、页面类型、审批范围等业务语义由 Service 或领域服务计算后传入 Mapper。
- Mapper/XML 不读取主体上下文，不自行判断业务角色或页面语义。
- 写操作不信任客户端提交的 owner/org 等系统字段。
- 异步、XXL-Job 和重试链路必须恢复或传递主体上下文。

### 5.2 推荐搜索

```bash
rg -n "new Page<|IPage<|PageResult\\.of|@Select|@Update|@Insert|@Delete|Provider" src/main src/test
rg -n "SubjectContext|CurrentSubject|ResourceGuard|OwnershipRewrite|orgId|owner" src/main src/test
rg -n "XxlJob|JobManagement|TaskTrigger|ExecutionRecord|Retry" src/main src/test
rg -n "assembly|ReleasePackageAssemblyTest|config/|etc/|bin/" .
```

### 5.3 高风险验证矩阵

| 变更范围 | 推荐验证 |
| --- | --- |
| 普通 Java 业务逻辑 | `mvn test -Dtest=<相关测试类>` |
| API 契约 | Controller 测试、Service 测试、`docs/API接口规范.md` 同步检查 |
| Mapper SQL | 相关 `*MapperSqlTest` 和 Service 测试 |
| 权限主体 | `mvn test -Dtest=ResourceGuardTest,OwnershipRewriteServiceTest,CurrentSubjectServiceTest` |
| 任务调度 | `mvn test -Dtest=ScenarioTaskServiceImplTest,TaskTriggerServiceImplTest,JobManagementServiceTest` |
| 模型执行 | `mvn test -Dtest=ModelExecutionServiceImplTest,ModelOrchestrationServiceImplTest,ClickHouseSqlGeneratorTest` |
| 执行记录 | `mvn test -Dtest=ExecutionRecordQueryServiceTest,ExecutionRequestRetryServiceTest,ExecutionDispatcherTest` |
| 发布包、脚本、配置外置、assembly | `mvn test -Dtest=ReleasePackageAssemblyTest`，必要时 `mvn clean package -P release -DskipTests` |
| OpenSpec 工件 | `openspec validate --all` 或对应 change validate/status |
| Postman 业务 API | `npm --prefix tools/postman-business-api test` 和目标环境运行报告 |

涉及 SQL 时必须说明：

- DDL/DML 文件路径。
- 是否兼容已有数据。
- 回滚或补偿方式。
- 是否需要纳入发布包。
- Mapper SQL 或服务层测试覆盖方式。

涉及接口时必须检查：

- Controller 路径与方法命名。
- VO/DTO 字段、校验注解和 Knife4j 描述。
- Service 方法和测试。
- `docs/API接口规范.md` 是否需要更新。

涉及发布包时必须检查：

- assembly 配置。
- `config/`、`etc/`、`bin/`。
- `ReleasePackageAssemblyTest`。
- release profile 打包验证是否必要。

## 6. 多 AI 客户端协作模型

团队可能混用 Codex、Claude Code、Cursor、OpenCode、Gemini、GitHub Copilot 等工具。规则应统一，客户端只承载差异。

| 客户端 | 推荐职责 | 规则载体 |
| --- | --- | --- |
| Codex / OpenCode | 代码实现、测试修复、终端验证、项目内文档和工作流执行 | `AGENTS.md`、`.codex/skills/`、项目 MCP |
| Claude Code | 长上下文设计、复杂审查、commands / skills 编排、架构推演 | `CLAUDE.md`、`.claude/commands/`、`.claude/skills/` |
| Cursor | IDE 内局部迭代、前端联调、局部代码补全 | `.cursor/rules/*.mdc` |
| Gemini / Kiro 等 | 视团队采用情况接入同一规则和上下文层 | `GEMINI.md` 或对应客户端规则 |
| GitHub Copilot | IDE 补全、局部 prompt、轻量文档辅助 | `.github/copilot-instructions.md` |

统一入口：

```text
AGENTS.md / CLAUDE.md / GEMINI.md
  + spec/
  + openspec/
  + CodeGraph / ECC / rg
  + 项目验证命令
```

协作纪律：

- 不同客户端共享同一套长期项目事实。
- 单次变更只认 `openspec/changes/<change-name>/` 里的范围和验收。
- 评审发现需求变化时先更新规格。
- 自动化 agent 不能绕过测试和人工合并决策。
- MCP 数量受控，每个 MCP 必须有明确用途和安全边界。

## 7. 可复制模板

### 7.1 AGENTS.md 增强片段

```markdown
## AI 协作纪律

- Think Before Coding：不静默猜测需求、接口、权限、数据或调度语义；有多种解释时先列出取舍或提问。
- Simplicity First：只做当前规格范围内的最小可行改动，不增加未要求的抽象、配置或扩展点。
- Surgical Changes：只改当前变更直接相关文件；不顺手格式化、重构或删除无关代码。
- Goal-Driven Execution：每个任务必须有成功标准和验证命令；未实际运行验证时不得声称验证通过。

## OpenSpec / Skills 门禁

- 新需求、跨模块改动、SQL、权限、调度、执行记录、接口契约、发布包和配置外置变更必须先建立 OpenSpec change。
- 开始实现 OpenSpec change 前必须使用或等价遵循 `openspec-superpowers-bridge`，输出 Bridge Plan。
- Bridge Plan 必须包含范围、非目标、高风险项、任务到执行步骤、测试依据、必跑验证和停止条件。
- 实现后、代码审查前后或归档前必须使用或等价遵循 `spec-compliance-check`。
- 归档前必须使用或等价遵循 `openspec-verify-change`。
- 最终回复、PR、归档或合并前必须使用或等价遵循 `verification-before-completion`。
- CodeGraph 只用于入口、调用链、影响面和候选测试发现；SQL、XML、配置、权限、调度、发布包和运行时行为必须再用 `rg` 和源码精读补盲。
- 未完成必要验证时不得声称完成；未运行必须说明原因和剩余风险。

## README / AGENTS 同步纪律

- 待适配项目没有 `README.md` 时，先创建最小项目入口；已有时只增量合并，不覆盖原内容。
- 待适配项目没有 `AGENTS.md` 时，先创建最小 AI agent 项目规则；已有时只增量合并，不覆盖原内容。
- 每次变更完成前必须判断是否需要更新 `README.md`、`AGENTS.md`、`spec/` 或 `openspec/specs/`。
- 影响启动、构建、部署、测试、接口入口、AI 开发纪律、高风险规则或验证命令的变更，必须同步对应入口文件。
- 不把单次变更过程写入 `README.md` 或 `AGENTS.md`；单次过程仍放在 `openspec/changes/<change-name>/`。
- 如果无需更新，最终报告必须说明原因。
```

### 7.2 README.md SpecCoding 入口

````markdown
## SpecCoding / OpenSpec 工作流

本项目使用 OpenSpec/SpecCoding 管理高风险需求、跨模块改动和 AI 协作开发过程。

- 项目级长期事实：`spec/`
- 单次变更过程：`openspec/changes/<change-name>/`
- AI agent 通用规则：`AGENTS.md`
- 常用命令：`/opsx:new`、`/opsx:continue`、`/opsx:apply`、`/opsx:verify`、`/opsx:archive`

业务代码变更前先读 `AGENTS.md`、`spec/design.md` 和对应 `openspec/changes/<change-name>/`。

推荐开发闭环：

```text
/opsx:new 或 /opsx:continue
  -> openspec-superpowers-bridge
  -> 小步实现并更新 tasks.md
  -> spec-compliance-check
  -> openspec-verify-change 或 /opsx:verify
  -> README/AGENTS/spec 同步判断
  -> verification-before-completion
  -> /opsx:archive
```
````

### 7.3 Proposal 模板

```markdown
# Proposal

## 背景

说明为什么要做，以及当前问题是什么。

## 范围

- 本次会做：
- 本次不会做：

## 非目标

- 不处理：

## 假设

- 假设 1：
- 假设 2：

## 影响面

- 入口：
- 服务 / 领域：
- 数据：
- 权限：
- 调度 / 异步：
- 配置 / 发布：
- 文档：

## 成功标准

- 场景：
- 验证：

## 风险

- 风险：
- 缓解：
```

### 7.4 Design 模板

```markdown
# Design

## 当前实现

## 目标设计

## CodeGraph 影响面

- 查询命令：
- 入口：
- 调用链：
- 影响面：
- 候选测试：

## 盲区补充

- SQL / XML：
- 配置：
- 脚本：
- 运行时注入：
- 权限 / 租户：
- 发布包：

## 异常路径

## 回滚策略

## 验证策略
```

### 7.5 Tasks 模板

```markdown
# Tasks

- [ ] 1. 读取项目规则、长期规格和当前 change 工件。
- [ ] 2. 使用 CodeGraph 或等价方式定位入口、调用链和影响面。
- [ ] 3. 使用 `rg` / 源码精读补齐 CodeGraph 盲区。
- [ ] 4. 补充或新增失败用例。
- [ ] 5. 实现最小改动。
- [ ] 6. 运行定向测试。
- [ ] 7. 运行必要的高风险验证。
- [ ] 8. 更新文档、API 说明或长期规格。
- [ ] 9. 运行 `openspec validate --all`。
- [ ] 10. 记录验证结果和剩余风险。
```

## 8. 接入成熟度模型

| 等级 | 能力 | 标志 |
| --- | --- | --- |
| L0 | 临时问答 | 无 OpenSpec，无固定验证 |
| L1 | 规则基线 | 有 `AGENTS.md`、`spec/`、验证矩阵 |
| L2 | OpenSpec 闭环 | 新需求有 change，能 archive |
| L3 | Skills 门禁 | Bridge、Compliance、Verify、Completion 全链路执行 |
| L4 | 上下文增强 | CodeGraph/ECC 接入，影响面证据进入工件 |
| L5 | 高风险专项 | SQL、权限、调度、发布包、API 闭环都有专项验证 |
| L6 | 多客户端协作 | Codex、Claude、Cursor 等共享规则和 OpenSpec，不互相污染 |

推荐目标不是一步到 L6，而是先稳定达到 L3。

## 9. 自检清单

### 0 到 1 接入

- [ ] 已确认 `git status --short`、当前分支和远端。
- [ ] 已扫描 README/AGENTS/CLAUDE/spec/openspec。
- [ ] 缺失 `README.md` 时已创建最小入口。
- [ ] 缺失 `AGENTS.md` 时已创建最小 AI agent 规则。
- [ ] 已有 README/AGENTS 时只做增量合并。
- [ ] `AGENTS.md` 写入 OpenSpec 条件、skills 门禁、高风险规则、验证纪律。
- [ ] `spec/requirements.md`、`spec/design.md`、`spec/structure.md` 存在或明确暂不创建原因。
- [ ] `openspec validate --all` 可运行或记录失败原因。
- [ ] `.codegraph/`、`.worktrees/`、本地 settings 已忽略。
- [ ] 未把本地 token、Cookie、账号密码和报告写入文档。

### 单次变更前

- [ ] 已判断是否必须建立 OpenSpec change。
- [ ] 已读取项目事实源。
- [ ] 已定位入口和影响面。
- [ ] 已明确验证命令。
- [ ] 高风险项已写入 proposal/design。

### 实现前

- [ ] 已使用或等价遵循 `openspec-superpowers-bridge`。
- [ ] Bridge Plan 包含范围、非目标、任务步骤、测试依据和停止条件。
- [ ] CodeGraph / `rg` / 源码精读证据已写入工件或 Bridge Plan。
- [ ] 每个 scenario 都有测试、断言、实现证据或豁免理由。

### 实现后

- [ ] 已运行定向测试或说明未运行原因。
- [ ] 已使用或等价遵循 `spec-compliance-check`。
- [ ] CRITICAL 问题已修复或更新规格后重新审查。
- [ ] `tasks.md` 勾选状态真实。
- [ ] README/AGENTS/spec 同步判断已完成。

### 归档 / 交付前

- [ ] 已使用或等价遵循 `openspec-verify-change`。
- [ ] 已运行 `openspec validate --all` 或说明原因。
- [ ] 已使用或等价遵循 `verification-before-completion`。
- [ ] 最终回复只包含本次真实运行过的验证命令和结果。
- [ ] 剩余风险明确。
- [ ] 合并目标由人工确认。

## 10. 常见反模式

| 反模式 | 风险 | 拦截方式 |
| --- | --- | --- |
| 让 AI 直接“全仓优化” | 大量无关 diff，难审查 | 先建规格，限定范围 |
| 把 README 当唯一事实来源 | 易过期，缺项目语境 | 写入 `AGENTS.md`、`spec/` 和 OpenSpec |
| 全量复制 ECC / 外部规则 | 规则冲突、hooks 重复、上下文膨胀 | 按需裁剪，项目化改写 |
| CodeGraph 查到入口就直接改 | 影响面不完整 | Bridge Plan + `rg` 补盲 |
| 只读 `tasks.md` 就开始改代码 | 忽略 proposal/design/specs | `openspec-superpowers-bridge` |
| 需求变了但不更新 OpenSpec | 实现与规格漂移 | 更新工件后继续实现 |
| 跑了一个测试就说完成 | 高风险验证缺失 | `verification-before-completion` + 验证矩阵 |
| tasks 勾选不真实 | 归档误判 | `openspec-verify-change` |
| 发布包或配置改动不跑 assembly | 交付包缺文件或路径错 | `ReleasePackageAssemblyTest` |
| 不记录 parent branch | worktree / feature 合并混乱 | 显式记录合并目标 |
| 把本地 token / settings 提交 | 安全事故 | `.gitignore` + 提交前检查 |

## 11. 参考资料

- OpenSpec: `https://github.com/Fission-AI/OpenSpec`
- OpenSpec docs: `https://openspec.dev/`
- CodeGraph: `https://github.com/colbymchenry/codegraph`
- CodeGraph docs: `https://colbymchenry.github.io/codegraph/`
- ECC: `https://github.com/affaan-m/ECC`
- andrej-karpathy-skills: `https://github.com/multica-ai/andrej-karpathy-skills`
- GitHub CLI: `https://github.com/cli/cli`
- ripgrep: `https://github.com/BurntSushi/ripgrep`

本项目参考文档：

- `docs/AI 辅助开发工程化落地白皮书.md`
- `docs/AI 辅助开发工程化落地白皮书-实操版.md`
- `docs/AI辅助开发从0到1通用集成指南-融合版.md`
- `docs/AI辅助开发从0到1通用集成指南-Skills门禁增强版.md`
- `docs/AI辅助开发从0到1通用集成指南-项目融合与README-AGENTS同步版.md`
- `docs/DPM-ILDA多AI客户端SpecCoding与CodeGraph从0到1集成指南.md`
