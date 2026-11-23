# update-channel Specification

## Purpose
定义应用内更新检查通道：数据源指向哪个仓库身份与分支、源列表
如何构成、Android 下载与 iOS 跳转的落点，保证用户收到的更新
提示与下载内容始终来自本仓库。

## Requirements

### Requirement: 更新检查数据源指向

应用内检查更新的数据源地址由 `package.json` 的 `author.name` 与
`name` 拼出。`author.name` SHALL 为 `wtfdelphia`，使源地址指向
`wtfdelphia/lx-music-mobile`。`name` SHALL 保持
`lx-music-mobile`，以维持 APK 文件名与下载 URL 的稳定。

#### Scenario: 数据源指向 fork

- **WHEN** 应用执行更新检查
- **THEN** 首个数据源解析为
  `https://raw.githubusercontent.com/wtfdelphia/lx-music-mobile/main/publish/version.json`

### Requirement: 数据源列表构成

`src/utils/version.js` 与 `src/utils/version.ios.js` 的数据源列表
SHALL 仅包含指向 `wtfdelphia/lx-music-mobile` `main` 分支
`publish/version.json` 的源。不得保留任何指向上游
`lyswhut/lx-music-mobile`、上游 npm 包、jsdelivr、gitee 或
stsky 的源。

#### Scenario: 无上游降级路径

- **WHEN** 更新检查的任一源失败并回退到下一源
- **THEN** 候选列表中不存在任何上游域名，最终要么命中
  `wtfdelphia` 的 `version.json`，要么整体失败

### Requirement: Android 更新下载指向

Android 的更新下载地址由 `author.name`、`name` 与版本号拼出。
更新下载 SHALL 命中 `wtfdelphia/lx-music-mobile` 对应版本的
GitHub Release 附件，且附件为用本仓库签名密钥签名的 APK。

#### Scenario: 下载与安装兼容

- **WHEN** 用户确认更新，应用按当前设备 ABI 选择并下载对应
  APK
- **THEN** 下载 URL 指向 `wtfdelphia/lx-music-mobile` 的 Release，
  下载的 APK 与已安装版本签名一致，可直接覆盖安装

### Requirement: iOS 更新跳转指向

iOS 的更新跳转 SHALL 打开 `wtfdelphia/lx-music-mobile` 对应
版本的 Release 页面。用户从该页面下载未签名 IPA 并自行重签
安装，与分发合规约束一致。

#### Scenario: 跳转落点存在

- **WHEN** iOS 用户确认更新
- **THEN** 应用通过 `Linking.openURL` 打开
  `https://github.com/wtfdelphia/lx-music-mobile/releases/tag/v{version}`，
  该页面提供未签名 IPA
