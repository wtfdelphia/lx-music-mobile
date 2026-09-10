---
name: caveman-commit
description: Use when drafting or refining a commit message, PR title, or squash message. Ultra-compressed Conventional Commits; why over what.
---

# caveman-commit

## 何时使用

产出或优化任何提交信息之前使用：`git commit` 前起草信息、收敛 PR 标题、重写 squash 合并信息。

## 输入

- `git diff --staged`（未 staged 时用 `git diff`）
- `git log --format='%s' -20`（对齐既有 type、scope 与语言习惯）
- 关联的 change name、issue 编号、是否 breaking

## 主题行

格式 `<type>(<scope>): <祈使式摘要>`，`<scope>` 可选。

- type 限定：`feat` `fix` `refactor` `perf` `docs` `test` `chore` `build` `ci` `style` `revert`
- 中文摘要用祈使式动词开头（新增 / 修复 / 移除 / 清零），不写「已新增」「正在修复」
- 英文摘要同样祈使式（`add` / `fix` / `remove`），不用 `added` / `adds` / `adding`
- 长度按终端显示宽度计（CJK 字符算 2 宽度）：目标 ≤50，硬上限 72
- 结尾不加句号
- 语言跟随本仓库习惯：摘要用中文，代码标识符、命令、文件名、规格名保持原文

本仓库既有 scope，优先复用，不新造同义词：

`api` `kiro` `anthropic` `responses` `model` `admin` `admin-ui` `openspec` `spec` `build` `ci` `workflows` `release` `warning-gate` `readme` `docker` `config`

## 正文

默认不写。主题行自解释时整块省略。

仅在以下情况添加：

- why 非显而易见——解释为什么这样改，而不是改了什么（diff 负责说明改了什么）
- breaking change 与迁移说明
- 关联 issue 或 change

格式：

- 72 显示宽度换行
- 列表用 `-`，不用 `*`
- 关联引用放最后：`Closes #42`、`Refs #17`、`Refs openspec/changes/<name>`

### 必须写正文（不得压缩成单行）

- breaking change
- 安全修复
- 数据或配置 schema 迁移
- revert 先前提交
- 告警门禁、发布路径、凭据处理相关改动

理由：这些提交将来会被反向排查，缺上下文的代价远高于多写三行。

## 禁止写入

- 「本次提交做了 X」「我」「我们」「现在」「目前」
- 「按要求」「as requested by...」——真人共同作者用 `Co-authored-by` trailer
- 正文里叙述 AI 参与过程（「由 Claude 生成」「AI 协助完成」之类）
- AI 归属 trailer：不写 `Assisted-by`、`Co-Authored-By`、`Co-authored-by`
- Emoji
- scope 已点明位置时重复文件名

## 示例

主题行自解释，无正文：

```
docs(readme): 补 Responses 工具方言兼容说明
```

why 非显而易见：

```
fix(kiro): Social 凭据 profileArn 解析加冷却

解析失败时每个请求都触发一次强制刷新，高并发下形成刷新风暴
打满上游配额。冷却窗口内复用上次失败结果。

Refs docs/social-profile-arn-force-refresh-storm.md
```

breaking change：

```
feat(config)!: 凭据文件改为多账号数组格式

BREAKING CHANGE: credentials.json 顶层由对象改为数组。旧格式
启动时报错退出，迁移参考 credentials.example.multiple.json。
```

反例：

- ❌ `feat: 新增了一个用于获取用户配置的接口，从数据库读取数据` — 非祈使、超长、复述 what
- ❌ `fix: 修复 bug` — 无信息量
- ❌ `chore: 更新代码 🎉` — 无 scope、无信息量、带 emoji

## 边界

只产出提交信息文本，输出为可直接粘贴的代码块。不执行 `git add`、`git commit`、`git commit --amend`。

用户说「normal mode」或「stop caveman-commit」时恢复常规风格。
