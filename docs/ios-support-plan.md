# lx-music-mobile iOS 支持实施方案

> 输入依据：[docs/ios-analysis.md](./ios-analysis.md)（iOS 现状与困难点）、[docs/flutter-comparison.md](./flutter-comparison.md)（Flutter 重写版对比）
> 代码取证：codegraph v1.5.0 影响面分析 + 全量精读原生模块与桥接层
> 取证基线：`master` @ `05c322a`（v1.8.1），RN 0.73.11 / 老架构 / Hermes
> 撰写日期：2026-08-21（2026-08-24 按审核结论修订统计口径与行号引用）
> 组合路线分析（iOS 适配 × Rust 重构）：[docs/ios-rust-hybrid-analysis.md](./ios-rust-hybrid-analysis.md)
> **最终决策与执行文档**：[docs/ios-optimal-plan.md](./ios-optimal-plan.md)（综合三份分析的最优方案；执行以该文档为准）

---

## 0. 结论先行

**推荐路线：在现有 RN 工程内补齐 iOS 侧，自定义源沙箱改用 JavaScriptCore。**

三条支撑理由：

1. **业务代码 100% 可复用**。`src/` 共 61,667 行，其中真正含 Android 假设的只有 `src/utils/fs.ts`（89 行）、`src/utils/tools.ts`（575 行）、`src/utils/nativeModules/*`（612 行）和 `ChoosePath` 组件族（1,033 行），合计约 2,300 行（占 src/ 约 3.7%）。Flutter 重写等于丢弃全部 61,667 行。
2. **沙箱移植不是重写运行时，是重写 220 行胶水**。`user-api-preload.js`（594 行）对引擎的全部依赖只有 7 项（去注释实测口径）：`Proxy` ×1、`Object.getOwnPropertyDescriptors` ×2、`Promise` ×4、`Uint8Array` ×6、`ArrayBuffer` ×2、`Map` ×2、`Set` ×1，外加一处已被注释掉的 `TextDecoder`。**不使用** `Reflect`、`BigInt`、`WeakRef`、`WeakMap`、`Symbol`、`async/await`、`??`、`?.`。iOS 13.4 的 JavaScriptCore 全部原生支持。
3. **硬阻塞只有 2 项**，都在 fork 依赖层，且都有明确的绕行方案（§4.2、§4.3）。

**明确不做项**：桌面歌词悬浮窗、APK 内更新、App Store 正式上架（理由见 §7、§8）。

> **实施前必读的四个坑**（经复核，均为"照直觉写就会错"且不易察觉的点）：
>
> 1. **`AES_MODE.ECB_128_NoPadding` 的名字是骗人的** —— 它实际带 PKCS7 padding。错了不报错，只是密文内容不对，影响全 App 主干请求。→ §3.2
> 2. **`Compression.framework` 的 `COMPRESSION_ZLIB` 不产 gzip** —— 是 raw DEFLATE，与 Android 的 `GZIPOutputStream` 不互通。→ §4.2.2
> 3. **项目当前没有任何测试载体** —— `cryptoTest.ts` 全是注释，无测试框架。Phase 1 必须先补验证标准（Phase 1.0），否则最关键阶段没有验收门槛。→ §3.2、Phase 1.0
> 4. **TestFlight 外部测试不比正式上架宽松** —— 指南 2.2 明确 Beta 同受约束，会以相同理由被拒。可用的是**内部测试**（≤100 人）。→ §8.3
>
> 另有两处 Android-only API 不含 `Platform.OS`、grep 查不到，但会造成静默失效：`StatusBar.currentHeight`（三处，布局错位）与 `useBackHandler`（返回键交互丢失）。→ §6.1b

---

## 1. 假设声明

按项目规范先摊开假设。若任一条不成立，对应章节需重做。

| # | 假设 | 不成立时的影响 |
|---|---|---|
| A1 | 目标是**自用 / TestFlight 内测**可用版本，不追求 App Store 上架 | 见 §8，工作量与合规风险大幅上升 |
| A2 | 允许在 `src/` 内加平台分支与平台扩展文件，但**不重写业务逻辑** | 若要求零改动 src/，则必须给 fork 补齐 iOS 原生实现，工期 +50% |
| A3 | 具备 macOS + Xcode 15+ 环境，以及一个 Apple 开发者账号 | 无账号只能走 7 天自签，每周重签 |
| A4 | 首版允许功能降级：桌面歌词、本地音乐标签写入、应用内更新可缺失 | 若要求功能对等，桌面歌词一项即需重新设计交互（Live Activities） |

---

## 2. 取证结果：阻塞项五层总账

### 2.1 第一层：启动即崩（必须最先解决）

`src/app.ts:6` 在模块顶层就 `import { exitApp } from './utils/nativeModules/utils'`，而该文件第 3、5 行是：

```ts
const { UtilsModule } = NativeModules
export const exitApp = UtilsModule.exitApp   // iOS 上 UtilsModule === undefined → TypeError
```

这不是运行时报错，是**模块求值期 TypeError**，iOS 上 App 启动即白屏。codegraph 影响面：`exitApp` 触达 21 个符号，`nativeModules/utils` 被 15 个文件引用（另有 1 个 `.tsx.bak` 备份文件不计）。

### 2.2 第二层：5 个自研原生模块全无 iOS 实现

| 模块 | Java 规模 | `@ReactMethod` 数 | 缺失后果 | 处置 |
|---|---|---|---|---|
| UtilsModule | 7 文件 / 672 行 | 18 | 启动崩溃、Toast、屏幕常亮、窗口尺寸、WiFi IP、设备名 | **必须实现**（§3.1） |
| CryptoModule | 4 文件 / 375 行 | 9（**4 个同步**） | 网易云/酷我搜索、榜单、歌词、评论、数据同步全废 | **必须实现**（§3.2） |
| UserApiModule | 8 文件 / 541 行 | 5 | 自定义源全废 = App 无音源 | **必须实现**（§3.3） |
| CacheModule | 4 文件 / 208 行 | 2 | 设置页缓存管理 | 实现（简单，§3.4） |
| LyricModule | 9 文件 / 1942 行 | 22 | 桌面歌词 | **不实现**，桩化（§7） |

CryptoModule 的影响面被原分析报告低估了。实际调用链：

```
src/utils/musicSdk/wy/utils/crypto.js:3  →  被 8 个文件引用
  ├─ leaderboard.js   ├─ musicInfo.js   ├─ tipSearch.js   ├─ lyric.js
  ├─ comment.js       ├─ songList.js    ├─ musicSearch.js ├─ musicDetail.js
src/utils/musicSdk/kw/util.js:4,204,218
src/plugins/sync/utils.ts:2  +  src/plugins/sync/client/utils.ts:41
```

即 **搜索框输入一个字就会走 CryptoModule**，不只是数据同步。codegraph：`rsaEncrypt` 触达 13 个符号。

### 2.3 第三层：两个 fork 依赖根本没有 iOS 代码

用 GitHub Tree API 逐个核实（`node_modules` 未安装，故走远端）：

| 依赖 | 锁定 commit | `ios/` 目录 | podspec 声明 | 后果 |
|---|---|---|---|---|
| `react-native-file-system` | `fcb0e6f5` | **不存在** | `s.source_files = "ios/**/*.{h,m,mm}"` | pod install **静默通过**，运行时全部 undefined |
| `react-native-local-media-metadata` | `1b5be310` | **不存在** | 同上 | 同上 |
| `react-native-track-player` | `d4a062f7` | 存在（Swift） | 依赖 `SwiftAudioEx 0.14.7` | 部分可用，见 §4.3 |
| `react-native-background-timer` | `55ecaa80` | 存在 | — | 可用 |

`file-system` 是最痛的一项：`src/utils/fs.ts` 导出 27 个函数 + 1 个 `FileType` 类型，被 **23 个文件**引用，等于整个 App 的存储层。

### 2.4 第四层：iOS 工程配置为裸模板

`ios/` 仅 13 个文件，`git log --all -- ios/` 共 12 次提交**全部是 RN 升级带来的模板同步**，最后一次 `f3c79fe`（2023-12-07, RN 0.73.0）。人工改动只有 `AppDelegate.mm` 里的 RNN 接线：

```objc
RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
[ReactNativeNavigation bootstrapWithBridge:bridge];
```

缺失清单见 §5，其中 `UIBackgroundModes` 缺失 = **后台播放直接不工作**，是仅次于启动崩溃的第二优先项。

### 2.5 第五层：JS 层 Android 假设

全仓 `Platform.OS` 只出现 3 处（2 处已注释），但**不能据此认为 Android 假设面很窄** —— 真正的 Android 耦合藏在不带 `Platform.OS` 的 Android-only API 里（见下方 `StatusBar.currentHeight` 与 `useBackHandler`），grep `Platform.OS` 查不到它们。

主要集中在 `src/utils/tools.ts`：

| 位置 | Android 专有 API | iOS 处置 |
|---|---|---|
| tools.ts:107-136 | `ToastAndroid.showWithGravityAndOffset` | 需替换（§6.1） |
| tools.ts:149-151 | `BackHandler.exitApp()` | iOS 无此概念，桩化 |
| tools.ts:59-90 | `PermissionsAndroid` 存储权限 | iOS 沙箱内无需，直接 return true |
| tools.ts:29 | `Platform.constants.Release` | iOS 上是 `osVersion`，需分支 |
| tools.ts:244-331 | 通知权限 / 电池优化白名单 | 通知走 iOS 原生；电池优化 iOS 无此概念 |
| tools.ts:364-373 | `isSupportedAutoTheme` | **已有 iOS 分支**（`osVerNum >= 13`），逻辑正确；真正要改的是它依赖的 `osVer`（见上一行） |
| `ChoosePath/*`（族共 8 文件，4 个需改，见 §6.2） | SAF（`AndroidScoped.*`）、`Dirs.SDCardDir` | iOS 无 SAF，需换 UIDocumentPicker（§6.2） |
| version.js:77,122 | `getSupportedAbis` / `installApk` | iOS 不允许，功能整体关闭（§7） |

**两处不带 `Platform.OS` 的 Android-only API（原分析遗漏）**：

| 位置 | 问题 | iOS 处置 |
|---|---|---|
| `components/common/StatusBar.tsx:10`、`components/SizeView.tsx:12`、`utils/windowSizeTools.ts:51` | `StatusBar.currentHeight` 是 **Android-only**，iOS 上是 `undefined`，被 `?? 0` **静默吞成 0** | 不崩，但状态栏/刘海高度丢失，全局布局上移。需改用 `react-native-safe-area-context` 的 `useSafeAreaInsets()`，或从原生取 `windowScene.statusBarManager.statusBarFrame` |
| `utils/hooks/useBackHandler.ts`（整个 hook） | 建立在 Android 硬件返回键（`BackHandler`）之上，iOS 无此概念 | 桩化为空 hook；返回手势由 RNN 原生处理。需检查各调用方在 hook 失效后交互是否仍闭合 |

`StatusBar.currentHeight` 这条尤其要注意：它**不报错**，症状是全局布局错位，容易被误判成样式问题而查错方向。

---

## 3. 自研原生模块的 iOS 实现方案

### 3.1 UtilsModule（Objective-C / Swift，约 400 行）

Java 侧共 18 个 `@ReactMethod`，但**实际需要实现的只有 14 个**：其中 `addListener`/`removeListeners` 是 RN 事件管道的样板方法（iOS 侧由 `RCTEventEmitter` 基类提供，无需自己写），`onFullScreen`/`offFullScreen` 在 Java 里**已被整段注释**（`UtilsModule.java:309,324`），JS 侧 `nativeModules/utils.ts` 也无对应导出，全仓零调用点。

按必要性分三档：

**P0 — 不实现就崩或核心功能缺失**

| 方法 | iOS 实现 |
|---|---|
| `exitApp` | 桩化（iOS 不允许主动退出，`exit(0)` 会被审核拒且用户体验差）。返回 void 空实现即可解除 §2.1 崩溃 |
| `getWindowSize` | `UIScreen.main.bounds` × `scale`，配合 `traitCollectionDidChange` 发事件 |
| `onWindowSizeChange` 事件 | 监听 `UIApplication.didChangeStatusBarOrientationNotification` / `viewWillTransitionToSize` |
| `getSystemLocales` | `NSLocale.preferredLanguages.first` |
| `isNotificationsEnabled` | `UNUserNotificationCenter.getNotificationSettings` → `authorizationStatus == .authorized` |
| `openNotificationPermissionActivity` | `UNUserNotificationCenter.requestAuthorization`，被拒后 `UIApplication.openSettingsURLString` |

**P1 — 影响体验**

| 方法 | iOS 实现 |
|---|---|
| `screenkeepAwake` / `screenUnkeepAwake` | `UIApplication.shared.isIdleTimerDisabled = true/false`（必须在主线程）。调用点：`PlayDetail/Vertical/index.tsx:40,42`、`Horizontal/index.tsx:27,34` |
| `onScreenStateChange` 事件 | `UIApplication.protectedDataWillBecomeUnavailable`（锁屏）+ `didBecomeActive`。调用点 `core/init/player/playProgress.ts:180` |
| `shareText` | `UIActivityViewController`，需在主线程拿 `keyWindow.rootViewController` presenting |
| `getDeviceName` | `UIDevice.current.name`。调用点 `plugins/sync/client/auth.ts:49,77`（数据同步握手报文里带设备名，必须有值） |
| `getWIFIIPV4Address` | `getifaddrs()` 遍历 `en0`，取 `AF_INET`。调用点 `Setting/settings/Sync/IsEnable.tsx:81` |

**不实现 —— `onFullScreen` / `offFullScreen`**

Java 侧已注释、JS 侧无导出、零调用点。iOS 侧**不要实现**，等 Android 侧真正启用时再一并做。

**P2 — iOS 无对应概念，桩化**

`getSupportedAbis`（返回 `["arm64"]`）、`installApk`（reject）、`isIgnoringBatteryOptimization`（返回 true）、`requestIgnoreBatteryOptimization`（返回 true）。返回值需保证 `tools.ts:286-325` 的检查逻辑走"已启用"分支而不弹框。

### 3.2 CryptoModule（Objective-C + CommonCrypto/Security.framework，约 350 行）

**这是全案唯一需要逐字节对齐的模块**。Android 侧契约（`crypto/AES.java`、`crypto/RSA.java` 全文已读）：

```java
// AES.java:15-21 —— base64 的 flag 不对称！
decodeBase64: Base64.decode(data, Base64.DEFAULT)     // 解码宽松，接受换行
encodeBase64: Base64.encode(data, Base64.NO_WRAP)     // 编码不换行

// AES.java:28-31 —— IV 零填充到 16 字节（不足补 0，超长截断）
byte[] finalIvs = new byte[16];
System.arraycopy(iv, 0, finalIvs, 0, Math.min(iv.length, 16));

// AES.java:56-57 —— iv 为空串走无 IV 重载
return "".equals(iv) ? encrypt(data, key, mode) : encrypt(data, key, iv, mode);
```

模式映射（来自 `src/utils/nativeModules/crypto.ts`）：

| JS 常量 | Java 字符串 | iOS 实现 |
|---|---|---|
| `AES_MODE.CBC_128_PKCS7Padding` | `AES/CBC/PKCS7Padding` | `CCCrypt(kCCAlgorithmAES, kCCOptionPKCS7Padding)` + IV |
| `AES_MODE.ECB_128_NoPadding` | `AES` | `CCCrypt(kCCAlgorithmAES, kCCOptionECBMode \| kCCOptionPKCS7Padding)` ← 见下方警告 |
| `RSA_PADDING.OAEPWithSHA1AndMGF1Padding` | `RSA/ECB/OAEPWithSHA1AndMGF1Padding` | `SecKeyCreateEncryptedData(.rsaEncryptionOAEPSHA1)` |
| `RSA_PADDING.NoPadding` | `RSA/ECB/NoPadding` | `SecKeyCreateEncryptedData(.rsaEncryptionRaw)` |

> 🔴 **`ECB_128_NoPadding` 这个枚举名是骗人的，照名字实现必错。**
>
> 它的值是字符串 `'AES'`（`crypto.ts:24`），而 JCE 对不含 mode/padding 的算法名会**自动补全默认值**，`Cipher.getInstance("AES")` 实际等于 `AES/ECB/PKCS5Padding`，**不是 NoPadding**。本地 JDK 实测（16 字节明文）：
>
> ```
> getInstance("AES")       → 密文 32 字节  GPCa95xrIOxDlsMsDpByNezQXWhiZr5Twm3A6OhiJfg=
> AES/ECB/PKCS5Padding     → 密文 32 字节  GPCa95xrIOxDlsMsDpByNezQXWhiZr5Twm3A6OhiJfg=   ← 完全一致
> AES/ECB/NoPadding        → 密文 16 字节  GPCa95xrIOxDlsMsDpByNQ==                        ← 不一致
> 另：5 字节明文喂 "AES" 正常输出 16 字节，喂 NoPadding 抛 IllegalBlockSizeException
> ```
>
> PKCS5Padding 与 PKCS7Padding 在 AES（16 字节块）下字节级等价，所以 iOS 侧必须带 `kCCOptionPKCS7Padding`。
>
> 漏掉 padding 位的症状极其隐蔽：**不报错，密文长度看着也对，只是内容错**，且解密侧同样不报错。影响面是全 App 的主干请求：`wy/utils/crypto.js:43,54,59`（网易云 linuxapi/eapi/eapiDecrypt）、`kw/util.js:204,218`（酷我**全部**请求）、`plugins/sync/utils.ts:9,15`（数据同步）、`user-api-preload.js:359`（沙箱注入）。
>
> 另有两个陷阱：
> - `AES.java:13` 定义的 `AES_MODE_ECB_NoPadding = "AES/ECB/NoPadding"` 是**零引用死代码**（全项目 grep 仅命中定义本身），不要把它当有效契约来对齐。
> - `AES.encrypt` 返回 **base64 字符串**，而 `AES.decrypt` 返回 `new String(bytes, UTF_8)` 的**明文字符串**。返回类型不对称，iOS 侧必须逐一照抄，不能统一成一种。

RSA 密钥格式（`RSA.java:60-96`）：

- 生成：`KeyPairGenerator("RSA").initialize(2048)` → iOS `SecKeyCreateRandomKey`，`kSecAttrKeySizeInBits: 2048`
- 公钥：`X509EncodedKeySpec`（SPKI DER）→ iOS `SecKeyCreateWithData` 只吃**裸 PKCS#1 RSAPublicKey**，必须手工剥掉 SPKI 的 AlgorithmIdentifier 外层
- 私钥：`PKCS8EncodedKeySpec` → 同理需 PKCS#8 → PKCS#1 转换

> ⚠️ 这是最容易埋雷的一处。Java 的 `X509EncodedKeySpec`/`PKCS8EncodedKeySpec` 与 iOS Security.framework 的 DER 期望**不同层级**，直接把 base64 喂给 `SecKeyCreateWithData` 会返回 nil。需要写一小段 ASN.1 头处理（约 60 行）。

`crypto.ts` 还负责 PEM 头尾的拼接/剥离（`-----BEGIN PUBLIC KEY-----`），iOS 侧收到的已是裸 base64，无需重复处理。

**4 个同步方法必须用 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`**：`rsaEncryptSync`、`rsaDecryptSync`、`aesEncryptSync`、`aesDecryptSync`。

该宏的唯一硬性要求是**返回类型必须是 `id` 且可 JSON 序列化**（见 RN 源码 `RCTModuleMethod.mm`）。调用走 `nativeCallSyncHook` → `RCTNativeModule::callSerializableNativeHook` → `invokeInner(..., Sync)`，**绕过 methodQueue，直接在 JS 线程执行** —— 与 `requiresMainQueueSetup` 无关。

但仍**建议**把 `requiresMainQueueSetup` 显式返回 `NO`：若模块导出了 `constantsToExport` 或自定义 `init`，RN 会自动把它推断为 `YES`，此时首次同步调用会触发 `RCTUnsafeExecuteOnMainQueueSync` 并打出官方死锁警告。这是规避死锁的实践建议，不是宏的前提条件。

> ⚠️ 老架构下使用同步方法会导致 **Chrome / websocket 远程调试器不可用**（同步桥要求 JS 与原生同进程）。Phase 1 调试加密模块时只能靠日志与 Safari Web Inspector（Hermes），需提前有预期。

**验证方式**：

⚠️ 项目当前**没有任何可用的测试载体**，这是本方案实施前必须先补的空缺：

- `package.json` 无 `test` script，无 jest / vitest / mocha 依赖，全仓无测试文件
- `src/utils/nativeModules/cryptoTest.ts` 看着像测试，实际**全部调用都是注释**（行 49-54、63-68、70-75），零断言；且里面用的枚举名 `AES_MODE.CBC_PKCS7Padding` / `ECB_NoPadding` 已经失效（现行是 `CBC_128_PKCS7Padding` / `ECB_128_NoPadding`）；唯一引用点 `src/app.ts:53` 也是注释

因此 Phase 1 的第一步不是写 iOS 代码，而是**先把验证标准建起来**（见 Phase 1.0）。具体做法：

1. 在 Android 真机上跑一遍取证脚本，对每个 mode 记录 `(输入, key, iv) → 输出` 的**真实字节序列**，作为黄金基准（golden vector）落盘成 JSON
2. iOS 侧实现完成后，用同一份 JSON 逐条比对，要求**字节级完全一致**

黄金基准至少需覆盖：`CBC_128_PKCS7Padding` 有 IV / `ECB_128_NoPadding`（含非 16 字节对齐的明文，用于验证 padding）/ iv 为空串走无 IV 重载 / iv 不足 16 字节的零填充 / RSA 两种 padding 的加解密往返。

这比"跑通 cryptoTest.ts"可靠得多——后者根本没有断言可跑。

### 3.3 UserApiModule（JavaScriptCore，约 500 行）

#### 3.3.1 选型：JSC vs vendored QuickJS vs WKWebView

| 方案 | 语言特性 | 包体 | 沙箱隔离 | 同步桥 | 工期 | 结论 |
|---|---|---|---|---|---|---|
| **JavaScriptCore.framework** | ES2020+（iOS 13.4 够用） | 0（系统库） | JSContext 级隔离，globalThis 独立 | 原生同步 | 3-5 天 | ✅ **推荐** |
| vendored QuickJS | 与 Android 完全一致 | +800KB × arch | 进程内隔离 | 需自写 | 2-3 周 | ❌ 收益不抵成本 |
| 隐藏 WKWebView | Safari JS | 0 | 进程外，最强 | **不可能**（全异步） | 1-2 周 | ❌ 同步桥不可得 |

排除 QuickJS 的额外硬证据：CocoaPods trunk 上**没有**任何可用的现代 QuickJS pod（仅 `QuickJS-iOS` 0.0.1~0.0.4，2019 年停更）。Android 用的 `wang.harlon.quickjs:wrapper-android` 是纯 Android/JVM wrapper（上游 README 明写 "for Android/JVM"），无 iOS 产物。走 QuickJS 就意味着自己 vendored 编译 + 自写 JSValue↔ObjC 双向绑定，等于重做 wrapper 的活。

排除 WKWebView 的决定性理由：preload 脚本注入的 `__lx_native_call__utils_*` 系列**是同步返回**的（见下表 return 值），WKWebView 的 `evaluateJavaScript` 只有 completion handler，无法在 JS 表达式里同步取回结果。改成异步就要重写 preload 脚本，破坏与桌面版/Android 版的脚本兼容性——而脚本兼容性正是自定义源生态的全部价值。

**业界先例**：`flutter_js`（Flutter 重写版所用，见 [flutter-comparison.md](./flutter-comparison.md)）在 **Android 上用 QuickJS、iOS 上用 JavaScriptCore** —— 它不是"QuickJS 跑在 iOS"的先例，而是与本方案**完全相同的双引擎分裂**。一个成熟的跨端 JS 沙箱库主动选择了同样的分裂，说明这是业界常规做法，而非本项目的妥协。

代价也一并继承：引擎差异导致的脚本行为不一致（§3.3.4）是这条路线的固有风险，换任何现成库都躲不开，除非自己 vendored QuickJS（已在上表排除）。

#### 3.3.2 必须复刻的注入契约（来自 `userApi/QuickJS.java:55-130`）

7 个全局函数，签名与返回值必须逐一对齐：

| 注入名 | 参数 | 返回 | iOS 实现要点 |
|---|---|---|---|
| `__lx_native_call__` | `(key, action, ...args)` | void | key 校验失败静默丢弃 |
| `__lx_native_call__utils_str2b64` | `(str)` | base64 String | 与 Android `NO_WRAP` 一致 |
| `__lx_native_call__utils_b642buf` | `(b64)` | **JSON 数组字符串** | 注意不是 ArrayBuffer，是 `"[1,2,3]"` 形式，preload 侧再解析 |
| `__lx_native_call__utils_str2md5` | `(str)` | hex String | **先 `URLDecoder.decode` 再 MD5**，这个前置解码极易漏 |
| `__lx_native_call__utils_aes_encrypt` | `(buf, mode, key, iv)` | 复用 §3.2 | |
| `__lx_native_call__utils_rsa_encrypt` | `(buf, key)` | 复用 §3.2 | |
| `__lx_native_call__set_timeout` | `(key, id, timeout)` | void | 到期后反向调用 `__lx_native__(key, '__set_timeout__', id)` |

初始化时序（`QuickJS.java:133-145`）：

```
1. 创建 JSContext（iOS: JSContext + 独立 JSVirtualMachine）
2. 注入 console（Android 是 setConsole(new Console(eventHandler))，iOS 需手工建 console 对象，
   把 log/warn/error 转发到 RN 事件，否则 preload:593 的 console.log('Preload finished.') 直接抛错）
3. createEnvObj(ctx)
4. evaluate(preloadScript)        ← 从 iOS bundle 读 user-api-preload.js
5. globalObject.lx_setup(key, id, name, desc, version, author, homepage, rawScript)
```

反向通道：`callJS` → `__lx_native__(key, action, ...args)`，action 常量 `__set_timeout__`、`__run_error__`。key 为 `UUID.randomUUID()`（iOS: `NSUUID().uuidString`）。

#### 3.3.3 preload 脚本对 JSC 的兼容性核查（已逐项验证）

| 特性 | 用量 | JSC (iOS 13.4) |
|---|---|---|
| `Proxy` | 1（封禁 Function 构造器） | ✅ |
| `Object.getOwnPropertyDescriptors` | 2（freezeObjectProperty） | ✅ |
| `Promise` | 4 | ✅ |
| `Uint8Array` / `ArrayBuffer` | 6 / 2 | ✅ |
| `Map` / `Set` | 2 / 1 | ✅ |
| `TextDecoder` | 0（`preload:410` 已注释） | ❌ **不存在**，但当前无需 polyfill（见下） |
| `Reflect`/`BigInt`/`WeakRef`/`WeakMap`/`Symbol`/`async` | 0 | — |

`Proxy`、`getOwnPropertyDescriptors`（Safari 10）、`Promise`、`Map`、`Set`（Safari 8）、`Uint8Array`/`ArrayBuffer`（iOS 4.2）全部远早于 iOS 13.4 对应的 Safari 13.1，判定成立。

> 口径说明：上表用量为**去注释统计**（与 [rust-rewrite-analysis.md](./rust-rewrite-analysis.md) §4.3 一致）。若连同注释计数，`Promise` 为 6、`Uint8Array`/`ArrayBuffer` 为 9 —— 早期版本曾引用该口径，已统一。

> ⚠️ **`TextDecoder` 在裸 JSC 里是彻底不存在的**，不是"版本不够"。它实现在 WebCore（`Source/WebCore/dom/TextDecoder.idl`），不属于 JavaScriptCore runtime；独立 `JSContext` 拿不到它，RN 0.73.11 的 `InitializeCore.js` 也不 polyfill。查兼容性时看到的"Safari 10.1 支持"是浏览器环境数据，**不适用于本场景**。
>
> 当前 `preload:410` 已注释且旁边有替代路径，所以不影响。但要记住：**Android 的 QuickJS 同样没有 `TextDecoder`** —— 若将来第三方脚本用到它，两端会同时失败，不是 iOS 独有的坑。

安全加固机制在 JSC 上同样成立：

```js
// preload.js —— 三道防线，JSC 全支持
freezeObjectProperty(globalThis)
proxyFunctionConstructor = new Proxy(Function.prototype.constructor, {
  apply/construct → throw 'Dynamic code execution is not allowed.'
})
globalThis.Function = ...; globalThis.eval = ...   // 覆写
Function.prototype.toString → 伪装 '[native code]'
```

> ⚠️ 一处真实差异：JSC 的 `JSContext` 上 `eval` 无法被彻底移除（`JSEvaluateScript` 是宿主 API 层面的能力）。preload 的覆写只挡 JS 层调用，与 Android 上 QuickJS 的行为等价——即两端安全边界一致，不是 iOS 引入的新弱点。

`lx` 对象需保持 `version: '2.0.0'`、`env: 'mobile'`（**不是** Flutter 版仿真的 `'desktop'`），否则第三方脚本的分支判断会走错。

#### 3.3.4 剩余风险

preload 本身兼容，但**第三方混淆脚本**可能用到 QuickJS/JSC 行为差异（正则细节、`Error.stack` 格式、数值精度边界）。这是 JSC 路线唯一无法静态排除的风险。缓解：Phase 3 拿社区高频音源脚本做回归，失败案例逐个分析。

> ℹ️ **不要去补死循环中断能力** —— Android 侧同样没有。`wang.harlon.quickjs:wrapper-android` 本身不暴露 interrupt handler，两端都只靠协作式超时（`core/init/userApi/index.ts:57` 的 20 秒 `BackgroundTimer`）。所以 iOS 上 JSC 缺 `JSContextGroup` 级中断**不构成对等性缺口**，性质与 §3.3.1 末尾 `eval` 那条注记相同：是两端一致的既有边界，不是 iOS 引入的新弱点。花时间去啃 JSC 中断 API 等于补一个 Android 也没有的洞。

`src/core/init/userApi/index.ts:57` 的 20 秒请求超时用 `BackgroundTimer.setTimeout`，`react-native-background-timer` fork 有 iOS 实现，无需改动。

### 3.4 CacheModule（约 60 行）

只有 2 个方法。`getAppCacheSize` → 递归 `NSFileManager` 统计 `NSCachesDirectory` + `NSTemporaryDirectory` 字节数；`clearAppCache` → 遍历删除。注意 `cache.ts:5` 外层做了 `Math.trunc`，返回 double 即可。

---

## 4. fork 依赖的处置

### 4.1 处置原则

三个 fork 都在 `taoshihan1991`/`lyswhut` 名下，我们有两条路：**给 fork 补 iOS 实现** 或 **在 `src/` 层做平台替换**。选择依据是"被引用面 × 实现难度"。

| 依赖 | 被引用面 | 决策 |
|---|---|---|
| `react-native-file-system` | 23 文件 / 28 导出 | **在 `src/utils/fs.ts` 层替换**为 `react-native-fs`（已是直接依赖） |
| `react-native-local-media-metadata` | 1 文件（`localMediaMetadata.ts`） | **桩化 + 降级**，本地音乐仅读文件名 |
| `react-native-track-player` | 播放核心 | **补 4 个缺失方法**（§4.3） |

### 4.2 react-native-file-system → react-native-fs 适配层

关键洞察：`src/utils/fs.ts` 已经是一层完整的门面（facade），**23 个引用方全部只 import 这个门面**，从未直接 import `react-native-file-system`。这意味着替换成本被这层门面完全吸收——这是本方案能成立的重要结构性优势。

`react-native-fs` 2.20.0 已在 `package.json` 中（`fs.ts:1` 已 import，用于 `downloadFile`/`stopDownload`），iOS 支持完备。映射表：

| fs.ts 导出 | 当前实现 | iOS 替换 |
|---|---|---|
| `temporaryDirectoryPath` | `Dirs.CacheDir` | `RNFS.CachesDirectoryPath` |
| `privateStorageDirectoryPath` | `Dirs.DocumentDir` | `RNFS.DocumentDirectoryPath` |
| `externalStorageDirectoryPath` | `Dirs.SDCardDir` | `RNFS.DocumentDirectoryPath`（iOS 无外部存储概念） |
| `readDir` / `unlink` / `mkdir` / `stat` | `FileSystem.*` | `RNFS.*`，⚠️ **返回字段不全，需合成**，见下 |
| `readFile` / `writeFile` / `appendFile` | `FileSystem.*` | `RNFS.*`，encoding **仅支持 `'utf8'\|'ascii'\|'base64'`**，传其它值抛 `Invalid encoding type` |
| `hash` | `FileSystem.hash` | `RNFS.hash`（支持 md5/sha1/sha256…） |
| `moveFile` / `rename` / `existsFile` | `FileSystem.*` | `RNFS.moveFile` / `moveFile` / `exists` |
| `gzipFile` / `unGzipFile` / `gzipString` / `unGzipString` | `FileSystem.*` | ⚠️ **RNFS 无 gzip**，见下 |
| `selectManagedFolder` / `getManagedFolders` / `removeManagedFolder` / `getPersistedUriList` | `AndroidScoped.*`（SAF） | iOS 无 SAF，桩化（§6.2） |
| `selectFile` | `AndroidScoped.openDocument` | `UIDocumentPickerViewController`（§6.2） |
| `getExternalStoragePaths` | fork 专有 | 返回单元素数组 `[DocumentDirectoryPath]` |

#### 4.2.1 缺口一：`stat` / `readDir` 返回字段不全

fork 的 `stat()`/`readDir()` 返回值里有三个字段是 RNFS **不提供**的，适配层必须自己合成：

| 字段 | 消费点 | iOS 合成方式 |
|---|---|---|
| `mimeType` | `core/init/deeplink/index.ts:62`、`utils/localMediaMetadata.ts:19` | 按扩展名查表映射，或走 `UTType`（iOS 14+）/ `UTTypeCreatePreferredIdentifierForTag` |
| `name` | `MetadataEditModal/MetadataForm.tsx:54`、`core/music/local.ts:38` | 从 `path` 取 basename |
| `canRead` | `ChoosePath/components/Header.tsx:37`、`OpenStorageModal.tsx:93` | 沙箱内恒为 `true`；沙箱外用 `FileManager.isReadableFile` |

fork 还 `export type { FileType }`（`fs.ts:14`），被 `ChoosePath/listAction.ts:10,95`、`deeplink/fileAction.ts:4,13,21,30` 共 6 处消费，适配层需自己声明这个类型。

> 🔴 **`stat().name` 是最坏的一种陷阱**：RNFS 的 `index.d.ts` **声明了** `name?: string`，但 JS 包装实际不返回它（源码注释自承 "TODO: why is this not documented?"）。**TypeScript 编译通过，运行时是 `undefined`**。`originalFilepath` 同理 —— Android-only，iOS 上恒为 undefined。
>
> `readDir()` 的项**有** `name` 但**没有** `mimeType`。两个方法字段集不同，适配层要分别处理，不能共用一个转换函数。

#### 4.2.2 缺口二：gzip

`react-native-fs` 完全没有 gzip 能力。影响面比"备份恢复"更宽，是**两类场景**：

| 场景 | 调用点 | 数据特征 |
|---|---|---|
| 歌单/配置备份与恢复 | `tools.ts:158` `gzipFile`、`tools.ts:168` `unGzipFile` | 大文件（可达数十 MB），走文件路径 |
| **数据同步报文** | `plugins/sync/client/utils.ts:74` `'cg_' + gzipString(msg)`、`:82` `unGzipString(...)` | 小字符串，走内存 |

原分析只提了备份恢复，漏了数据同步——后者一旦压缩格式不对，**同步功能整体失效**。

> 🔴 **不要用 `Compression.framework` 的 `COMPRESSION_ZLIB`。** Apple 官方文档明确：它输出的是 **raw DEFLATE（RFC 1951）**，既不是 zlib 包装也不是 gzip，编码器还固定 level 5。文档自己给出的等价配置是 `deflateInit2(..., -15, ...)`，负 windowBits 即"无包装"。
>
> 直接拿它的输出去喂 Android 的 `GZIPInputStream` **会失败**，且 Android 侧 `GZIPOutputStream` 的产物它也读不了。这条路要走通就得手工拼 10 字节 gzip header + CRC32/ISIZE footer，比想象的脏。

按场景分别处理：

**大文件（`gzipFile` / `unGzipFile`）→ 原生 libz。** iOS 自带可链接的 libz（`INSTALL_PATH=/usr/lib`，有 `zlib.modulemap`），podspec 加 `s.libraries = 'z'` 即可。关键是 windowBits 必须给 **31**（`deflateInit2(..., 31, 8, ...)` / `inflateInit2(..., 47)`）才输出真 gzip，可参考 `nicklockwood/GZIP` 的实现。约 80 行。

**小字符串（`gzipString` / `unGzipString`）→ 直接用 `pako`。** `package.json:56` 已依赖 `pako ^2.1.0`，且已在三处生产使用（`utils/request.js:6` 的 `deflateRaw`、`musicSdk/kw/decodeLyric.js:1` 的 `inflate`、`musicSdk/kg/util.js:1,14`）。`pako.gzip()` 直接产真 gzip，**零原生代码**。同步报文数据量小，JS 侧压缩不会卡 UI。

> ℹ️ 一段值得知道的历史：`tools.ts:155` 还留着 `// const buffer = gzip(data)` 的注释，说明项目当年就是**从 pako 迁到原生 gzip 的**，`handleSaveFile` 改走临时文件 + `gzipFile` 正是为了避开大文件在 JS 侧的内存压缩。所以"iOS 全用 pako"看似省事，会撞上当年迁走的同一个问题——**大文件必须走原生**，这条分场景的处置正是为了兼顾两头。

第三个选项——iOS 上改存未压缩——**不可取**，会破坏与 Android/桌面版的备份文件互通，这是洛雪生态的基本约定。

#### 4.2.3 实现形式

给 `fs.ts` 加平台后缀分文件（`fs.android.ts` / `fs.ios.ts`），共享同一份类型定义。Metro 自动按平台解析，23 个引用方零改动。

> ⚠️ 两点前置确认：
> - 项目**没有平台后缀文件的先例**，`tsconfig.json` 也未配置 `moduleSuffixes`。Metro 能正确解析，但 **TypeScript 类型检查**需要额外配置（`moduleSuffixes`，TS 4.7+）才能识别 `.ios.ts`/`.android.ts` 的对应关系，否则 `tsc` 会报找不到模块。落地前先验证 `npm run lint` / `tsc --noEmit` 通过。
> - 另一种规避写法：保留单个 `fs.ts`，内部用 `Platform.OS` 分支 + 动态 require。牺牲一点可读性，换掉整个平台后缀的工具链风险。文件不大（27 个导出），这个方案也可接受。

### 4.3 react-native-track-player：iOS 侧存在但落后

fork `d4a062f7`（v2.1.2）确实有 `ios/`（`RNTrackPlayer.swift`、`RNTrackPlayerBridge.m`、`Vendor/SwiftAudio`），podspec 依赖 `SwiftAudioEx 0.14.7`（已确认 CocoaPods trunk 上存在）。但：

**问题 1：iOS 桥 30 个方法 vs Android 33 个，缺 4 个正在被调用的方法**

| 缺失方法 | 调用点 | 影响 |
|---|---|---|
| `clearCache` | `plugins/player/utils.ts:171-181`、`Setting/.../ResourceCache.tsx:25,41` | 设置页清缓存 |
| `getCacheSize` | `ResourceCache.tsx:10` | 设置页显示缓存大小 |
| `isCached` | `core/init/player/preloadNextMusic.ts:5,28` | 预加载判断 |
| `updateNowPlayingTitles` | `core/init/player/lyric.ts:5,12,14` | 锁屏歌词逐行更新 |

前三个是缓存相关，SwiftAudioEx 无内建磁盘缓存，需要自己实现或降级；第四个是锁屏歌词，`MPNowPlayingInfoCenter` 直接可做，约 30 行。

**问题 2：`setupPlayer` 的 4 个参数在 iOS 被静默忽略**

`src/plugins/player/index.ts:29-40` 传入：

```ts
await TrackPlayer.setupPlayer({
  maxCacheSize: cacheSize * 1024,   // ← iOS 忽略
  maxBuffer: 1000,                  // ← iOS 忽略
  waitForBuffer: true,              // ✅ iOS 读取
  handleAudioFocus: isHandleAudioFocus,  // ← iOS 忽略（Android AudioFocus 概念）
  audioOffload: isEnableAudioOffload,    // ← iOS 忽略
  autoUpdateMetadata: false,        // ✅ iOS 读取
})
```

`RNTrackPlayer.swift:154` 只读 `waitForBuffer`/`minBuffer`/`autoUpdateMetadata`/`iosCategory`/`iosCategoryOptions`/`iosCategoryMode`。**iOS 需要额外传 `iosCategory: 'playback'` 才能后台出声**，这是当前代码完全没有的参数。

**问题 3：`updateOptions` 的通知栏配置是 Android-only**

`plugins/player/utils.ts:245-285` 的 `notificationCapabilities`、`compactCapabilities` 在 iOS 无效。iOS 锁屏控制通过 `MPRemoteCommandCenter`，由 `capabilities` 字段驱动。

**问题 4：iOS 侧代码 3 年多未动**（最后修改 2022-03-04），与 RN 0.73 的兼容性未经验证。

**处置**：Phase 2 先验证能否 build + 出声。若 SwiftAudioEx 在 RN 0.73 下有兼容问题，备选是切到上游 `react-native-track-player` 4.x（iOS 侧活跃维护），代价是 fork 的 Android 定制功能（缓存、audioOffload）需要重新对齐——工期 +1 周，故列为备选而非首选。

### 4.4 其余依赖：全部原生支持 iOS，无需处理

`@d11/react-native-fast-image` 8.13.0、`react-native-pager-view`、`@react-native-community/slider`、`react-native-vector-icons`、`@react-native-clipboard/clipboard`、`@react-native-async-storage/async-storage`、`react-native-exception-handler`、`react-native-quick-md5`、`react-native-quick-base64`、`@craftzdog/react-native-buffer`、`lrc-file-parser`、`react-native-navigation` 7.39.2。

`react-native-navigation` 值得单独提一句：它是 Wix 的原生导航库，iOS 支持是它的第一等公民（比 Android 更成熟）。`AppDelegate.mm` 里的 bootstrap 接线已经写好，这块是现成的。

**当前版本组合有官方明文背书。** RNN 安装文档（8.x 各版本页面一致）写道：

> new architecture enabled (if you are not using the new architecture, you can still use **react-native-navigation of version 7.x.x with react-native 0.73 and lower**)

本项目正是老架构 + RN 0.73.11 + RNN 7.39.2，精确落在这句话描述的窗口内。

> 🔴 **不要升级 RNN。** 7.x 内部并非全部对齐 RN 0.73 —— devDependencies 在版本间跳变过（7.45.0 对应 RN 0.76.6，7.49.0 又回到 0.73.3），`7.42.0` 与 `7.44.0–7.45.0` 是 RN 0.73 老架构的危险区。iOS 适配期间如果为了修某个问题顺手升 RNN，很可能撞上老架构断裂，且症状会表现为难以定位的原生崩溃。**锁死 7.39.2。**
>
> 另一个查证时的坑：RNN 的 git tag 有 off-by-one —— tag `7.39.2` 里的 package.json 写的是 `7.39.1`，npm 上的 7.39.2 对应 git tag `7.40.0`。读源码核对行为时容易看错版本。

---

## 5. iOS 工程配置清单

### 5.1 Info.plist

当前是裸模板，需要的改动（`ios/LxMusicMobile/Info.plist`）：

```xml
<!-- 【P0】后台播放。不加这条，App 切后台立即静音 -->
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>

<!-- 【P0】明文 HTTP。Android 侧 network_security_config.xml 是
     <base-config cleartextTrafficPermitted="true" /> 全量放行，
     大量音源直链是 http，iOS 默认 ATS 会全部拦掉 -->
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>              <!-- 当前是 false，必须改 true -->
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>

<!-- 【P0】深链。对应 AndroidManifest.xml:34-91 的 lxmusic:// scheme -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>cn.toside.music.mobile</string>
    <key>CFBundleURLSchemes</key>
    <array><string>lxmusic</string></array>
  </dict>
</array>

<!-- 【P1】图标字体。Android 放 assets/fonts/，iOS 必须显式声明 -->
<key>UIAppFonts</key>
<array><string>icomoon.ttf</string></array>

<!-- 【P1】"用其他应用打开" 接收 .lxmc / .js / 音频文件 -->
<key>CFBundleDocumentTypes</key>
<array>
  <dict>
    <key>CFBundleTypeName</key><string>LX Music Config</string>
    <key>LSItemContentTypes</key>
    <array><string>public.json</string><string>cn.toside.music.lxmc</string></array>
    <key>LSHandlerRank</key><string>Owner</string>
  </dict>
  <dict>
    <!-- 自定义源脚本。Android 侧 Manifest:67-78 明确接收 .js（text/javascript
         + pathPattern ".*\\.js"），这一项不能漏，否则 iOS 无法从"文件"App 导入音源 -->
    <key>CFBundleTypeName</key><string>LX Music Source Script</string>
    <key>LSItemContentTypes</key>
    <array><string>com.netscape.javascript-source</string></array>
    <key>LSHandlerRank</key><string>Owner</string>
  </dict>
  <dict>
    <key>CFBundleTypeName</key><string>Audio</string>
    <key>LSItemContentTypes</key><array><string>public.audio</string></array>
    <key>LSHandlerRank</key><string>Alternate</string>
  </dict>
</array>
<!-- .lxmc 是自定义扩展名，需配套 UTExportedTypeDeclarations 声明 UTI -->
<!-- .js 用系统内建 UTI com.netscape.javascript-source，无需自己声明 -->

<!-- 【P1】iTunes 文件共享，便于导入歌单/脚本（替代 Android 的文件管理器路径选择） -->
<key>UIFileSharingEnabled</key><true/>
<key>LSSupportsOpeningDocumentsInPlace</key><true/>

<!-- 【P2】清理模板残留 -->
<!-- NSLocationWhenInUseUsageDescription 当前是空串，项目不用定位，直接删除该 key -->
<!-- UIRequiredDeviceCapabilities 当前是 [armv7]，应改为 [arm64] -->
```

### 5.2 Podfile

```ruby
# 【P0】关闭 Flipper。当前是 ENV['NO_FLIPPER'] == "1" ? disabled : enabled（默认开启），
# Flipper 在 RN 0.73 + Xcode 15 上是经典编译失败源，且 release 不需要
flipper_config = FlipperConfiguration.disabled

# 【P1】新增：处理 Xcode 15 的 -ld_classic 链接器问题（RN 0.73 已知问题）
post_install do |installer|
  react_native_post_install(installer, config[:reactNativePath], :mac_catalyst_enabled => false)
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |cfg|
      cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '13.4'
    end
  end
end
```

### 5.3 project.pbxproj / Xcode 设置

| 项 | 当前 | 目标 |
|---|---|---|
| `PRODUCT_BUNDLE_IDENTIFIER` | `org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)` | `cn.toside.music.mobile` |
| `MARKETING_VERSION` | `1.0` | 与 `package.json` version 对齐（1.8.1） |
| `CURRENT_PROJECT_VERSION` | `1` | 与 Android versionCode 对齐 |
| `IPHONEOS_DEPLOYMENT_TARGET` | 13.4 | 保持（JSC 特性、SwiftAudioEx 均满足） |
| Display Name | `LxMusicMobile` | `洛雪音乐助手`（`app.json` displayName） |
| Capabilities | — | 勾选 Background Modes → Audio |
| 资源 | — | 把 `src/resources/fonts/icomoon.ttf` 加入 Copy Bundle Resources |
| 资源 | — | 把 `android/app/src/main/assets/script/user-api-preload.js` 加入 bundle（§3.3.2 步骤 4 要读它）|

> `user-api-preload.js` 的位置需要决策：留在 `android/` 下让 iOS 跨目录引用很脏。建议移到 `assets/script/user-api-preload.js`（仓库根），两端都从那里取，Android 侧 gradle 加一条 sourceSets assets 映射。这是本方案唯一涉及 Android 侧的改动，且是纯路径调整。

### 5.4 AppDelegate.mm

补深链入口（当前完全缺失，导致 §6.3 的 deeplink 在 iOS 上永不触发）：

```objc
#import <React/RCTLinkingManager.h>

- (BOOL)application:(UIApplication *)app openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  return [RCTLinkingManager application:app openURL:url options:options];
}

- (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)userActivity
 restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> *))restorationHandler {
  return [RCTLinkingManager application:application continueUserActivity:userActivity
                    restorationHandler:restorationHandler];
}
```

同时需在 `didFinishLaunchingWithOptions` 里配置 `AVAudioSession`：

```objc
[[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback
                                       mode:AVAudioSessionModeDefault
                                    options:0 error:nil];
```

（或改为在 JS 侧 `setupPlayer` 传 `iosCategory: 'playback'`，二者取一，推荐后者以保持配置在 JS 层可见）

**RNN 接线的三个易漏项**（当前 `AppDelegate.mm` 已有 `bootstrapWithBridge`，但以下几点需一并确认）：

1. **`didFinishLaunchingWithOptions` 必须调用 `[super application:application didFinishLaunchingWithOptions:launchOptions]`** —— `RNNAppDelegate` 的父类实现里才会创建 bridge 并完成 bootstrap。漏掉它的症状是启动后白屏、无任何报错。
2. **需自己实现 `sourceURLForBridge:`** —— 区分 Debug（Metro）与 Release（`main.jsbundle`）：
   ```objc
   - (NSURL *)sourceURLForBridge:(RCTBridge *)bridge {
   #if DEBUG
     return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
   #else
     return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
   #endif
   }
   ```
3. **Podfile 需保留 `use_native_modules!`，并确认能拉到 `HMSegmentedControl`** —— 这是 RNN podspec 声明的依赖，`platform :ios` 需 11.0 起（本项目 13.4，满足）。

> ⚠️ **RNN 官方 7.x 安装文档仍在讲旧的 `bootstrapWithDelegate:` 写法，与仓库内 playground 的实际代码已不一致。** 照文档写会踩空，**以 playground 示例为准**。

JS 侧对应要求：必须用 `Navigation.registerAppLaunchedListener()` + `Navigation.setRoot()` 的组合（项目现有代码已是这个模式，无需改动）。

---

## 6. JS 层改造清单

改造原则：**优先用平台后缀文件（`.ios.ts`），其次用 `Platform.OS` 分支，禁止改动业务逻辑**。平台后缀能让引用方零改动，这是最小侵入的做法。

### 6.1 src/utils/tools.ts

两处必改：

```ts
// tools.ts:107-136 toast —— ToastAndroid 在 iOS 不存在
// 方案：抽出 toast 实现为 toast.android.ts / toast.ios.ts
// iOS 侧用一个轻量自绘 Toast 组件（项目已有完整主题体系，约 60 行）
// 不引第三方库：新增依赖的收益不抵审查成本

// tools.ts:29 —— Platform.constants.Release 是 Android-only
export const osVer = (Platform.OS === 'android'
  ? (Platform.constants as any).Release
  : Platform.Version) as string
// osVer 的消费方需核查：若有版本号数值比较，Android 是 "13"，iOS 是 "17.0"，格式不同

```

> ℹ️ **`getIsSupportedAutoTheme`（`tools.ts:364-373`）不需要改。** 它已经有 iOS 分支：
>
> ```ts
> isSupportedAutoTheme = isAndroid ? osVerNum >= 5 : osVerNum >= 13
> ```
>
> `isAndroid` 在此处只是选择版本阈值，不是"iOS 一律返回 false"。修好上面的 `osVer` 之后这个函数自然正确 —— 但**必须注意 `parseInt` 的行为**：iOS 的 `Platform.Version` 是 `"17.0"` 这类字符串，`parseInt("17.0")` 得 17，判断成立；Android 的 `Release` 是 `"13"`，得 13。两边都能用，无需额外分支。
>
> 顺带一提：`isAndroid` 在全仓的业务使用点**只有 `tools.ts:368` 这一处**，改 `osVer` 就覆盖了全部影响面。

两处桩化即可（保持签名，返回让上层走"已授权"分支的值）：

```ts
// tools.ts:59, 61-90 存储权限 —— iOS 应用沙箱内读写无需授权
checkStoragePermissions  → async () => true
requestStoragePermission → async () => true

// tools.ts:149-151 exitApp —— iOS 无 BackHandler，且不应主动退出
exitApp → () => {}
```

`tools.ts:244-331` 的通知权限与电池优化检查：`isNotificationsEnabled`/`requestNotificationPermission` 走 §3.1 的 iOS 实现；`isIgnoringBatteryOptimization` 返回 `true` 让 `checkIgnoringBatteryOptimization` 在第 4 行 `if (enabled) return` 直接退出，不弹无意义的弹窗。

### 6.1b StatusBar 高度与返回键（原分析遗漏）

这两处不含 `Platform.OS`，grep 查不到，但都是实打实的 Android 耦合。

**`StatusBar.currentHeight` —— 三处，静默失效**

```ts
// components/common/StatusBar.tsx:10
// components/SizeView.tsx:12
// utils/windowSizeTools.ts:51
StatusBar.currentHeight ?? 0     // iOS 上 currentHeight 是 undefined → 恒取 0
```

`currentHeight` 是 Android-only 属性。iOS 上 `?? 0` 把它静默吞成 0，**不报错**，症状是状态栏与刘海区域高度丢失、全局布局上移、内容被灵动岛遮挡。

处置：改用 `react-native-safe-area-context` 的 `useSafeAreaInsets().top`（该库已随 RNN 生态存在，需确认是否在依赖内），或在 UtilsModule 加一个方法返回 `windowScene.statusBarManager.statusBarFrame.height`。`windowSizeTools.ts:51` 不在组件内、拿不到 hook，倾向后者以保持三处实现一致。

已落地（2026-08-31，`add-ios-support` 任务 9.2）：未引入新依赖，改为平台扩展 `src/utils/statusbarHeight.ios.ts`，经 RN 自带 `StatusBarManager.getHeight` 读 `statusBarFrame` 真实高度；`SizeView` 是唯一消费点，Android 语义走基名文件保持不变。真机复测待做（iPhone 17 Pro / iOS 26.6）。

**`utils/hooks/useBackHandler.ts` —— 整个 hook 无对应概念**

该 hook 完全建立在 `BackHandler`（Android 硬件返回键）之上。iOS 桩化为空 hook 即可，返回操作由 RNN 的原生手势/导航栏承担。

但要逐个检查调用方：**原本靠拦截返回键才能关闭的 UI（Modal、抽屉、多级选择器），在 iOS 上会失去关闭路径**。若某处只有返回键一条出路，需补一个可见的关闭按钮。这是功能性缺口，不只是桩化。

### 6.2 ChoosePath 组件族（族共 8 个文件，需改 4 个）

这是改动最集中的 UI 部分，因为它整个建立在 Android SAF 之上：

| 文件 | Android 依赖 | iOS 处置 |
|---|---|---|
| `ChoosePath/List.tsx:111` | `readDir(externalStorageDirectoryPath)` 浏览 SD 卡 | iOS 只能浏览 App 沙箱，根改为 `DocumentDirectoryPath` |
| `ChoosePath/index.tsx:65` | `selectFile()` → `AndroidScoped.openDocument` | `UIDocumentPickerViewController`（需在 UtilsModule 加一个方法，返回拷贝到沙箱后的路径） |
| `ChoosePath/components/OpenStorageModal.tsx` | SAF 持久化授权管理 UI（`getManagedFolders`/`removeManagedFolder`/`selectManagedFolder`） | **整个 Modal 在 iOS 隐藏**，无对应概念 |
| `ChoosePath/components/Header.tsx:34` | `getExternalStoragePaths()` 多存储卷切换 | iOS 单一沙箱，隐藏切换器 |

`src/core/common.ts:98,106` 也依赖 `getPersistedUriList`/`selectManagedFolder`，需一并处理（iOS 上 `checkManagedFolderPermission` 恒返回 true）。

### 6.3 深链适配

`src/core/init/deeplink/index.ts` 的逻辑本身是跨平台的（`Linking.addEventListener` + `getInitialURL`），无需改动。但两处需注意：

```ts
// deeplink/index.ts:80 —— content:// 是 Android SAF 的 URI scheme
} else if (link.startsWith('file://') || link.startsWith('content://')) {
// iOS 的文件打开传入的是 file:// 或 UIDocumentPicker 的安全域 URL，
// 前者已覆盖；无需加 content:// 分支，但需确认 §5.1 的 CFBundleDocumentTypes
// 触发时 RN 收到的 URL 形式（实测确认）

// deeplink/index.ts:45 handleFileAction 用 stat(link) 取文件名
// iOS 上 file:// 前缀需剥离才能给 RNFS.stat，在 fs.ios.ts 里统一处理
```

### 6.4 播放器配置

`src/plugins/player/index.ts:29-40`，加 iOS 参数（不删 Android 参数，它们在 iOS 侧被安全忽略）：

```ts
await TrackPlayer.setupPlayer({
  maxCacheSize: cacheSize * 1024,
  maxBuffer: 1000,
  waitForBuffer: true,
  handleAudioFocus: isHandleAudioFocus,
  audioOffload: isEnableAudioOffload,
  autoUpdateMetadata: false,
  // 新增 —— iOS 后台播放的必要条件
  iosCategory: 'playback',
  iosCategoryMode: 'default',
  iosCategoryOptions: [],
})
```

### 6.5 本地音乐功能降级

`src/utils/localMediaMetadata.ts` 依赖 `react-native-local-media-metadata`（无 iOS 实现）。首版降级策略：

- `readMetadata` → 返回仅含文件名的对象（`scanAudioFiles` 逻辑本身在 `fs` 上，可用）
- `writeMetadata` / `writePic` / `writeLyric` → reject with "iOS 暂不支持"
- `readPic` / `readLyric` → 返回 null

若后续要补齐，iOS 侧可用 `AVAsset.commonMetadata` 读（约 150 行），但写标签需要引入第三方库（如 SFBAudioEngine），成本明显高于收益，列为 Phase 5 可选项。

### 6.6 应用内更新关闭

`src/utils/version.js:77,122` 用 `getSupportedAbis` + `installApk` 下载安装 APK。iOS 平台不允许（App Store 审核指南 2.5.2 明文禁止下载执行改变功能的代码）。处置：iOS 上把更新检查改为"发现新版本 → 打开 GitHub Release 页面"，`version.js` 加平台分支或提供 `version.ios.js`。

---

## 7. 桌面歌词：不实现，及其理由

LyricModule 是 5 个模块里代码量最大的（9 文件 / 1942 行），实现依赖 Android 的 `SYSTEM_ALERT_WINDOW` 权限 + `WindowManager.TYPE_APPLICATION_OVERLAY`。**iOS 在系统层面不存在这个能力**，任何 App 都无法在其他 App 之上绘制悬浮窗。这不是工程难度问题，是平台约束。

`src/utils/nativeModules/lyricDesktop.ts` 导出 23 个函数，被 `core/desktopLyric.ts` 和 `core/common.ts` 引用。处置：

**首版**：提供 `lyricDesktop.ios.ts` 全桩化（`showDesktopLyricView` reject，其余 resolve void），设置页隐藏"桌面歌词"整个分组。这是最小改动，且不留半成品 UI。

**Phase 5 可选替代**（iOS 上最接近的体验）：

| 替代方案 | 覆盖场景 | 工作量 |
|---|---|---|
| 锁屏歌词（`MPNowPlayingInfoCenter` 更新标题行） | 锁屏 / 控制中心 | 小，见 §4.3 的 `updateNowPlayingTitles` |
| Live Activities（ActivityKit，iOS 16.1+） | 灵动岛 + 锁屏卡片 | 中，需新建 Widget Extension |
| 画中画滚动歌词 | App 切后台仍可见 | 大，且苹果对非视频用途的 PiP 审核态度不明 |

推荐锁屏歌词优先——它复用了 `core/init/player/lyric.ts` 已有的逐行回调，只需补 track-player 的 `updateNowPlayingTitles` iOS 实现。Live Activities 体验最好但属于新增功能而非移植，不应挤占首版工期。

---

## 8. 分发路径与合规

### 8.1 三条分发路径对比

**TestFlight 必须拆成内部/外部两条路径看** —— 二者的审核要求完全不同，这是本节最关键的分界。

| 路径 | 前提 | 有效期 | 用户规模 | 审核 |
|---|---|---|---|---|
| **自签（免费 Apple ID）** | 免费 Apple ID | **7 天**（官方明文） | 最多 3 台设备 | 无 |
| **自签（付费账号）** | $99/年 | 见下方说明 | 100 台/产品家族/会员年 | 无 |
| **TestFlight 内部测试** | $99/年 | 90 天/构建 | **≤100 人**，需团队角色 | **推定免审**（见下） |
| **TestFlight 外部测试 / 公开链接** | $99/年 | 90 天/构建 | ≤10,000 | **需首个 build 过审** |
| **App Store 正式上架** | $99/年 | 长期 | 无限 | 严格 |

各项的官方依据与限制细节：

**90 天/构建** —— 官方明文，且对内部测试**同样适用**："Internal testers can download and test all builds for 90 days"，从开发者上传当天起算。（注意：`developer.apple.com/testflight/` 那个营销页**没有**写这个数字，查文档时要看 App Store Connect Help。）

**免费 Apple ID 的限制**（《Developer account overview》逐字）：最多注册 **10 个 App ID**、**3 台设备**、每设备 **3 个 app**，provisioning profile **签发后 7 天过期**。常见误解要避开：**不是"每 7 天 10 个 App ID"**，而是"同时最多 10 个，各自 7 天后过期"。设备数按平台分别计。Xcode 16/17/26/27 与 iOS 18/19/26 均未改变这些数字。

**付费账号的设备限制**：每**产品家族**、每**会员年** 100 台。新会员年可清空恢复配额，但年中 disable 设备**不释放**名额。

> ⚠️ 表格里没写付费账号的 profile 有效期 —— 常见说法是"1 年"，但 Apple 官方 provisioning profile 文档**只说过期后需 regenerate，不给具体时长**。这属社区经验，不作为方案依据。实际以 Xcode 中显示的 profile 到期日为准。

**内部测试 ≤100 人的实际门槛**：内部测试者必须在 App Store Connect 里持有 **Account Holder / Admin / App Manager / Developer / Marketing** 角色，也就是**得加入开发团队**，不是随便拉人就能测。每人最多 30 台设备。

**外部测试的审核与节流**：首个 build 必须过 TestFlight App Review（旧称 Beta App Review）。同一版本**同时只能 1 个 build 在审**，**24 小时内最多提交 6 个 build**。后续 build 可能免全量复审。

**公开链接的可控性比想象的差**：Tester Limit 可设 1–10,000、可随时关闭、可按设备/平台/OS 版本筛选，但 Apple 明文承认 "anyone can share this link, so testers could potentially join your testing group even if you do not invite them directly"；经链接加入者显示为 **anonymous**，只能看到安装日期/会话/崩溃。建外部组前还必须先建内部组。

> ℹ️ **10,000 这个上限没有被提高过。** 它来自 2017-07-31 的公告（此前是 2,000）。逐条核对了 App Store Connect / TestFlight 2025 全年至 2026-08 的 release notes 与 developer news，无任何上限调整。
>
> **2025/2026 的 TestFlight 变化均非机制性**：4.0（2025-10-06）Liquid Glass 改版、4.2（2026-04-30）新增 11 种语言、4.3（2026-07-21）新增搜索框。客户端要求 iOS 16+。有个插曲：4.0 里出现过 "Tester Matching"（按兴趣推荐 App）的字串，次日 4.0.1 就移除了全部引用，Apple 从未公告 —— 也就是**截至 2026-08 没有官方 TestFlight 公开榜单/discovery 机制**，本项目不必担心被动曝光。
>
> **年费 99 USD 无涨价**。人民币金额**无法从任何 Apple 官方页面核实**（中文页只写"年会费 99 美元"，注册时按当地货币列出），社区流传的 ¥688 仅见于 2021–2023 第三方博客，不可作为现价。
>
> **费用豁免这条路走不通**：Apple 的年费豁免要求申请方是**非营利组织 / 认证教育机构 / 政府实体的法人**，明确**排除个人与单人企业**，且不得签 Paid Applications Agreement、不售任何数字商品服务。纯开源项目本身不构成豁免资格。99 USD 是硬成本。

### 8.2 App Store 上架的合规判断

查阅了当前审核指南原文，三条条款直接相关：

**2.5.2** —— "may not download, install, or execute code which introduces or changes features or functionality of the app"

自定义源机制正是下载并执行改变 App 功能的 JS 代码。这条是**直接命中**。

**4.7** 给出了一个例外口子：允许 "HTML5 and JavaScript mini apps and mini games, streaming games, chatbots, and plug-ins"，但附带 4.7.1~4.7.5 五项额外义务，其中：

- 4.7.2 "Your app may not extend or expose native platform APIs or technologies to the software without prior permission from Apple" —— userApi 沙箱恰恰向脚本暴露了 `aes_encrypt`/`rsa_encrypt`/`request` 等原生能力，**需要苹果事先许可**
- 4.7.4 要求提供"an index of software... include universal links that lead to all of the software offered" —— 自定义源脚本是用户自行导入的，不存在可提交的索引

**5.2.2 / 5.2.3** —— "should not facilitate illegal file sharing or include the ability to save, convert, or download media from third-party sources... without explicit authorization from those sources. Authorization must be provided upon request."

App 的核心功能是从网易云/QQ音乐/酷狗/酷我等第三方获取并下载音乐。"Authorization must be provided upon request" 意味着苹果可以随时要求出示授权文件，而这类授权不可能取得。

**结论：不建议尝试 App Store 上架。** 这也与项目官方立场一致（[ios-analysis.md](./ios-analysis.md) 记录了官方明确表示不做 iOS 版）。

### 8.3 推荐路径

**自用 / 小圈子分发**，按此优先级：

1. **TestFlight 内部测试**（≤100 人）—— 推定免审，构建自动分发，不用收集 UDID、不用重签。每个 build 90 天到期需重新上传。限制是测试者得加入开发团队（持 Developer 等角色）。
2. **付费开发者账号自签** —— 适合测试者不便加入团队的情况。需逐台注册设备 UDID（100 台/产品家族/会员年），`.ipa` 手工分发。
3. **提供源码 + 构建文档，让用户自行编译** —— 最合规，也最符合项目开源定位。

**方案 3 应作为官方推荐方式写进 README**，把合规责任留在用户侧，与项目的开源工具定位一致。

> 🔴 **不要用 TestFlight 外部测试或公开链接。**
>
> 一个常见的误判是"TestFlight 审核比正式上架宽松，同类 App 历史上过得去"。**这个说法没有依据。** App Review Guidelines **2.2** 明文要求 Beta 构建 "should comply with the App Review Guidelines" —— 因**内容**被拒的 App，Beta 审核同样会被拒。正式提交与 Beta 的差别只在 **2.1(a)** 的"完整度/最终版本"要求，那条只管正式提交，与 §8.2 论证的 5.2.2 / 5.2.3（第三方媒体下载需授权）完全无关。
>
> 也就是说：**外部 TestFlight 会以和正式上架相同的理由被拒**，不存在容忍度差。走这条路只会白花一次审核周期。
>
> 指南 2.2 还禁止以任何报酬（含众筹奖励）换取测试资格。
>
> **内部测试的免审依据要如实标注**：Apple 文档**没有正面写"内部测试免审"**。这是推定，依据两点 —— (a) 审核要求只出现在外部测试语境；(b) 存在 "TestFlight Internal Only" 构建类型，该类型**只能**加内部组、无法提交外部测试。推定合理但非明文，实施前建议以实际提交结果为准。

---

## 9. CI 改造

`.github/workflows/release.yml` 当前只有 Android 构建 job（ubuntu-latest + `gradlew assembleRelease` + 5 ABI）与跟随其后的 Release 发布 job，`.github/actions/setup` 只装 Node + Java 17。

新增 iOS job：

```yaml
build-ios:
  runs-on: macos-14          # Xcode 15.x 预装
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup        # 复用，Node 18（.nvmrc）
    - name: Setup Ruby
      uses: ruby/setup-ruby@v1
      with: { bundler-cache: true }        # 读 Gemfile，cocoapods ~> 1.12
    - name: Pod install
      run: cd ios && bundle exec pod install
      env: { NO_FLIPPER: 1 }
    - name: Build (unsigned, for CI 验证)
      run: |
        xcodebuild -workspace ios/LxMusicMobile.xcworkspace \
          -scheme LxMusicMobile -configuration Release \
          -sdk iphoneos -derivedDataPath build \
          CODE_SIGNING_ALLOWED=NO
```

> ⚠️ `ios/LxMusicMobile.xcworkspace` **目前不存在** —— 当前 `ios/` 只有 `.xcodeproj`。workspace 由上一步 `pod install` 生成，所以顺序不能颠倒；首次在本地跑通 `pod install` 之后再确认这个路径。

签名构建需要 `MATCH_PASSWORD` / 证书导入，涉及仓库 secrets，**建议先做 unsigned build 作为编译回归**，签名与打包 `.ipa` 留给本地或私有 runner。CI 的价值是防止 iOS 侧代码腐化（这正是当前 `ios/` 三年未变的根因）。

**关于成本**：macOS runner 的费率确实约为 Linux 的 10 倍（现价 macOS 3-4 core `$0.062`/min vs Linux 2-core `$0.006`/min；GitHub 已废弃早年的"倍率表"表述，改为直接列 per-minute 费率）。

**但对本项目不构成约束** —— lx-music-mobile 是**公开仓库**，而 public repo 上标准 GitHub-hosted runner（含 `macos-14`/`macos-15`）**完全免费**，只有 larger runners 才始终计费。所以 iOS job 可以跟每次 push，没必要为省钱限制触发条件。

现有 workflow 的触发是 `on: push: branches: [master]`，**没有** tag 或 pull_request 触发。若确实想收窄 iOS job 的触发范围（例如缩短反馈时间而非省钱），需**新增**这两个触发条件，不是改现有的。

---

## 10. 分阶段实施计划

每个阶段都给出**可自动或半自动验证的成功标准**，未达标不进入下一阶段。工期按 1 名熟悉 RN + iOS 的开发者估算。

### Phase 0：能跑起来（3-5 天）

目标：iOS 模拟器上 App 启动到首页不崩溃。

| # | 任务 | 验证标准 |
|---|---|---|
| 0.1 | `pod install` 通过（关 Flipper） | `ios/Pods` 生成，无 error |
| 0.2 | 修 Bundle ID / 版本号 / Display Name / arm64 | Xcode build 成功 |
| 0.3 | UtilsModule iOS 骨架（先只实现 `exitApp` 桩 + `getWindowSize`） | `src/app.ts` 求值不抛 TypeError |
| 0.4 | `fs.ios.ts` 适配层（除 gzip 外全部方法） | 手写一个临时脚本逐个调用 27 个导出，断言无 `undefined` 返回；**`stat`/`readDir` 需额外断言 `mimeType`/`name`/`canRead` 三个合成字段有值**（RNFS 不提供，见 §4.2.1） |
| 0.5 | 字体入 bundle + `UIAppFonts` | 首页图标正常显示，非豆腐块 |

**Phase 0 成功标准（硬门槛）**：模拟器启动 App，首页四个 Tab 可切换，无红屏。此时无音源、无播放，属正常。

### Phase 1：加密与沙箱（6-10 天，本案最关键阶段）

目标：自定义源可加载，能搜到歌。

> 工期比原估算上调 1-2 天，用于新增的 Phase 1.0（搭测试框架 + 在 Android 侧产出加密黄金基准）。这笔投入是必要的：原方案假定 `cryptoTest.ts` 可用作验证标准，实际它零断言、项目也无测试框架，等于最关键阶段没有验收门槛。

| # | 任务 | 验证标准 |
|---|---|---|
| **1.0** | **先建验证载体**：在 Android 真机跑取证脚本，导出加密黄金基准 JSON（见 §3.2）；同时给项目装上测试框架（当前**完全没有**：无 `test` script、无 jest/vitest、无任何测试文件） | 基准 JSON 落盘，含两种 AES mode + 非对齐明文 + 空 IV + 短 IV + RSA 两种 padding 往返；`npm test` 可执行 |
| 1.1 | CryptoModule 全部 9 方法（含 4 个同步） | **iOS 侧逐条比对 1.0 的黄金基准，要求字节级完全一致**（`cryptoTest.ts` 不可用作验证标准 —— 其调用全是注释、零断言、枚举名已失效） |
| 1.2 | RSA 的 SPKI↔PKCS#1 转换 | 同上，且 `generateRsaKey` 生成的公钥能被 Android 端解出 |
| 1.3 | UserApiModule：JSContext 创建 + console 注入 | `preload.js:593` 的 `console.log('Preload finished.')` 出现在 Xcode 日志 |
| 1.4 | 7 个 `__lx_native_call__*` 注入 | 每个函数单独调用返回值与 Android 逐字节一致（写对照测试） |
| 1.5 | `lx_setup` 调用 + `__lx_native__` 反向通道 | 加载一个社区音源脚本，收到 `inited` 事件 |
| 1.6 | `set_timeout` 双向 | 脚本内 `setTimeout` 正常触发 |

**Phase 1 成功标准**：导入一个社区自定义源，设置页显示"已加载"，搜索框输入关键词能返回结果列表。这一步跑通，全案风险就基本解除了。

> 🔴 **1.0 不能跳过。** 原方案把"跑通 `cryptoTest.ts` 的断言"当作本案最强的验证标准，这是错的：该文件**全部测试调用都是注释**（行 49-54、63-68、70-75），零断言，且用的枚举名 `CBC_PKCS7Padding`/`ECB_NoPadding` 早已改名，唯一引用点 `src/app.ts:53` 也是注释。项目**整体没有测试框架**。没有 1.0，Phase 1 就是一个没有验收门槛的阶段 —— 而这恰恰是全案最需要逐字节正确的部分。
>
> 1.1 和 1.4 必须用**对照测试**而非人工比对：以 Android 真机（而非本机 JDK，避免 provider 差异）产出的黄金基准为准，iOS 侧跑同一张表。加密逐字节对齐靠肉眼是不现实的。
>
> 特别提醒 1.1：`ECB_128_NoPadding` **实际带 PKCS7 padding**，这是全案最容易出错的一个点，务必先读 §3.2 的警告框。它错了不会报错，只是密文内容不对。
>
> 1.3/1.4 阶段无法用 Chrome 远程调试器（同步桥的限制，见 §3.2），只能靠 Xcode 日志与 Safari Web Inspector。

### Phase 2：播放（4-6 天）

| # | 任务 | 验证标准 |
|---|---|---|
| 2.1 | track-player iOS 侧能 build | 无编译错误，`setupPlayer` 不 reject |
| 2.2 | 加 `iosCategory: 'playback'` | 播放一首歌，**切后台仍出声** |
| 2.3 | 锁屏控制 | 锁屏界面显示歌名/封面，播放/暂停/上下曲可用 |
| 2.4 | 补 `updateNowPlayingTitles` | 锁屏标题随歌词逐行变化 |
| 2.5 | 补 `getCacheSize`/`clearCache`/`isCached`（或降级返回 0/false） | 设置页缓存管理不报错；`preloadNextMusic` 不崩 |
| 2.6 | CacheModule | 设置页显示缓存大小，清理有效 |

**Phase 2 成功标准**：完整听完一首在线歌曲，中途锁屏不中断，锁屏可控制切歌。

若 2.1 失败（SwiftAudioEx 与 RN 0.73 不兼容），立即转备选方案（升级到上游 track-player 4.x），不做超过 1 天的兼容性挣扎。

### Phase 3：功能补齐（5-7 天）

| # | 任务 | 验证标准 |
|---|---|---|
| 3.1 | gzip（UtilsModule + Compression.framework） | iOS 导出的备份文件能被 Android 版导入，反向亦可 |
| 3.2 | Toast（`toast.ios.tsx`） | 各处 toast 调用正常显示 |
| 3.3 | 深链（AppDelegate + Info.plist） | `xcrun simctl openurl booted "lxmusic://player/play"` 触发播放 |
| 3.4 | 文件打开（CFBundleDocumentTypes） | 从"文件"App 用本 App 打开 `.lxmc`，触发导入流程 |
| 3.5 | ChoosePath iOS 化（DocumentPicker） | 能选中一个文件并导入歌单 |
| 3.6 | 通知权限 / 屏幕常亮 / 分享 / 设备名 / WiFi IP | 逐个功能点手测 |
| 3.7 | 数据同步（依赖 3.6 的 `getDeviceName` + Phase 1 的 crypto） | 与桌面版完成一次双向同步 |
| 3.8 | tools.ts 各处平台分支 | `isSupportedAutoTheme` 生效，系统深色模式跟随 |

**Phase 3 成功标准**：主流程（搜索→播放→收藏→歌单管理→备份恢复→同步）全部可用。

### Phase 4：降级与打磨（3-5 天）

| # | 任务 | 验证标准 |
|---|---|---|
| 4.1 | 桌面歌词整组隐藏 + `lyricDesktop.ios.ts` 桩 | 设置页无死链，无 reject 未捕获警告 |
| 4.2 | 本地音乐降级 | 扫描本地文件不崩，元数据显示文件名 |
| 4.3 | 应用内更新改为跳转 Release 页 | 点击更新打开 Safari |
| 4.4 | 横屏 / iPad 布局 | 24 个 Horizontal 布局 tsx 在 iPad 上不错位 |
| 4.5 | CI iOS job | PR 触发 unsigned build 通过 |
| 4.6 | 真机测试 | 至少 2 台设备（一台旧机型验 iOS 13/14） |

**Phase 4 成功标准**：真机连续使用 30 分钟无崩溃，Xcode Instruments 无明显内存泄漏。

### Phase 5：可选增强（不承诺工期）

锁屏/灵动岛歌词（Live Activities）、本地音乐元数据读写、AirPlay 适配、CarPlay。

### 工期汇总

| 阶段 | 工期 |
|---|---|
| Phase 0 能跑起来 | 3-5 天 |
| Phase 1 加密与沙箱 | 6-10 天 |
| Phase 2 播放 | 4-6 天 |
| Phase 3 功能补齐 | 5-7 天 |
| Phase 4 降级与打磨 | 3-5 天 |
| **合计** | **21-33 天**（约 4-7 周） |

对比参考：Flutter 重写路线需重做 61,667 行业务代码 + 全部 UI（207 个 screens tsx + 70 个 components tsx），量级在 3-6 个月。

---

## 11. 风险登记

| # | 风险 | 概率 | 影响 | 缓解措施 | 触发时的止损 |
|---|---|---|---|---|---|
| R1 | 第三方混淆音源脚本在 JSC 上行为异常（正则、`Error.stack`、数值边界） | 中 | 部分音源不可用 | Phase 1 末拿社区高频脚本做回归 | 逐个 case 分析；极端情况给该脚本做 shim |
| R2 | RSA 的 SPKI/PKCS#1 DER 转换踩坑，`SecKeyCreateWithData` 返回 nil | **高** | 同步功能与部分音源废 | 用 Phase 1.0 的黄金基准做对照测试，不靠肉眼 | 引入成熟 ASN.1 库（如 SwiftASN1） |
| **R2b** | **`ECB_128_NoPadding` 误按 NoPadding 实现**（枚举名与实际行为不符，见 §3.2） | **高** | 网易云/酷我/数据同步/沙箱注入全部静默出错，且**不报错、密文长度也对** | Phase 1.0 的黄金基准必须含非 16 字节对齐明文 —— 这是唯一能暴露 padding 差异的用例 | 加上 `kCCOptionPKCS7Padding` |
| R3 | SwiftAudioEx 0.14.7 与 RN 0.73 / Xcode 15 不兼容 | 中 | 播放整体不可用 | Phase 2.1 优先验证 | 1 天内切上游 track-player 4.x |
| R4 | track-player 缓存三方法（`getCacheSize`/`clearCache`/`isCached`）在 iOS 无内建支持 | 高 | 缓存功能缺失 | 首版降级返回 0/false | 后续用 SwiftAudioEx 的 `CachingPlayerItem` 自实现 |
| R5 | `fs.ios.ts` 与 `react-native-file-system` 行为差异（路径格式、encoding 仅 3 种、`stat`/`readDir` 字段缺失） | 中 | 存储层零散 bug | 写覆盖 27 个导出的适配层测试；**重点断言 `stat().name` —— RNFS 的 `.d.ts` 声明了它但运行时不返回，TS 检查不出来** | 逐项对齐 |
| **R5b** | **gzip 格式与 Android 不互通**（`COMPRESSION_ZLIB` 出的是 raw DEFLATE，非 gzip） | **高** | 备份文件跨端打不开、数据同步报文解不出 | 用 libz `windowBits=31`；用 Android 产出的 `.lxmc` 备份文件做跨端互通测试 | 小数据改用已有的 `pako`（§4.2.2） |
| R6 | TestFlight **外部**测试审核被拒（5.2.3 / 2.5.2；指南 2.2 明确 Beta 同受约束） | **高** | 无法走外部测试 | 见 §8.3，**主推内部测试**（≤100 人，推定免审）与源码自编译 | 转内部测试或自签分发 |
| R7 | `user-api-preload.js` 移到共享目录破坏 Android 构建 | 低 | Android 打包失败 | 改动后先跑一次 Android release 构建 | 回滚，改为 iOS 侧拷贝一份（接受重复） |
| R8 | iOS 侧代码再次腐化（历史已发生一次，`ios/` 三年未变） | 中 | 长期维护成本 | §9 的 CI job 是必要投入，不是可选项 | — |

**R2 是最需要提前处理的技术风险**（概率高、影响大、且藏在细节里）。建议 Phase 1 从它开始，而不是从更"显眼"的 UserApiModule 开始——crypto 跑通了才能验证 userApi 的加密函数注入。

---

## 12. 改动文件清单速查

### 新增

```
ios/LxMusicMobile/Modules/UtilsModule.{h,m}          ~400 行
ios/LxMusicMobile/Modules/CryptoModule.{h,m}         ~350 行（含 ASN.1 处理）
ios/LxMusicMobile/Modules/UserApiModule.{h,m}        ~500 行（JSC 沙箱）
ios/LxMusicMobile/Modules/CacheModule.{h,m}          ~60 行
src/utils/fs.ios.ts                                  ~150 行（含 stat/readDir 字段合成、gzip 分场景）
src/utils/nativeModules/lyricDesktop.ios.ts          ~40 行（全桩）
src/utils/toast.ios.tsx                              ~60 行
src/utils/version.ios.js                             ~30 行
src/utils/hooks/useBackHandler.ios.ts                ~10 行（空 hook，§6.1b）
assets/script/user-api-preload.js                    （从 android/ 移动）
.github/workflows/release.yml → 新增 build-ios job
test/crypto-golden-vectors.json                      Phase 1.0 的加密黄金基准
（测试框架：jest 或 vitest —— 项目当前完全没有测试载体，§3.2）
```

### 修改

```
ios/LxMusicMobile/Info.plist          §5.1（7 处新增 + 2 处清理）
ios/LxMusicMobile/AppDelegate.mm      §5.4（深链 + AVAudioSession）
ios/Podfile                           §5.2（关 Flipper）
ios/LxMusicMobile.xcodeproj/project.pbxproj  §5.3（Bundle ID / 版本 / arm64 / 资源）
src/utils/fs.ts → 拆为 fs.android.ts + 共享类型（含自声明 FileType）
src/utils/tools.ts                    §6.1（osVer 平台分支 + toast 抽出 + 2 处桩化）
src/components/common/StatusBar.tsx   §6.1b（currentHeight 是 Android-only）
src/components/SizeView.tsx            §6.1b（同上）
src/utils/windowSizeTools.ts:51       §6.1b（同上，非组件，需走原生取值）
src/plugins/player/index.ts:29-40     §6.4（加 iosCategory）
src/plugins/sync/client/utils.ts:74,82  §4.2.2（gzipString 走 pako）
src/utils/localMediaMetadata.ts       §6.5（降级分支）
src/components/common/ChoosePath/*    §6.2（族共 8 个文件，需改 4 个）
src/core/common.ts:98,106             §6.2（SAF 相关恒真）
tsconfig.json                         §4.2.3（moduleSuffixes，若采用平台后缀方案）
android/app/build.gradle              §5.3 注（assets 路径映射，唯一 Android 改动）
```

### 不动

`src/` 其余 ~60,000 行业务代码、207 个 screens tsx、70 个 components tsx、`src/utils/musicSdk/` 全部音源实现、`src/store/`、`src/theme/`、i18n。

---

## 13. 与 Flutter 路线的最终对照

| 维度 | 本方案（RN 补 iOS） | Flutter 重写 |
|---|---|---|
| 业务代码复用 | 100%（61,667 行） | 0% |
| UI 复用 | 100%（277 个组件） | 0% |
| 自定义源兼容性 | 完全兼容（同一份 preload） | 需重写沙箱，且 `env` 标识为 `desktop` 而非 `mobile`，脚本行为有差异 |
| iOS 原生代码量 | ~1,300 行 | 0（用 flutter_js 等现成插件） |
| 与上游同步 | 可持续跟随 lyswhut/lx-music-mobile | 完全分叉 |
| 工期 | 4-7 周 | 3-6 个月 |
| Android 端风险 | 低（改动仅一处路径） | 需重新验证全部功能 |

Flutter 版的价值在于它证明了"iOS 上用 JSC 跑自定义源是可行的"——这个结论我们可以直接拿来用，但不必为此丢掉整个现有代码库。

---

## 附录：取证方法与索引

**codegraph 影响面分析**（v1.5.0）

| 符号 | 触达符号数 |
|---|---|
| `exitApp` | 21 |
| `rsaEncrypt` | 13 |
| `loadScript` | 8 |
| `getAppCacheSize` | 4 |
| `getWIFIIPV4Address` | 4 |

**远端核实**（`node_modules` 未安装，改用 API 取证，得到 commit 级精度）

- GitHub Tree API `/git/trees/<sha>?recursive=1` —— 确认 fork 的 `ios/` 目录存在性
- raw.githubusercontent —— 读 podspec 与 iOS 源码
- CocoaPods trunk API —— 确认 `SwiftAudioEx 0.14.7` 存在、无可用现代 QuickJS pod
- developer.apple.com 审核指南原文 —— 2.5.2 / 4.7.x / 5.2.2 / 5.2.3

**关键源文件索引**

| 文件 | 行数 | 本方案引用章节 |
|---|---|---|
| `android/.../userApi/QuickJS.java` | 220 | §3.3.2 |
| `android/app/src/main/assets/script/user-api-preload.js` | 594 | §3.3.3 |
| `android/.../crypto/AES.java` | 98 | §3.2 |
| `android/.../crypto/RSA.java` | 113 | §3.2 |
| `src/utils/nativeModules/crypto.ts` | 87 | §3.2 |
| `src/utils/nativeModules/utils.ts` | — | §2.1, §3.1 |
| `src/utils/nativeModules/lyricDesktop.ts` | — | §7 |
| `src/utils/fs.ts` | 28 导出 | §4.2 |
| `src/utils/tools.ts` | — | §2.5, §6.1 |
| `src/core/init/userApi/index.ts` | 256 | §3.3.4 |
| `src/core/init/deeplink/index.ts` | 107 | §6.3 |
| `src/plugins/player/index.ts` | — | §4.3, §6.4 |
| `ios/LxMusicMobile/AppDelegate.mm` | — | §5.4 |
| `android/app/src/main/AndroidManifest.xml` | 34-91 | §5.1 |




