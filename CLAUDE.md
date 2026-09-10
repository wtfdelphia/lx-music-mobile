# CLAUDE.md

**项目通用规则以 [`AGENTS.md`](AGENTS.md) 为准。** 本文只记录 Claude Code 在本仓库的专属差异，不重复 `AGENTS.md` 已有内容。用户级全局 `CLAUDE.md` 中的行为准则同样适用；两者冲突时以更严格的一方为准。

事实源顺序、Skills 门禁表、提交信息纪律、文档去 AI 痕迹、工作区边界在 `AGENTS.md`。

## Skills 调用

用 `Skill` 工具按名调用 `.claude/skills/` 下的 12 个 skill，不要凭猜测拼名字。门禁场景与必须产出见 `AGENTS.md` 的 Skills 门禁表。

## 工具偏好

- 读文件用 `Read`，不用 `cat` / `head` / `tail`
- 改文件用 `Edit` / `Write`，不用 `sed` / `awk` / `echo` 重定向
- 搜索用 `Grep` / `Glob`，不用 `find` / `grep`（`find` 仅在需要目录层级或文件类型统计时使用）
- 无依赖的工具调用放在同一轮并行发出
- CodeGraph 通过 `Bash` 调用 `codegraph` CLI（参数坑见 `AGENTS.md` 上下文获取一节）

## 大范围改动

跨模块重构、批量迁移、多文件同类修改，用 `Agent` 分派子任务以保住主上下文；单点查找（已知文件、已知符号）直接搜索，不要分派。

## 验证纪律

`AGENTS.md` 验证矩阵中标注为「无 CI 覆盖」或「已知红项」的项，不得表述为通过的门禁。iOS 模拟器冒烟与真机行为在本地环境通常无法执行，需说明未验证并标注剩余风险，不得推断结果。

## 提交与文档门禁

规则见 `AGENTS.md` 的「提交信息纪律」与「文档去 AI 痕迹」。Claude Code 侧的执行方式：用 `Skill` 工具调 `caveman-commit` / `humanizer-zh`，在 `Bash` 跑 `git commit` 或 `gh pr create` **之前**完成，不靠事后 `--amend` 补救。

