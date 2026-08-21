# lx-music-mobile iOS 支持实施方案

> 输入依据：[docs/ios-analysis.md](./ios-analysis.md)（iOS 现状与困难点）、[docs/flutter-comparison.md](./flutter-comparison.md)（Flutter 重写版对比）
> 代码取证：codegraph v1.5.0 影响面分析 + 全量精读原生模块与桥接层
> 取证基线：`master` @ `05c322a`（v1.8.1），RN 0.73.11 / 老架构 / Hermes
> 撰写日期：2026-08-21

---

## 0. 结论先行

**推荐路线：在现有 RN 工程内补齐 iOS 侧，自定义源沙箱改用 JavaScriptCore。**

三条支撑理由：

1. **业务代码 100% 可复用**。`src/` 共 61,667 行，其中真正含 Android 假设的只有 `src/utils/fs.ts`、`src/utils/tools.ts`、`src/utils/nativeModules/*` 和 `ChoosePath` 组件族，合计不到 1,500 行。Flutter 重写等于丢弃全部 61,667 行。
2. **沙箱移植不是重写运行时，是重写 220 行胶水**。`user-api-preload.js`（594 行）对引擎的全部依赖只有 5 项：`Proxy` ×1、`Object.getOwnPropertyDescriptors` ×2、`Promise` ×6、`Uint8Array`/`ArrayBuffer` ×9，外加一处已被注释掉的 `TextDecoder`。**不使用** `Reflect`、`BigInt`、`WeakRef`、`Symbol`、`async/await`、`??`、`?.`。iOS 13.4 的 JavaScriptCore 全部原生支持。
3. **硬阻塞只有 2 项**，都在 fork 依赖层，且都有明确的绕行方案（§4.2、§4.3）。

**明确不做项**：桌面歌词悬浮窗、APK 内更新、App Store 正式上架（理由见 §7、§8）。

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

这不是运行时报错，是**模块求值期 TypeError**，iOS 上 App 启动即白屏。codegraph 影响面：`exitApp` 触达 21 个符号，`nativeModules/utils` 被 16 个文件引用。

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

`file-system` 是最痛的一项：`src/utils/fs.ts` 导出 28 个函数，被 **23 个文件**引用，等于整个 App 的存储层。

### 2.4 第四层：iOS 工程配置为裸模板

`ios/` 仅 13 个文件，`git log --all -- ios/` 共 12 次提交**全部是 RN 升级带来的模板同步**，最后一次 `f3c79fe`（2023-12-07, RN 0.73.0）。人工改动只有 `AppDelegate.mm` 里的 RNN 接线：

```objc
RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
[ReactNativeNavigation bootstrapWithBridge:bridge];
```

缺失清单见 §5，其中 `UIBackgroundModes` 缺失 = **后台播放直接不工作**，是仅次于启动崩溃的第二优先项。

### 2.5 第五层：JS 层 Android 假设

好消息：面很窄。全仓 `Platform.OS` 只出现 3 处（2 处已注释）。集中在 `src/utils/tools.ts`：

| 位置 | Android 专有 API | iOS 处置 |
|---|---|---|
| tools.ts:107-136 | `ToastAndroid.showWithGravityAndOffset` | 需替换（§6.1） |
| tools.ts:149-151 | `BackHandler.exitApp()` | iOS 无此概念，桩化 |
| tools.ts:59-90 | `PermissionsAndroid` 存储权限 | iOS 沙箱内无需，直接 return true |
| tools.ts:29 | `Platform.constants.Release` | iOS 上是 `osVersion`，需分支 |
| tools.ts:244-331 | 通知权限 / 电池优化白名单 | 通知走 iOS 原生；电池优化 iOS 无此概念 |
| tools.ts:365-368 | `isSupportedAutoTheme = isAndroid` | iOS 13+ 支持，应改为 true |
| `ChoosePath/*`（4 文件） | SAF（`AndroidScoped.*`）、`Dirs.SDCardDir` | iOS 无 SAF，需换 UIDocumentPicker（§6.2） |
| version.js:77,122 | `getSupportedAbis` / `installApk` | iOS 不允许，功能整体关闭（§7） |

---

## 3. 自研原生模块的 iOS 实现方案

### 3.1 UtilsModule（Objective-C / Swift，约 400 行）

18 个方法按必要性分三档：

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
| `onFullScreen` / `offFullScreen` | `setNeedsStatusBarAppearanceUpdate` + `prefersStatusBarHidden` |

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
| `AES_MODE.ECB_128_NoPadding` | `AES` | `CCCrypt(kCCAlgorithmAES, kCCOptionECBMode)`，**无 padding 位** |
| `RSA_PADDING.OAEPWithSHA1AndMGF1Padding` | `RSA/ECB/OAEPWithSHA1AndMGF1Padding` | `SecKeyCreateEncryptedData(.rsaEncryptionOAEPSHA1)` |
| `RSA_PADDING.NoPadding` | `RSA/ECB/NoPadding` | `SecKeyCreateEncryptedData(.rsaEncryptionRaw)` |

RSA 密钥格式（`RSA.java:60-96`）：

- 生成：`KeyPairGenerator("RSA").initialize(2048)` → iOS `SecKeyCreateRandomKey`，`kSecAttrKeySizeInBits: 2048`
- 公钥：`X509EncodedKeySpec`（SPKI DER）→ iOS `SecKeyCreateWithData` 只吃**裸 PKCS#1 RSAPublicKey**，必须手工剥掉 SPKI 的 AlgorithmIdentifier 外层
- 私钥：`PKCS8EncodedKeySpec` → 同理需 PKCS#8 → PKCS#1 转换

> ⚠️ 这是最容易埋雷的一处。Java 的 `X509EncodedKeySpec`/`PKCS8EncodedKeySpec` 与 iOS Security.framework 的 DER 期望**不同层级**，直接把 base64 喂给 `SecKeyCreateWithData` 会返回 nil。需要写一小段 ASN.1 头处理（约 60 行）。

`crypto.ts` 还负责 PEM 头尾的拼接/剥离（`-----BEGIN PUBLIC KEY-----`），iOS 侧收到的已是裸 base64，无需重复处理。

**4 个同步方法必须用 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`**：`rsaEncryptSync`、`rsaDecryptSync`、`aesEncryptSync`、`aesDecryptSync`。老架构下这要求模块运行在 JS 线程，需 `requiresMainQueueSetup` 返回 `NO`。

**验证方式**：项目已有 `src/utils/nativeModules/cryptoTest.ts`。iOS 侧实现完成后，先跑通该测试文件的全部断言，再动其他模块。这是本案最强的可验证标准。

### 3.3 UserApiModule（JavaScriptCore，约 500 行）

#### 3.3.1 选型：JSC vs vendored QuickJS vs WKWebView

| 方案 | 语言特性 | 包体 | 沙箱隔离 | 同步桥 | 工期 | 结论 |
|---|---|---|---|---|---|---|
| **JavaScriptCore.framework** | ES2020+（iOS 13.4 够用） | 0（系统库） | JSContext 级隔离，globalThis 独立 | 原生同步 | 3-5 天 | ✅ **推荐** |
| vendored QuickJS | 与 Android 完全一致 | +800KB × arch | 进程内隔离 | 需自写 | 2-3 周 | ❌ 收益不抵成本 |
| 隐藏 WKWebView | Safari JS | 0 | 进程外，最强 | **不可能**（全异步） | 1-2 周 | ❌ 同步桥不可得 |

排除 QuickJS 的额外硬证据：CocoaPods trunk 上**没有**任何可用的现代 QuickJS pod（仅 `QuickJS-iOS` 0.0.1~0.0.4，2019 年停更）。Android 用的 `wang.harlon.quickjs:wrapper-android` 是纯 Android/JVM wrapper（上游 README 明写 "for Android/JVM"），无 iOS 产物。走 QuickJS 就意味着自己 vendored 编译 + 自写 JSValue↔ObjC 双向绑定，等于重做 wrapper 的活。

排除 WKWebView 的决定性理由：preload 脚本注入的 `__lx_native_call__utils_*` 系列**是同步返回**的（见下表 return 值），WKWebView 的 `evaluateJavaScript` 只有 completion handler，无法在 JS 表达式里同步取回结果。改成异步就要重写 preload 脚本，破坏与桌面版/Android 版的脚本兼容性——而脚本兼容性正是自定义源生态的全部价值。

Flutter 版之所以能用 `flutter_js`，正因为它在 iOS 上底层**就是 JSC**（见 [flutter-comparison.md](./flutter-comparison.md)）。这反向印证了 JSC 路线可行。

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
| `Promise` | 6 | ✅ |
| `Uint8Array` / `ArrayBuffer` | 9 | ✅ |
| `TextDecoder` | 0（`preload:410` 已注释） | — 无需 polyfill |
| `Reflect`/`BigInt`/`WeakRef`/`Symbol`/`async` | 0 | — |

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
| `readDir` / `unlink` / `mkdir` / `stat` | `FileSystem.*` | `RNFS.readDir` / `unlink` / `mkdir` / `stat` |
| `readFile` / `writeFile` / `appendFile` | `FileSystem.*` | `RNFS.*`，注意 encoding 枚举名不同 |
| `hash` | `FileSystem.hash` | `RNFS.hash`（支持 md5/sha1/sha256…） |
| `moveFile` / `rename` / `existsFile` | `FileSystem.*` | `RNFS.moveFile` / `moveFile` / `exists` |
| `gzipFile` / `unGzipFile` / `gzipString` / `unGzipString` | `FileSystem.*` | ⚠️ **RNFS 无 gzip**，见下 |
| `selectManagedFolder` / `getManagedFolders` / `removeManagedFolder` / `getPersistedUriList` | `AndroidScoped.*`（SAF） | iOS 无 SAF，桩化（§6.2） |
| `selectFile` | `AndroidScoped.openDocument` | `UIDocumentPickerViewController`（§6.2） |
| `getExternalStoragePaths` | fork 专有 | 返回单元素数组 `[DocumentDirectoryPath]` |

**gzip 缺口是个真问题**。`tools.ts:153-165` 的 `handleSaveFile`/`handleReadFile` 依赖 gzip，而这是**歌单/配置备份与恢复**的核心路径。三个选项：

1. 纯 JS gzip（`pako` / `fflate`）— 简单，但 64MB 歌单文件在 JS 侧压缩会卡 UI
2. 在 UtilsModule 里加 2 个方法，用 iOS `Compression.framework`（`COMPRESSION_ZLIB`）— 推荐，约 80 行
3. 备份文件在 iOS 上改存未压缩 — 会破坏与 Android/桌面版的备份文件互通

**选 2**。互通性不能丢，这是洛雪生态的基本约定。

实现形式：给 `fs.ts` 加平台后缀分文件（`fs.android.ts` / `fs.ios.ts`），共享同一份类型定义。Metro 自动按平台解析，23 个引用方零改动。

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
    <key>CFBundleTypeName</key><string>Audio</string>
    <key>LSItemContentTypes</key><array><string>public.audio</string></array>
    <key>LSHandlerRank</key><string>Alternate</string>
  </dict>
</array>
<!-- .lxmc 是自定义扩展名，需配套 UTExportedTypeDeclarations 声明 UTI -->

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

---

## 6. JS 层改造清单

改造原则：**优先用平台后缀文件（`.ios.ts`），其次用 `Platform.OS` 分支，禁止改动业务逻辑**。平台后缀能让引用方零改动，这是最小侵入的做法。

### 6.1 src/utils/tools.ts

三处必改：

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

// tools.ts:365-368 —— iOS 13+ 支持系统深色模式跟随
isSupportedAutoTheme = true   // 当前是 isAndroid，iOS 上错误地返回 false
```

两处桩化即可（保持签名，返回让上层走"已授权"分支的值）：

```ts
// tools.ts:59, 61-90 存储权限 —— iOS 应用沙箱内读写无需授权
checkStoragePermissions  → async () => true
requestStoragePermission → async () => true

// tools.ts:149-151 exitApp —— iOS 无 BackHandler，且不应主动退出
exitApp → () => {}
```

`tools.ts:244-331` 的通知权限与电池优化检查：`isNotificationsEnabled`/`requestNotificationPermission` 走 §3.1 的 iOS 实现；`isIgnoringBatteryOptimization` 返回 `true` 让 `checkIgnoringBatteryOptimization` 在第 4 行 `if (enabled) return` 直接退出，不弹无意义的弹窗。

### 6.2 ChoosePath 组件族（4 个文件）

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

| 路径 | 前提 | 有效期 | 用户规模 | 审核 |
|---|---|---|---|---|
| **自签（Xcode / AltStore）** | 免费 Apple ID | 7 天（付费账号 1 年） | 自用 | 无 |
| **TestFlight** | $99/年开发者账号 | 90 天/构建 | ≤10,000 | 有（较宽松，但仍会查） |
| **App Store 正式上架** | 同上 | 长期 | 无限 | 严格 |

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

1. 用付费开发者账号自签（1 年有效期，`.ipa` 可分发给已注册设备）
2. 有余力则做 TestFlight 内测分发（注意：TestFlight 也过审，但历史上对同类 App 的容忍度高于正式上架；仍存在被拒风险）
3. 提供源码 + 构建文档，让用户自行编译（最合规，也最符合项目开源定位）

**方案 3 应作为官方推荐方式写进 README**，把合规责任留在用户侧，与项目的开源工具定位一致。

---

## 9. CI 改造

`.github/workflows/release.yml` 当前只有 Android job（ubuntu-latest + `gradlew assembleRelease` + 5 ABI），`.github/actions/setup` 只装 Node + Java 17。

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

签名构建需要 `MATCH_PASSWORD` / 证书导入，涉及仓库 secrets，**建议先做 unsigned build 作为编译回归**，签名与打包 `.ipa` 留给本地或私有 runner。CI 的价值是防止 iOS 侧代码腐化（这正是当前 `ios/` 三年未变的根因）。

**注意成本**：macOS runner 的 GitHub Actions 计费倍率是 Linux 的 10 倍。建议 iOS job 只在 `push tag` 和 `pull_request` 触发，不跟每次 push。

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
| 0.4 | `fs.ios.ts` 适配层（除 gzip 外全部方法） | 手写一个临时脚本调用全部 28 个导出，无 undefined |
| 0.5 | 字体入 bundle + `UIAppFonts` | 首页图标正常显示，非豆腐块 |

**Phase 0 成功标准（硬门槛）**：模拟器启动 App，首页四个 Tab 可切换，无红屏。此时无音源、无播放，属正常。

### Phase 1：加密与沙箱（5-8 天，本案最关键阶段）

目标：自定义源可加载，能搜到歌。

| # | 任务 | 验证标准 |
|---|---|---|
| 1.1 | CryptoModule 全部 9 方法（含 4 个同步） | **`src/utils/nativeModules/cryptoTest.ts` 全部断言通过** |
| 1.2 | RSA 的 SPKI↔PKCS#1 转换 | 同上，且 `generateRsaKey` 生成的公钥能被 Android 端解出 |
| 1.3 | UserApiModule：JSContext 创建 + console 注入 | `preload.js:593` 的 `console.log('Preload finished.')` 出现在 Xcode 日志 |
| 1.4 | 7 个 `__lx_native_call__*` 注入 | 每个函数单独调用返回值与 Android 逐字节一致（写对照测试） |
| 1.5 | `lx_setup` 调用 + `__lx_native__` 反向通道 | 加载一个社区音源脚本，收到 `inited` 事件 |
| 1.6 | `set_timeout` 双向 | 脚本内 `setTimeout` 正常触发 |

**Phase 1 成功标准**：导入一个社区自定义源，设置页显示"已加载"，搜索框输入关键词能返回结果列表。这一步跑通，全案风险就基本解除了。

> 建议 1.1 和 1.4 用**对照测试**而非人工比对：写一个小 Node 脚本用 Android 的 Java 实现（或已知正确的桌面版实现）生成 (输入, 期望输出) 对照表，iOS 侧跑同一张表。加密逐字节对齐靠肉眼是不现实的。

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
| Phase 1 加密与沙箱 | 5-8 天 |
| Phase 2 播放 | 4-6 天 |
| Phase 3 功能补齐 | 5-7 天 |
| Phase 4 降级与打磨 | 3-5 天 |
| **合计** | **20-31 天**（约 4-6 周） |

对比参考：Flutter 重写路线需重做 61,667 行业务代码 + 全部 UI（207 个 screens tsx + 70 个 components tsx），量级在 3-6 个月。

---

## 11. 风险登记

| # | 风险 | 概率 | 影响 | 缓解措施 | 触发时的止损 |
|---|---|---|---|---|---|
| R1 | 第三方混淆音源脚本在 JSC 上行为异常（正则、`Error.stack`、数值边界） | 中 | 部分音源不可用 | Phase 1 末拿社区高频脚本做回归 | 逐个 case 分析；极端情况给该脚本做 shim |
| R2 | RSA 的 SPKI/PKCS#1 DER 转换踩坑，`SecKeyCreateWithData` 返回 nil | **高** | 同步功能与部分音源废 | 用 `cryptoTest.ts` 做对照测试，不靠肉眼 | 引入成熟 ASN.1 库（如 SwiftASN1） |
| R3 | SwiftAudioEx 0.14.7 与 RN 0.73 / Xcode 15 不兼容 | 中 | 播放整体不可用 | Phase 2.1 优先验证 | 1 天内切上游 track-player 4.x |
| R4 | track-player 缓存三方法（`getCacheSize`/`clearCache`/`isCached`）在 iOS 无内建支持 | 高 | 缓存功能缺失 | 首版降级返回 0/false | 后续用 SwiftAudioEx 的 `CachingPlayerItem` 自实现 |
| R5 | `fs.ios.ts` 与 `react-native-file-system` 行为差异（路径格式、encoding 枚举、stat 字段） | 中 | 存储层零散 bug | 写覆盖 28 个导出的适配层测试 | 逐项对齐 |
| R6 | TestFlight 审核被拒（5.2.3 / 2.5.2） | 高 | 无法走 TestFlight | 见 §8.3，主推自签与源码自编译 | 转自签分发 |
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
src/utils/fs.ios.ts                                  ~120 行
src/utils/nativeModules/lyricDesktop.ios.ts          ~40 行（全桩）
src/utils/toast.ios.tsx                              ~60 行
src/utils/version.ios.js                             ~30 行
assets/script/user-api-preload.js                    （从 android/ 移动）
.github/workflows/release.yml → 新增 build-ios job
```

### 修改

```
ios/LxMusicMobile/Info.plist          §5.1（7 处新增 + 2 处清理）
ios/LxMusicMobile/AppDelegate.mm      §5.4（深链 + AVAudioSession）
ios/Podfile                           §5.2（关 Flipper）
ios/LxMusicMobile.xcodeproj/project.pbxproj  §5.3（Bundle ID / 版本 / arm64 / 资源）
src/utils/fs.ts → 拆为 fs.android.ts + 共享类型
src/utils/tools.ts                    §6.1（3 处平台分支 + 2 处桩化）
src/plugins/player/index.ts:29-40     §6.4（加 iosCategory）
src/utils/localMediaMetadata.ts       §6.5（降级分支）
src/components/common/ChoosePath/*    §6.2（4 个文件）
src/core/common.ts:98,106             §6.2（SAF 相关恒真）
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
| 工期 | 4-6 周 | 3-6 个月 |
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








