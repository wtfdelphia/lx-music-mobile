## ADDED Requirements

### Requirement: 发布触发分支

发布构建工作流 `release.yml` SHALL 仅由 `main` 分支的 push 触发。
`master` 分支仅承载上游镜像同步，其 push 不得触发发布构建。

#### Scenario: main push 触发发布构建

- **WHEN** 向 `main` 推送一次包含版本号变更的提交
- **THEN** `release.yml` 的 Android 与 iOS 构建 job 被触发，
  完成后产出一个以 `package.json` 版本号打标的 GitHub Release

#### Scenario: master 同步不触发发布

- **WHEN** 向 `master` 推送上游同步提交
- **THEN** `release.yml` 不被触发，不产生 Release，不打 tag

### Requirement: 发布产物构成

一次发版产出的 GitHub Release SHALL 同时包含 5 个 ABI 的签名
Android APK 与 1 个未签名 iOS IPA。APK 文件名规则为
`lx-music-mobile-v{version}-{abi}.apk`，ABI 为 `arm64-v8a`、
`armeabi-v7a`、`x86_64`、`x86`、`universal`。IPA 为未签名产物，
由用户自行重签安装，与现有分发合规约束一致。

#### Scenario: Release 包含全部产物

- **WHEN** 一次发版构建成功
- **THEN** 对应 Release 的附件包含 5 个 APK 与 1 个未签名 IPA，
  Release 正文包含更新日志与全部产物的 MD5

### Requirement: 版本号与 versionCode

`package.json` 的 `version` SHALL 采用「上游版本号 + fork 递增
后缀」的形式（例如 `1.9.1.1`），使 fork tag 永不与上游 tag 冲突。
`versionCode` SHALL 为独立递增的整数。同一版本号不得发布两次。

#### Scenario: fork 版本高于上游基线

- **WHEN** 上游最新稳定版为 `1.9.1`，fork 在其上发布首个自有版本
- **THEN** 该版本号为 `1.9.1.1`，大于 `1.9.1`，且不与任何上游
  tag 重名

#### Scenario: 版本比较成立

- **WHEN** 应用以 `compareVer` 比较 fork 版本 `1.9.1.1` 与上游
  `1.9.1`
- **THEN** 比较结果为前者更高

### Requirement: 版本信息随仓库分发

发版流程更新后的版本信息 `publish/version.json` SHALL 随 `main`
分支直接提交入库。不得依赖上游的 `publish-version-info.yml` 或
任何上游 npm 包作为版本信息来源。

#### Scenario: 发版写回版本信息

- **WHEN** 执行一次发版
- **THEN** `publish/version.json` 的 `version`/`desc`/`history`
  在本仓库内更新并提交，无需外部仓库或凭据参与
