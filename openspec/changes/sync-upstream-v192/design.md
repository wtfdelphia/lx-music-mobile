## 背景与约束

上游 2026-09 重写 `master` 历史（squash）后，fork 与上游每次同步
都无共同祖先。PR #4 用 `git replace --graft` 做三方合并；本次
worktree 复测发现嫁接在本机被 commit-graph 干扰，`merge` 报
unrelated histories，不可靠。上游 `v1.9.1..v1.9.2` 只有 6 个提交、
8 个文件，cherry-pick 实质提交的冲突面实测极小（`e6be258` 唯一
冲突是 fork 改写过的 `publish/changeLog.md`），故放弃嫁接合并，
改用 cherry-pick。

## 决策

1. **cherry-pick 实质提交，跳过版本号提交**。上游的
   `3b1cb20`（beta 版本号）与 `0669d1b`（发布提交）只含版本号、
   CHANGELOG 与 `publish/` 元数据，与 fork 惯例冲突；跳过它们，
   版本号按 fork 后缀规则单独提交。
2. **同步与发布拆两个提交**。`release.yml` 的 CheckVersion 门闩
   见 `package.json` 版本号对应 tag 不存在即触发完整签名发布。
   版本号若与代码同步一起进 `main`，push 即发布；拆开后代码先合
   先验证，发布时点单独控制。
3. **版本号取 `1.9.2.1`**。上游版本号 + fork 递增后缀，与
   `1.9.1.1` / `1.9.1.2` 规则一致；`versionCode` 80 → 81。
4. **冲突取舍**：`publish/changeLog.md` 取 fork 侧格式，上游
   1.9.2 条目并入 fork 段落；`package.json` 只取依赖行
   （track-player fork commit），身份字段保留；
   `defaultSetting.ts` 保留 fork 的 library / download 键。

## 验证策略

- 同步提交后：`npm test`、`npm run lint`、`tsc --noEmit` 不新增、
  `openspec validate --all`
- 依赖变更：`npm ci` 在干净环境成功（worktree 内验证）
- CI：`ios-verify` 五个 job 全绿后才合并发布提交
- 真机：音频卸载为 Android 行为，无 iOS 实证项；Android 冒烟
  由 CI android-regression 覆盖
