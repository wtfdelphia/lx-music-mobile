## Why

lx-music-mobile 仅支持 Android：`ios/` 目录三年只有 RN 升级的模板同步，五个自研原生模块无 iOS 实现，两个 fork 依赖根本没有 `ios/` 代码，App 在 iOS 上启动即崩。取证与路线对比已完成（`docs/` 下五份文档），最终决策见 `docs/ios-optimal-plan.md`：在现有 RN 工程内补齐 iOS 侧，加密核心 Rust 化，沙箱用 JSC，以脚本回归闸门决定后续引擎演进。目标为自用 / TestFlight 内测可用，不上架 App Store。

## What Changes

- 新增五个自研原生模块的 iOS 实现：Crypto（Rust 核心 + ObjC 薄封装）、UserApi（JSC 沙箱）、Utils、Cache；Lyric 桩化
- 新增 `rust/lxcore` 工作区，首期仅 `lxcore-crypto`（C ABI staticlib，仅 iOS 链接，Android 零改动）
- `src/` 新增平台扩展文件（`fs.ios.ts`、`toast.ios.tsx`、`version.ios.js`、`useBackHandler.ios.ts`、`lyricDesktop.ios.ts`），业务逻辑零重写
- 修复三处 `StatusBar.currentHeight` Android-only 静默失效，桩化 `useBackHandler`
- iOS 工程配置：Info.plist（`UIBackgroundModes`、深链、`CFBundleDocumentTypes`、字体）、Podfile 关 Flipper、Bundle ID / arm64
- 新建验证基础设施：加密黄金基准（Android 真机产出）+ 社区脚本回归集
- CI 新增 iOS unsigned 编译回归 job

## Capabilities

### New Capabilities

- `ios-app-runtime`: iOS 启动、原生模块面、布局安全区与降级入口
- `ios-file-access`: 文件系统适配层等价性、gzip 跨端互通、文件选择导入
- `ios-crypto`: AES/RSA 加密契约，与 Android 字节级一致
- `ios-user-api-sandbox`: 自定义源脚本沙箱与脚本兼容性闸门
- `ios-playback`: 后台播放、锁屏控制、缓存能力降级
- `ios-distribution`: iOS 构建回归与内部分发合规

### Modified Capabilities

无（项目当前无任何已有 spec）。

## Impact

- 代码：`ios/` 工程、`src/utils` 平台扩展、`src/components` 三处布局文件、`android/app/build.gradle` 一处 assets 路径、新增 `rust/` 工作区
- 依赖：`react-native-fs`（iOS 适配层底座）、libz、Rust 工具链（仅 iOS 构建链）
- 构建：CI 新增 macos job；本地需 Xcode 15+ 与 Apple 开发者账号
- 非目标：桌面歌词、App Store 上架、TestFlight 外部测试、应用内更新、本地音乐标签写入、Rust 全栈或全平台重写、任何 Android 行为变更
