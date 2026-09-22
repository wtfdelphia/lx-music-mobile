本版本是 wtfdelphia fork 的首个自有发布（基于上游 1.9.1，已含上游
1.9.0 与 1.9.1 的全部变化）。

### 新增

- iOS 支持：本 Release 附带未签名 IPA（`-unsigned.ipa`），需经
  AltStore / SideStore 等工具自行重签安装
- 应用内更新检查改为本仓库发布通道

### 注意

- 本仓库 APK 签名与上游不同，从上游版本更新需先卸载再安装
- Android 安装包为 5 个：`arm64-v8a`、`armeabi-v7a`、`x86_64`、
  `x86`、`universal`，按设备 ABI 选择，大多数现代手机选
  `arm64-v8a`
