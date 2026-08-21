# LX Music Mobile — iOS 版本进展与困难点深度分析报告

> 分析日期：2026-08-21　|　分析工具：CodeGraph v1.5.0（索引 654 文件 / 6,883 符号 / 16,208 依赖边）+ 源码人工走读 + Git 历史与上游依赖核查
> 分析对象：`master` 分支 @ `05c322a`（发布 v1.8.1，versionCode 73），React Native 0.73.11 / React 18.2.0

---

## 1. 结论摘要（TL;DR）

1. **官方层面：iOS 版处于"明确不做"状态。** README 写明"目前没有计划支持 iOS 和 HarmonyOS NEXT"；维护者在 [lyswhut/lx-music-desktop#1912](https://github.com/lyswhut/lx-music-desktop/issues/1912) 中确认"由于没有 iOS 相关开发环境，所以暂定仍只支持安卓"，且整个 LX 系列已进入维护模式（精力转向新项目 any-listen）。
2. **代码层面：`ios/` 目录只是随 RN 升级保留的模板工程**（AppDelegate 已按 react-native-navigation 要求接线），Git 历史中 `ios/` 的变更全部来自 RN 版本升级，没有任何 iOS 功能开发。CI 只构建 Android APK。
3. **真正的障碍不是 UI 而是原生层**：应用依赖 5 个自研 Android 原生模块（工具、加密、桌面歌词、自定义源 QuickJS 引擎、缓存），iOS 端全部缺失；其中"自定义源引擎"是播放在线音乐的**唯一**通道（内置音源 API 已全部移除），属于必须重写的核心功能。
4. **JS 层按 Android 单平台编写**：`src/app.ts` 顶层直接解构 `NativeModules.UtilsModule`，在 iOS 上 bundle 加载阶段即抛异常，**当前代码在 iOS 上连启动都过不了**。
5. 若要移植，工作量集中在：iOS 原生模块补齐（尤其 userApi 沙箱引擎）、iOS 系统配置（后台音频/ATS/深链）、两个自研 fork 依赖的 iOS 实现、以及分发渠道问题。详见第 6、7 节。

---

## 2. 项目概况（CodeGraph 视角）

lx-music-mobile 是基于 React Native 的音乐播放器，Android 5+ 为唯一官方支持平台。

**代码规模与构成（CodeGraph 索引统计）**

| 维度 | 数据 |
| --- | --- |
| 索引文件 | 654 个 |
| 符号节点 | 6,883 个（import 3,402 / function 972 / constant 625 / method 348 / interface 340 / component 45） |
| 依赖边 | 16,208 条 |
| 语言分布 | tsx 286、typescript 205、javascript 111、**java 35**、yaml 9、**objc 4** |

**架构分层**

| 层 | 目录 | 说明 |
| --- | --- | --- |
| UI 层 | `src/screens/`、`src/components/` | 基于 react-native-navigation 的页面与通用组件，纯 JS，理论跨平台 |
| 业务核心 | `src/core/` | 初始化流程、播放器、歌词、歌单、同步、版本、userApi 等域逻辑 |
| 状态层 | `src/store/` | 自研轻量 store（action/state/hook 三件套，非 Redux——README 所述 Redux 已过时） |
| 插件层 | `src/plugins/` | track-player 播放器封装、async-storage 存储、同步客户端、歌词 |
| 音源 SDK | `src/utils/musicSdk/` | 酷我/酷狗/咪咕/网易/腾讯/百度的搜索、歌单、榜单、歌词等纯 JS 请求封装 |
| 原生桥 | `src/utils/nativeModules/` + `android/.../java` | **Android 单侧实现**，见第 4 节 |

**初始化链路**（`src/app.ts` → `src/core/init/index.ts`）：
`initSetting → initTheme → initI18n → initUserApi → setApiSource → registerPlaybackService → initPlayer → dataInit → initCommonState → initSync → initDeeplink`。

---

## 3. iOS 版本当前进展

### 3.1 官方立场：无计划支持

- README（`README.md`）："**注：目前没有计划支持 iOS 和 HarmonyOS NEXT**。"
- 官方 FAQ 已迁移至外部文档站，无任何 iOS 内容；`CHANGELOG.md` 全文仅一处 iOS 相关记录（v1.2.0 时代"跟随系统深浅色模式需 iOS 13+"）。
- 项目整体进入维护模式：issue #1912 宣布开发重心转向私有云音乐新项目（any-listen，2025-05-11 已发布），LX"没有特殊情况下预计不会有重大的改变"。

### 3.2 `ios/` 目录现状：仅存模板骨架

现存文件全部为 RN 0.73 模板 + 一处定制：

| 文件 | 状态 |
| --- | --- |
| `ios/LxMusicMobile/AppDelegate.mm` | 已按 react-native-navigation 要求接线（`[ReactNativeNavigation bootstrapWithBridge:]`），是唯一非模板内容 |
| `ios/LxMusicMobile/Info.plist` | **裸模板**：无后台音频模式、无 URL Scheme、ATS 未放行 http（见 4.6） |
| `ios/Podfile` | 裸模板，Flipper 默认启用，无任何定制 |
| `LxMusicMobile.xcodeproj`、`LaunchScreen.storyboard`、`Images.xcassets` | 模板默认 |

`git log --all -- ios/` 显示该目录的提交历史只有两类：React Native 版本升级（0.65→0.66→0.67→0.68→0.71→0.72→0.73）和一次"还原 IOS 目录"。**从未有过 iOS 功能性开发。**

### 3.3 构建与发布：只有 Android

- `.github/workflows/release.yml`、`beta-pack.yml`：仅 `gradlew assembleRelease`，产物为 5 个 ABI 的 APK；无 Xcode/macOS runner 作业。
- `package.json` scripts：`dev`/`pack`/`bundle-android` 全部指向 Android；`ios` 脚本（`react-native run-ios`）是模板残留。
- Release 页面历史上从未发布过 iOS 包。

### 3.4 小结

iOS 版的"进展"可以概括为：**工程骨架随 RN 升级被动保留，功能开发为零，且官方已明确关闭了这条路线**。社区若想要 iOS 版，只能自行 fork 编译（需自备 Mac、Xcode、签名），或完成下文所列的原生层移植。

---

## 4. 代码级差距分析：iOS 缺什么

### 4.1 启动即崩：原生模块的顶层硬依赖

`src/utils/nativeModules/utils.ts` 在模块顶层直接解构 Android 原生模块：

```typescript
const { UtilsModule } = NativeModules   // iOS 上为 undefined
export const exitApp = UtilsModule.exitApp   // TypeError，bundle 加载即抛
```

而 `src/app.ts`（入口 `index.js` 直接引入）顶层静态 import 了 `exitApp`。CodeGraph `impact exitApp` 显示该模块影响 21 个符号、被 13 处调用（设置初始化、播放服务、侧边栏退出、定时退出等）。**结论：未做任何适配时，iOS 构建在 JS bundle 求值阶段就会崩溃，走不到首帧渲染。** 同类问题存在于 `crypto.ts`、`lyricDesktop.ts`、`userApi.ts`（均在顶层解构 `NativeModules.*`）。

### 4.2 五个自研 Android 原生模块，iOS 侧全部缺失

`android/app/src/main/java/cn/toside/music/mobile/`（35 个 Java 文件）与 `ios/`（4 个模板 ObjC 文件）的对比：

| Android 模块 | 关键能力 | iOS 现状 | 对 iOS 的功能影响 |
| --- | --- | --- | --- |
| `utils/UtilsModule` (58 符号) | 退出应用、保持唤醒、获取 WiFi IP、设备名、通知权限、屏幕状态事件、窗口尺寸、电池优化豁免 | 无 | 启动即崩（4.1）；同步功能展示本机地址、定时退出等不可用 |
| `userApi/QuickJS` (37 符号) + `UserApiModule` | **用 QuickJS 沙箱运行"自定义源"脚本**，含 Console 劫持、JsHandler、独立 JS 线程 | 无 | **致命**：在线播放完全依赖自定义源，见 4.3 |
| `crypto/CryptoModule` (AES/RSA) | RSA 密钥生成、OAEP 加解密、AES CBC/ECB——服务于同步服务与自定义源的安全通信 | 无 | 数据同步（v1.0+ 的同步服务端鉴权）不可用 |
| `lyric/LyricModule` (9 文件，含悬浮窗 View) | Android 桌面歌词：悬浮窗绘制、锁屏、拖动、主题 | 无 | 桌面歌词功能无法存在（iOS 无悬浮窗机制，见 4.4） |
| `cache/CacheModule` | 应用缓存统计与清理 | 无 | 设置页"清除缓存"不可用（影响小） |

### 4.3 自定义源引擎：iOS 移植的最大单点困难

- `src/utils/musicSdk/api-source.js` 中内置音源 API 列表 `apiList` 已被**全部注释清空**，`api-source-info.ts` 导出空数组——这是版权压力下的主动移除。
- 因此 `apis(source)` 只剩一条路：`if (/^user_api/.test(setting['common.apiSource'])) return global.lx.apis[source]`，即**所有在线搜索/播放链接解析都走用户导入的自定义源脚本**。
- 自定义源脚本由 Android 端的 QuickJS 原生模块在独立线程沙箱执行（`android/.../userApi/`），JS 层 `src/utils/nativeModules/userApi.ts` + `src/core/userApi/` 通过事件与其通信。
- iOS 上没有对应实现，也没有现成等价物：Hermes 不提供可嵌入的二次求值 API。可行方向是自建原生模块，用 iOS 系统自带的 `JavaScriptCore.framework` 开独立上下文跑脚本（与 Android 用 QuickJS 的思路同构），或退而用隐藏 WKWebView。这是移植中**唯一需要从零开发的核心功能模块**。

### 4.4 桌面歌词：平台机制性缺失

Android 桌面歌词建立在"悬浮窗（SYSTEM_ALERT_WINDOW）"之上（FAQ 亦提示需授予悬浮窗权限）。iOS 没有应用外悬浮窗机制，等价能力只能靠 Live Activities/灵动岛（仅状态栏展示、样式受限）或完全放弃。`src/utils/nativeModules/lyricDesktop.ts` 暴露了 27 个符号（显示/隐藏/锁定/主题/位置/动画等），全部依赖 `LyricModule`。移植策略上通常选择**在 iOS 端隐藏该功能入口**而非重造。

### 4.5 自研 fork 依赖的 iOS 支持情况

`package.json` 中 4 个 GitHub fork 依赖逐一核查（截至对应 commit 的仓库树）：

| 依赖 | iOS 支持 | 证据 |
| --- | --- | --- |
| `react-native-track-player`（播放核心） | ✅ 保留 `ios/RNTrackPlayer` 原生实现（继承上游） | fork 仓库树含 `ios/`；上游本就跨平台，基于 AVPlayer |
| `react-native-background-timer` | ✅ 有 `ios/` | fork 仓库树 |
| `react-native-file-system` | ❌ **有 podspec 无实现**：podspec 声明 `source_files = "ios/**/*.{h,m,mm}"`，但仓库树中不存在 `ios/` 目录 | pod 安装会静默通过、运行时模块为 undefined；`src/utils/fs.ts` 的目录枚举/移动等能力受影响 |
| `react-native-local-media-metadata` | ❌ 无 `ios/` | 本地媒体元数据编辑（`src/utils/localMediaMetadata.ts`、MetadataEditModal）不可用 |

其余第三方依赖（RNN 7.39.2、pager-view、fast-image、fs、clipboard、slider、vector-icons、quick-md5/base64、async-storage 等）上游均支持 iOS，无需改造。

### 4.6 iOS 系统配置缺口（Info.plist / 能力声明）

当前 `Info.plist` 为裸模板，直接运行会踩中 iOS 的硬性限制：

| 缺口 | 后果 | 对应功能 |
| --- | --- | --- |
| 无 `UIBackgroundModes: audio` | 切后台/锁屏即停播 | 音乐播放器的基本盘 |
| `NSAllowsArbitraryLoads = false` 且无域名例外 | 大量 `http://` 音频流与音源接口被 ATS 拦截 | 在线播放、搜索 |
| 无 `CFBundleURLTypes` | v1.6.0 新增的 Scheme URL 深链（`src/core/init/deeplink/`，含播歌/打开歌单/文件动作）不可用 | 深链调用 |
| 无 `NSAppleMusicUsageDescription` 等权限描述 | 涉及媒体库/本地文件访问时直接闪退 | 本地歌曲、元数据编辑 |

### 4.7 JS 层几乎零平台分支

全仓 `Platform.OS` 判断仅 3 处（`src/utils/tools.ts`），`isAndroid` 仅被用于"跟随系统深浅色"一处开关；`ToastAndroid`、`BackHandler`、`PermissionsAndroid` 等 Android API 被无防护地直接使用。这意味着 JS 层从未为 iOS 做过行为设计，移植时需要系统性走查 UI 细节（返回手势、状态栏/安全区、Toast 替代、文件选择器 `ChoosePath` 的 Android 存储路径模型等）。`src/utils/fs.ts` 中的目录概念（`privateStorageDirectoryPath`、`temporaryDirectoryPath` 等）在 iOS 沙盒下语义不同，下载/缓存路径需要重新设计。

---

## 5. 困难点清单（按严重程度排序）

| # | 困难点 | 性质 | 严重度 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 自定义源 QuickJS 引擎无 iOS 实现 | 功能缺失（核心） | 🔴 致命 | 在线播放唯一通道；需用 JavaScriptCore/WKWebView 重建沙箱执行器 + 事件桥 |
| 2 | 5 个自研原生模块全缺，入口顶层硬依赖 | 启动崩溃 | 🔴 致命 | 最小可启动需先给 `UtilsModule` 等提供 iOS 实现或 JS 兜底 |
| 3 | iOS 系统配置（后台音频/ATS/深链/权限描述） | 配置缺失 | 🟠 高 | 工作量小但不做则"能启动也不能听歌" |
| 4 | 自研 fork（file-system、local-media-metadata）无 iOS 实现 | 依赖缺失 | 🟠 高 | 需补原生代码或改用替代库 |
| 5 | 维护者无 iOS 开发环境、项目维护模式 | 人力/资源 | 🟠 高 | 官方路线已关闭；上游问题（RN 升级、依赖兼容）也无人推进 |
| 6 | 桌面歌词平台机制缺失 | 设计取舍 | 🟡 中 | 建议 iOS 端隐藏入口而非重造 |
| 7 | 分发与签名 | 生态 | 🟡 中 | App Store 审核（版权类应用难过审 + 需公司/个人开发者账号费用）；现实路径是 TestFlight/AltStore/自签，体验与稳定性差 |
| 8 | RN 0.73 老架构 + 部分依赖停滞 | 技术债 | 🟡 中 | 未来升级新架构时 iOS 侧 codegen/Pod 配置需重新验证 |
| 9 | JS 层 Android 单平台假设（Toast/BackHandler/路径模型/UI 细节） | 适配量 | 🟡 中 | 分散、量大、需逐屏走查 |
| 10 | 法律/版权风险 | 非技术 | ⚫ 决定性 | 内置音源正是因此移除；iOS 渠道分发放大该风险，这是官方不做 iOS 的深层背景 |

---

## 6. 若启动移植：建议路线

**阶段 0 · 可启动（1-2 周量级）**
1. `nativeModules/*` 全部加平台防护：iOS 侧提供桩实现或 `NativeModules.X ?? stub`，先保证 bundle 能加载；
2. 补齐 Info.plist：`UIBackgroundModes=audio`、ATS 例外、URL Scheme、权限描述；
3. Podfile 去 Flipper、验证 RNN 7.39.2 + RN 0.73.11 在 iOS 上编译跑通（真机 + 模拟器）。

**阶段 1 · 能听歌（核心，工作量最大）**
4. 用 `JavaScriptCore.framework` 实现 iOS 版 userApi 沙箱模块，对齐 Android `UserApiModule` 的事件协议（`loadScript/sendAction/onEvent`），复用 `src/core/userApi/` 全部 JS 逻辑；
5. 验证 track-player fork 在 iOS 的播放/通知栏/锁屏控制/缓冲缓存（`maxCacheSize` 等 Android 参数在 iOS 的行为）。

**阶段 2 · 功能对齐**
6. `CryptoModule` iOS 实现（CommonCrypto/Security.framework），恢复数据同步；
7. 补齐或替换 file-system、local-media-metadata 两个 fork 的 iOS 能力；
8. 桌面歌词入口按平台隐藏；版本更新流程改为跳转外部下载/提示；
9. 逐屏 UI 走查（安全区、返回手势、Toast、路径选择器）。

**阶段 3 · 分发**
10. 自签/TestFlight 先行；评估 App Store 上架可行性（大概率因版权与 4.2/5.2 条款被拒，不建议投入）。

---

## 7. 证据索引

| 结论 | 证据位置 |
| --- | --- |
| 官方不做 iOS | `README.md` "说明"一节；issue lyswhut/lx-music-desktop#1912 |
| ios/ 仅随 RN 升级变更 | `git log --all -- ios/` |
| CI 仅 Android | `.github/workflows/release.yml`、`beta-pack.yml` |
| 启动崩溃链 | `src/app.ts:6` → `src/utils/nativeModules/utils.ts:3`；`codegraph impact exitApp`（21 符号） |
| 内置音源清空、自定义源成唯一通道 | `src/utils/musicSdk/api-source.js`、`api-source-info.ts` |
| QuickJS 沙箱 | `android/app/src/main/java/cn/toside/music/mobile/userApi/` |
| fork 依赖 iOS 缺失 | lyswhut/react-native-file-system、lyswhut/react-native-local-media-metadata 仓库树（对应 commit） |
| Info.plist 配置缺口 | `ios/LxMusicMobile/Info.plist` |
| 平台分支稀缺 | `rg "Platform.OS"` 全仓仅 3 处（`src/utils/tools.ts`） |

---

*本报告由 CodeGraph 代码图谱分析 + 源码走读生成。数据快照对应 master 分支 v1.8.1（commit 05c322a）。*
