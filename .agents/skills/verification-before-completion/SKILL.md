---
name: verification-before-completion
description: Use when about to claim work is complete, create a PR, archive a change, merge, or send a final completion report.
---

# verification-before-completion

## 何时使用

最终回复、PR、归档、合并或任何声称完成/通过之前使用。原则是证据先于结论：没有真实命令输出，就不能声称通过。

## 输入

- change name
- 本会话真实运行过的验证命令、输出摘要和失败信息
- `cargo check --release --all-targets` 的告警数（改动前后对比）
- git status --short
- 文档同步判断
- 未运行验证的 SKIPPED 原因与剩余风险

## 规则

- 只报告本会话真实运行的命令与结果。
- 未运行必须写 SKIPPED、原因、剩余风险。
- 有代码改动时，必须运行 `cargo check --release --all-targets` 并报告告警数；存在新增告警即视为未完成（见 `AGENTS.md`「零新增编译告警」）。
- 不隐藏失败；失败可以交付为风险，但不能写成通过。
- 不泄露 token、账号、Cookie、真实配置。
- 完成前必须检查 git status --short，确认没有 config.json、credentials.json、credentials.*、.codegraph/ 或真实密钥进入候选提交。

## 必产出

写入 openspec/changes/<name>/evidence/verification-before-completion.md，至少包含：

- Verification 列表：命令、结果、结论。代码改动须含 `cargo check --release --all-targets` 告警数。
- Documentation Sync 表：README、AGENTS、CLAUDE、spec、openspec/specs、tooling-sources 等是否需要同步。
- Residual Risk：未 archive、未 push/PR/merge、未运行的业务测试、工具限制等。

## 停止条件

- git status 显示敏感文件或本地缓存将被提交。
- 关键验证未运行且没有 SKIPPED 说明。
- 代码改动引入了新的编译告警。
- 用户要求忽略失败但没有明确承担风险。
- 最终结论与 evidence 中真实结果不一致。
