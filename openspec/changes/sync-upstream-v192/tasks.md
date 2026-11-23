## 1. 同步上游实质提交

- [x] 1.1 cherry-pick `e6be258`（kg 歌单修复），解
      `publish/changeLog.md` 冲突取 fork 格式
- [x] 1.2 cherry-pick `025d782`（默认禁用音频卸载）
- [x] 1.3 cherry-pick `43a3acd`（track-player `bfe3393 → d76fe8f`），
      `package.json` 只取依赖行
- [x] 1.4 cherry-pick `b3afb18`（设置版本 2.1 与迁移），
      `defaultSetting.ts` 保留 fork 键
- [x] 1.5 提交同步变更（版本号不动，保持 `1.9.1.2`）

## 2. 验证

- [x] 2.1 `npm ci`（干净依赖树）、`npm test`、`npm run lint`、
      `tsc --noEmit` 不新增、`openspec validate --all`
- [ ] 2.2 推送后 `ios-verify` 五个 job 全绿

## 3. 发布提交（同步验证通过后）

- [ ] 3.1 版本号 `1.9.1.2 → 1.9.2.1`、`versionCode` 80 → 81、
      pbxproj `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` 对齐
- [ ] 3.2 `publish/version.json` 新增 `1.9.2.1` 条目，
      `publish/changeLog.md` 与 `CHANGELOG.md` 补段落
- [ ] 3.3 `chore(release): 发布 v1.9.2.1` 提交，经用户确认后推送
- [ ] 3.4 `release.yml` 触发，5 APK + 1 IPA 发布成功，
      打 `v1.9.2.1` tag
