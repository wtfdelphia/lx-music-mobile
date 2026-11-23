## Why

上游已发布 v1.9.2（`v1.9.1..v1.9.2` 共 6 个提交、8 个文件），fork 的
`main` 停留在 v1.9.1（PR #4 对齐）。缺口是四项实质内容：kg 歌单
打不开的修复、音频卸载默认关闭（含存量迁移与设置版本升 2.1）、
`react-native-track-player` fork 依赖升级（音频卸载参数，纯
Android）。音频卸载是 Android ExoPlayer 行为，上游在正式版前紧急
默认关闭，fork 应跟进，避免同类问题在 fork 用户侧重现。

## What Changes

- 同步上游 4 个实质提交：`e6be258`（kg 歌单修复）、`025d782`（默认
  禁用音频卸载）、`43a3acd`（track-player 依赖升级）、`b3afb18`
  （设置版本 2.1 与迁移）。跳过两个纯版本号提交（`3b1cb20`、
  `0669d1b`），版本号与发布元数据按 fork 惯例单独处理
- 解冲突时保留 fork 身份：`package.json` 的 `author.name`、
  `repository.url` 不改回上游；`publish/version.json` 与
  `publish/changeLog.md` 走 fork 单源发布通道
- 发布提交（第二步）：版本号 `1.9.1.2 → 1.9.2.1`，`versionCode`
  递增，`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` 对齐，
  `publish/version.json` 与 CHANGELOG 补 fork 段落

不改变：更新通道与发布流水线（`fork-update-channel` 已落地）、
Rust 加密核心、iOS 曲库与下载功能、自定义源沙箱。

## Capabilities

### Modified Capabilities

- 无。本变更是上游代码同步与版本发布，不改变任何已记录能力的
  行为契约；音频卸载默认值变化属上游行为决策，归入发布说明

## Impact

- 代码：`src/utils/musicSdk/kg/songList.js`、
  `src/config/defaultSetting.ts`、`src/config/migrateSetting.ts`、
  `package.json` / `package-lock.json`、`publish/`、`CHANGELOG.md`
- 依赖：`react-native-track-player` fork commit
  `bfe3393 → d76fe8f`（差异仅 `MusicManager.java` 音频卸载参数）
- Android：音频卸载默认关闭，存量开启用户在设置迁移时被强制关闭
  （上游行为决策，原样跟进）
- iOS：无行为变化（依赖差异不含 iOS 文件）
- 风险：依赖切换为 fork commit 锁定版本，行为以上游锁定源为准，
  无第三方新依赖
