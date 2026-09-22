## Why

fork 的发布与更新链路全部硬编码在上游身份与上游分支上：`release.yml`
只认 `master`（发版动作发生在 `main`，永不触发），应用内检查更新的 8 个
数据源与下载地址全指向 `lyswhut/lx-music-mobile`，
`publish-version-info.yml` 依赖 fork 不拥有的上游凭据。上游已发
v1.9.1，fork 用户收到更新提示后会下载上游签名的包，覆盖安装失败。
签名 secrets 已在 fork 仓库配齐，发布的前置条件就绪，该建立自己的
发布与更新通道。

## What Changes

- `release.yml` 新增 iOS 构建 job：复用 `ios-verify.yml` 的
  ios-build 步骤产出未签名 IPA，挂到同一个 GitHub Release
- 删除 `publish-version-info.yml`（依赖上游 PAT 与上游 version-info
  仓库，fork 侧必然失败）
- `package.json`：`author.name` 改为 `wtfdelphia`，`repository.url`
  改为 fork 仓库地址；`name` 保持 `lx-music-mobile` 不动
- `src/utils/version.js`、`version.ios.js`：数据源列表收敛为 fork
  仓库 `main` 分支的 `publish/version.json` 单一来源；下载地址与
  跳转地址随身份自动转向；删除上游 npm、jsdelivr、gitee、stsky 源
- `README.md`：下载入口三处链接改指 fork 仓库
- 版本号规范：上游版本号 + fork 递增后缀（如 `1.9.1.1`），避免与
  上游 tag 冲突

不改变：Rust 加密核心、原生桥接契约、播放链路、数据同步协议。
`release.yml` 触发分支 `master` → `main` 已随 PR #2 落地，不在本
变更范围。

## Capabilities

### New Capabilities

- `release-distribution`：fork 的构建发布流水线。定义发布触发、
  产物构成（5 个 ABI APK + 未签名 IPA）、版本号与 versionCode
  规则、Release 正文要求。
- `update-channel`：应用内更新检查通道。定义数据源身份、源列表
  构成、Android 下载地址与 iOS 跳转目标。

### Modified Capabilities

无。`ios-distribution` 的三条合规通道（源码自编译、TestFlight
内部测试、自签）已覆盖未签名 IPA 经 Release 分发后用户自签的场景。

## Impact

- `.github/workflows/release.yml`、`.github/workflows/publish-version-info.yml`
- `package.json`（身份字段）
- `src/utils/version.js`、`src/utils/version.ios.js`
- `README.md`
- fork 仓库运行时行为：更新检查、更新下载、更新跳转全部转向
  `wtfdelphia/lx-music-mobile`
