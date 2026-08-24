# 使用 Rust 重构 LX Music Mobile 以支持全平台 —— 可行性与难度分析

> 本文只做分析，不含实施计划。姊妹文档：[ios-support-plan.md](./ios-support-plan.md)（在现有 RN 架构上加 iOS 的方案）。
>
> 分析日期：2026-08-21。所有版本号与官方措辞均带出处；查不到的一律标注「未查证」，不以推断充作事实。

---

## 0. 结论先行

**「用 Rust 重构支持所有平台」不是一个方案，而是两个难度差一个量级的方案。必须先分开。**

| | 路线 A：Rust 核心 + 各平台原生 UI | 路线 B：Rust 全栈（含 UI） |
|---|---|---|
| Rust 负责 | 音源解析、加密、同步、歌词解析、存储 | 上述全部 + 界面渲染 |
| UI 由谁写 | Android Compose / iOS SwiftUI / 桌面各自 | 单一 Rust GUI 框架 |
| 业界先例 | **Signal、1Password、Mozilla 三个一手案例** | **未查到任何知名生产案例** |
| UI 代码命运 | 24,773 行 TSX **按平台数翻倍重写** | 24,773 行押注在成熟度不足的框架上 |
| 主要风险 | 工作量爆炸（可预测） | 框架能力不足（不可预测） |

**核心判断：**

1. **路线 B 目前不成立**，不是因为难，而是因为 Rust 没有生产级移动 GUI 方案：**未查到任何消费级上架 App**；Slint 的生产案例全是企业 HMI；iOS 无障碍 adapter 还是 `0.1.2` 版（桌面版已 0.26～0.34、千万级下载）；**0 个框架同时支持 Android+iOS+鸿蒙**（详见 §3）。选它等于拿项目给框架做移动端验证。
2. **路线 A 技术上成立，但它并不解决「支持全平台」这个原始诉求** —— UI 仍要按平台各写一遍，iOS 界面照样得从零写。相比 [ios-support-plan.md](./ios-support-plan.md) 的 4-7 周，路线 A 是数量级更大的投入。
3. **Rust 收益最明确的一层是 musicSdk（10,040 行）**：76 个文件里只有 3 个引用 react-native，且这 3 处依赖的全是 md5/base64/AES 这类纯计算。移植到 Rust 反而**消除**了原生桥依赖，并顺带消掉 ios-support-plan 里那个最危险的坑（§2.2）。
4. **「用 Rust 就能去掉 JS」是个误解**：用户源（自定义音源脚本）是产品功能，其沙箱契约是公开 API。Rust 重写后仍必须内嵌一个 JS 引擎，且要逐字节兼容现有契约，否则存量第三方脚本全废。不过这一层**意外地不是难点** —— Android 现在用的就是 QuickJS（不是 WebView），Rust 侧换绑定不换引擎，脚本行为一致性**有可能优于** iOS 现方案的 JSC 路线 —— 前提是两端 QuickJS 分叉一致，待实测（§4、§8.9）。

> **一句话**：如果目标是「让 iOS 能用」，Rust 重构是绕远路；如果目标是「长期收敛多端逻辑重复」，路线 A 值得考虑，但要按「重写 UI ×N 个平台」来预算，而不是按「一次重写」。

---

## 1. 现状基线（本地实测，非估算）

以下数字由 `find`/`wc` 在当前工作树实测得到，作为后续所有工作量推算的基准。

### 1.1 代码总量

| 层 | 行数 | 占比 | Rust 可移植性 |
|---|---|---|---|
| `src/screens` + `src/components`（UI，其中 `.tsx` 23,760 行） | 24,773 | 40% | ❌ 不可移植，见 §3 |
| `src/utils/musicSdk`（音源适配） | 10,040 | 16% | ✅ 最适合，见 §2 |
| `src/utils`（除 musicSdk） | 6,577 | 11% | ⚠️ 部分 |
| `src/core`（业务编排） | 5,012 | 8% | ✅ 大部分可移植 |
| `src/theme` | 4,823 | 8% | ⚠️ 其中 4,036 行是生成产物，见下 |
| `src/plugins`（播放/同步/存储） | 2,667 | 4% | ⚠️ 播放部分不可移植 |
| `src/store`（状态） | 2,316 | 4% | ❌ 与 React hooks 绑定 |
| `src/navigation` | 1,724 | 3% | ❌ 绑定 RNN |
| `src/event` | 734 | 1% | ✅ 纯逻辑 |
| **src 合计** | **61,667** | | |
| Android 原生 Java | 3,843 | | 需按平台重建 |

**一处必须修正的口径**：`src/theme` 的 4,823 行里，`themes/themes.ts` 独占 4,036 行，文件头写着 `//! 此文件由 createThemes.js 生成`，内容是 16 个内置主题的色板展开。**重写量应按生成器（`createThemes.js` 312 行）算，不是按产物算。** 用 4,823 行去论证工作量会虚高约 3,700 行。同理，报告中任何「61,667 行都要重写」的说法都不成立。

### 1.2 按「重写命运」重新分组

| 命运 | 内容 | 行数 |
|---|---|---|
| **可移植到 Rust 并跨平台复用** | musicSdk + core + plugins/sync + event + utils 纯逻辑部分 | ~25,000 |
| **必须按平台重写 N 遍** | screens + components + navigation + store | ~29,600 |
| **可由生成器重建** | theme 产物 | ~4,000 |
| **原生能力，按平台重建** | Java 5 模块 | 3,843 |

这个分组是后文所有难度判断的骨架：**Rust 能救的是第一组，第二组无论选哪条路线都躲不过。**

### 1.3 依赖面

`package.json` 直接依赖 23 项，其中与平台能力强绑定的 6 项是重写时的硬骨头：

| 依赖 | 版本 | 作用 | Rust 侧对应物 |
|---|---|---|---|
| `react-native-navigation` | 7.39.2 | 原生导航 | 无，UI 框架自带或手写 |
| `react-native-track-player` | fork | 播放器（ExoPlayer/AVPlayer） | 见 §5 |
| `react-native-local-media-metadata` | fork | 本地音乐元数据 | 需重写 |
| `react-native-file-system` | fork | 文件系统 | Rust `std::fs` 直接可用 |
| `react-native-background-timer` | fork | 后台定时器 | Rust 线程/tokio |
| `@react-native-async-storage/async-storage` | ^2.1.2 | KV 持久化 | Rust sled/rusqlite |

注意 4 个 fork 依赖（`lyswhut/*`）意味着上游能力不足、已有定制补丁 —— 这些补丁的意图需要在重写时逐条复原，属于隐性工作量。

### 1.4 自研原生模块

| 模块 | Java 行数 | 内容 |
|---|---|---|
| `lyric` | 1,942 | **桌面歌词悬浮窗**（`SYSTEM_ALERT_WINDOW`），Android 独有 |
| `utils` | 672 | 电池优化、通知权限、系统交互 |
| `userApi` | 541 | **QuickJS 用户脚本沙箱**，见 §4 |
| `cache` | 208 | 缓存清理 |
| `crypto` | （见 ios-support-plan） | AES/RSA |

`lyric` 是最大的单体原生模块，且其功能（桌面悬浮歌词）在 iOS 上**根本没有对等实现**（iOS 无系统级悬浮窗），这一点与选什么语言无关。

---

## 2. Rust 收益最明确的一层：musicSdk（10,040 行）

这是全项目**唯一**适合用 Rust 重写、且重写后确有净收益的部分。理由是实测出来的，不是推断。

### 2.1 耦合度极低

`src/utils/musicSdk` 共 76 个 `.js`/`.ts` 文件，**只有 3 个引用 `react-native`**：

| 文件 | 引用内容 | Rust 侧对应 |
|---|---|---|
| `musicSdk/utils.js:1` | `stringMd5` from `react-native-quick-md5` | `md-5` crate |
| `musicSdk/wy/utils/crypto.js:2` | `btoa` from `react-native-quick-base64` | `base64` crate |
| `musicSdk/kw/util.js:1` | `BackgroundTimer`（**已注释掉**） | 无需 |

也就是说，这 10,040 行业务逻辑对宿主环境的依赖，全部是 **md5 / base64 / AES / RSA 这类纯计算**。在 Rust 里这些是标准生态（`md-5`、`base64`、`aes`、`rsa` crate），不需要任何平台桥。

**移植到 Rust 后，这一层从「依赖 5 个原生模块」变成「零原生依赖」。** 这是方向性的收益，不是边际优化。

### 2.2 顺带消除 ios-support-plan 中最危险的坑

[ios-support-plan.md §3.2](./ios-support-plan.md) 花了大量篇幅处理一个陷阱：Java 的 `Cipher.getInstance("AES")` 会被 JCE 默认补全为 `AES/ECB/PKCS5Padding`，导致名为 `ECB_128_NoPadding` 的枚举**实际带 PKCS5 填充**。iOS 侧若照字面实现 `NoPadding` 就会产生不兼容的密文，且该错误只在特定长度明文上暴露。

Rust 侧不存在这个陷阱：`aes` + `block-padding`（或 `cbc`/`ecb` crate）要求**显式指定**填充类型，没有「默认补全」这种行为。加密模式在类型系统里就是明确的：

```rust
// 填充必须写出来，写错了编译不过，不存在 Java 那种隐式默认
type Aes128EcbEnc = ecb::Encryptor<aes::Aes128>;
let ct = Aes128EcbEnc::new(key.into()).encrypt_padded_vec::<Pkcs7>(pt);
```

同理，[ios-support-plan §4.2.2](./ios-support-plan.md) 的 gzip 格式坑（`COMPRESSION_ZLIB` 产 raw DEFLATE 而非 gzip）在 Rust 侧也消失 —— `flate2` 的 `GzEncoder` / `DeflateEncoder` 是两个不同类型，不会混淆。

**这是「用 Rust 重写核心逻辑」最有说服力的技术论据**：它把一类「靠人记住平台默认行为」的隐性正确性问题，转成了编译期可检查的显式声明。

### 2.3 正则不是障碍（原先担心的一点）

Rust 的 `regex` crate 不支持 lookahead / lookbehind / 反向引用，这通常是 JS→Rust 移植的头号阻力。实测结果比预期好得多：

| 特性 | 出现次数 | 影响 |
|---|---|---|
| 真实正则调用（`replace(/`、`match(/`、`test(/`、`split(/`） | 127 | 绝大多数是字面匹配与捕获组，`regex` crate 直接支持 |
| lookahead / lookbehind | **1 处** | `musicSdk/kw/util.js:34` |
| 反向引用 `\1`-`\9` | **0** | 无 |

唯一的特例是 `kw/util.js:34`，一个把单引号 JSON 转双引号的 hack：

```js
JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"'))
```

处理方式：改用 `fancy-regex` crate（支持 lookaround，代价是可能回溯）或手写一个小状态机。**1 处特例不构成路线障碍。**

### 2.4 需要注意的移植成本

不能只讲好处。这一层真实的移植成本在于：

- **弱类型转强类型**：173 处动态属性访问（`obj[var]`）、41 处 `JSON.parse/stringify`、114 处可选链/空值合并。第三方音乐 API 的响应字段经常缺失或类型不定，JS 里 `a?.b?.c ?? d` 一行搞定，Rust 里要定义 `serde` 结构体并处理 `Option` 嵌套。**这部分代码量通常会膨胀 1.5-2 倍**，且要为每个音源的每个接口定义响应类型。
- **好消息**：`eval` / `new Function` 使用次数为 **0**，不存在无法静态化的动态代码。
- 6 个音源（bd 588 / kg 2,907 / kw 1,760 / mg 1,718 / tx 1,257 / wy 1,470 行）各有独立的加密与签名逻辑，需逐个验证。这类代码**一旦行为不一致就是「搜不到歌」这种用户可见故障**，必须有黄金向量测试兜底 —— 与 ios-support-plan 的 Phase 1.0 是同一个需求。

---

## 3. Rust 移动端 GUI 框架成熟度：路线 B 的决定性一节

这一节决定「Rust 全栈重写（含 UI）」是否成立。结论：**不成立**。

### 3.1 生态整体定调

[Are We GUI Yet](https://areweguiyet.com/) 官方原文：

> *"The roots aren't deep but the seeds are planted"*，*"there is little consensus on what the best abstractions are"*；想要成熟方案的人 *"will most likely find themselves out of luck"*

### 3.2 逐框架实测

以下 issue 状态均经 GitHub API 确认真实 state，非搜索摘要推断。

| 框架 | 移动端定位 | 实测关键证据 |
|---|---|---|
| **Slint** | iOS/Android 均有支持 | 许可证是**三选一**（见 §3.5）；生产案例全为**企业 HMI**（OTIV 轨道自动化、SK Signet 充电桩、WesAudio 音频硬件），**未见消费级 App Store/Google Play 应用** |
| **Dioxus** | README 有专章 *"First-class Android and iOS support"* | 但 [#5653](https://github.com/DioxusLabs/dioxus/issues/5653)「Missing context menu on Android/iOS and native text-selection toolbar」**确认 open**（2026-06-28 建）；原生渲染器 README 自标 *"Experimental Native Renderer"*，WGPU/Skia 为 experimental，生产路径是 WebView |
| **Tauri v2** | 官方称支持 iOS 9+/Android 7+ | UI 是系统 WebView，IME/滚动/无障碍继承平台栈 ✅；但 Discussions 的 "Show and Tell" 生产案例**全是桌面应用** |
| **egui/eframe** | eframe README 只列 *"Web, Linux, Mac, Windows, and Android"* —— **无 iOS** | [#8052](https://github.com/emilk/egui/issues/8052)「iOS crash at startup with v0.34.1」**确认 open**（2026-04-01 建，至今未解决） |
| **Xilem/Masonry** | Android 有 `masonry_android_view`，CI 编 aarch64-linux-android | README 自述 **"not yet generally usable"**；iOS 无官方支持 |
| **iced** | ❌ **移动端不在官方支持列表**（Windows/macOS/Linux/Web） | 自述 *"currently experimental software"* |
| **Makepad** | 有 `cargo makepad apple ios` / `android` 工具链 | 官方平台文档页 404，成熟度**无法查证** |
| **freya** | Skia 驱动，3,030 star，活跃（2026-08-23 push） | README 中 Android 仅出现在**致谢一位贡献者**（*"for contributing support for Android"*），**iOS/mobile 提及 0 次** |

> ⚠️ 需要说明一处：网上流传 Dioxus README 写有 "Mobile (iOS/Android) - alpha" 字样。**实测 README 全文 `alpha` 出现 0 次**，该引述不成立。Dioxus 官方口径其实相当积极（"First-class"）。判断其移动端不成熟应依据上面那条 open issue 与 experimental 渲染器，而不是伪造的引述。

### 3.3 关键功能缺口：无障碍的真实状况

Rust GUI 的无障碍统一由 [AccessKit](https://github.com/AccessKit/accesskit) 提供。它**确实有**移动端 adapter（README 原文）：

> *"[Android adapter]: This adapter implements the Java-based Android accessibility API."*
> *"[iOS adapter]: This adapter implements the UIAccessibility protocols in the UIKit framework."*

所以「Rust 无障碍未实现」不准确。但把版本号和下载量放在一起看，差距非常清楚（crates.io 实测，均 2026-07-14 更新）：

| Adapter | 版本 | 累计下载 |
|---|---|---|
| `accesskit_windows` | **0.34.0** | **10,961,931** |
| `accesskit_macos` | **0.26.3** | **10,837,019** |
| `accesskit_ios` | **0.1.2** | 114,862 |
| `accesskit_android` | 0.7.5 | **29,233** |

**桌面 adapter 已迭代到 0.26～0.34 且千万级下载；iOS adapter 还是 0.1.2，Android 仅 2.9 万下载 —— 相差约三个数量级。** 基础设施存在，但移动端实战检验量极小。

这对本项目是实际风险：App Store 审核关注无障碍，且这是个有搜索框、登录表单、长列表的消费级应用。

### 3.4 其余功能缺口

| 能力 | 本项目为何需要 | Rust GUI 现状 |
|---|---|---|
| **中文 IME / 软键盘** | 搜索框、登录表单 | Dioxus 有 open 的文本选择工具栏缺失 issue；egui IME 支持不完整；仅 WebView 路线（Tauri）天然继承系统 IME |
| **长列表虚拟化 + 原生滚动惯性** | 歌单可达数千首 | egui 支持；Dioxus 未查到虚拟化方案；WebView 路线取决于前端框架 |
| **渐变 / 模糊 / 圆角卡片 / 换肤** | 现有 UI 大量使用，且有完整主题系统（§1.1） | 需手写 shader 或依赖实验阶段的 wgpu/Skia 后端 |

### 3.5 Slint 的许可证需要单独说明

实测 `LICENSE.md` 原文：

> *"You can use the Slint framework under **any** of the following licenses, at your choice"* —— Royalty-free License / GPLv3 / Commercial

其中 Royalty-free 一项原文 *"Permits use in **proprietary** desktop, mobile, and web applications"*。

**所以 Slint 不是 GPL 独占**，闭源商用有合法路径。但本项目是 Apache-2.0 开源项目，这一点不构成障碍 —— 列出只为避免「Slint 就是 GPL 不能用」的误判。

### 3.6 三平台同时支持：0 个

**没有任何 Rust GUI 框架同时官方支持 Android + iOS + HarmonyOS。** 这与 §8.3 的实测一致（所有框架的鸿蒙支持均为未合并 PR）。

### 3.7 本节结论

| 判断项 | 结论 |
|---|---|
| 有无生产级 Rust 移动 GUI 方案 | ❌ 无 |
| 有无消费级上架应用先例 | ❌ **未查到任何一个** |
| Slint 的生产案例性质 | 企业 HMI / 工业控制，**不是消费级 App** |
| 三平台统一 | ❌ 0 个框架 |
| 基础交互（IME、虚拟化、无障碍） | ⚠️ 均有缺口，移动端检验量极小 |

**路线 B（Rust 全栈含 UI）不成立。** 选它等于让本项目去给框架做移动端验证 —— 而这个项目要重写的是 24,773 行已经能正常工作的 TSX。

> 唯一在移动端「UI 能力没有短板」的 Rust 路线是 **Tauri v2 / WebView 系** —— 因为 UI 根本不由 Rust 渲染，而是 WebView。但那样一来，就只是把 React Native 换成了另一种 Web 技术栈，**UI 层仍是 JS/HTML**，并没有实现「用 Rust 写 UI」。这恰好印证 §6.3 的判断。

---

## 4. 用户源沙箱：JS 引擎躲不掉，但这一层意外地不是难点

### 4.1 为什么 Rust 重写后仍必须内嵌 JS 引擎

用户自定义音源是**产品功能**，不是内部实现：用户导入一段 JS 脚本，App 在沙箱里执行它来获取播放链接。这段脚本由第三方社区编写和分发，其接口是**公开契约**（`preload:523` 自报 `version: '2.0.0'`、`env: 'mobile'`）。

所以无论用什么语言重写宿主，都必须：

1. 继续执行 JS（不能要求社区把存量脚本改写成 Rust/WASM）
2. **逐字节兼容现有注入契约**，否则存量第三方脚本全部失效

这条约束与选 Rust 无关，是产品约束。**「用 Rust 就能摆脱 JS」不成立。**

### 4.2 关键事实纠正：Android 现在用的就是 QuickJS，不是 WebView

实测 `android/app/build.gradle:196`：

```gradle
implementation 'wang.harlon.quickjs:wrapper-android:2.4.0'
```

调用链是 `UserApiModule` → `JavaScriptThread`（独立 `HandlerThread`）→ `QuickJS.java`（220 行）→ `QuickJSContext`。**不涉及 WebView。**

这个事实改变了本节的性质：Rust 侧要做的不是「引入一个新引擎」，而是**换一套绑定去驱动同一个引擎（QuickJS）**。引擎行为一致性风险因此大幅低于 iOS 方案 —— 那边选 JavaScriptCore，是真的换了引擎（见 [ios-support-plan.md](./ios-support-plan.md) §3.3.4 列出的行为差异风险）。

**这是 Rust 路线相对 iOS 现方案的一个潜在优势**：Android 与 Rust 侧可以共用 QuickJS，跨端脚本行为天然一致。

> ⚠️ **但这个优势有前提**：Rust 侧唯一可用的绑定 `rquickjs` 绑的是 **QuickJS-NG 分叉**，而 `wang.harlon.quickjs` 基于哪个分支未查证（见 §8.9）。若两端分属不同分叉，一致性优势会打折。**这是需要实测确认的前提，不是已确认的结论。**

### 4.3 契约面很小，且只用到基础语言特性

必须复刻的注入项（来自 `QuickJS.java:55-130`，7 个 native 函数）：

| 注入项 | 用途 | Rust 侧实现难度 |
|---|---|---|
| `__lx_native_call__` | JS→native 总入口（带 key 校验） | 低 |
| `utils_str2b64` | Base64 编码 | 低（`base64` crate） |
| `utils_b642buf` | Base64 解码为整数数组字符串 | 低 |
| `utils_str2md5` | URLDecode + MD5 | 低（`md-5` + `percent-encoding`） |
| `utils_aes_encrypt` | AES 加密 | 低，且**顺带消除 §2.2 的 JCE 隐式填充坑** |
| `utils_rsa_encrypt` | RSA 加密 | 中（`rsa` crate，需对齐填充模式） |
| `utils_set_timeout` | 定时器（native 侧调度） | 中（需与 async runtime 集成） |
| `console` 注入 | 日志回传 | 低 |

`preload.js`（594 行）**对引擎的全部特性依赖**（去注释后实测）：

| 特性 | 用量 | | 特性 | 用量 |
|---|---|---|---|---|
| `Proxy` | 1 | | `Reflect` | **0** |
| `Object.getOwnPropertyDescriptors` | 2 | | `Symbol` | **0** |
| `Promise` | 4 | | `BigInt` / `WeakRef` / `WeakMap` | **0** |
| `Uint8Array` / `ArrayBuffer` | 6 / 2 | | `async` / `await` | **0** |
| `Map` / `Set` | 2 / 1 | | `??` / `?.` | **0** |
| | | | `TextDecoder` | **0** |

**全部是 ES2015 基础特性**，QuickJS 完整支持。没有任何需要现代引擎的用法。

> ⚠️ 但 `preload.js` 只是宿主侧。**第三方脚本本身可能用到任意 ES 特性**（常见是混淆压缩产物）。这部分无法静态排除 —— 不过由于两端同为 QuickJS，风险等同于现状，不是 Rust 引入的新问题。

### 4.4 沙箱加固逻辑要原样保留

`preload.js:530-591` 的加固手段（这些在 JS 侧实现，Rust 只需保证引擎能跑）：

- `freezeObject(globalThis.lx)` 递归冻结
- 覆写 `Function.prototype.toString` 伪装 `[native code]`
- `globalThis.eval` 抛异常
- **`Function` 构造器被 `Proxy` 拦截**，`apply`/`construct` 均抛 `Dynamic code execution is not allowed.`
- `freezeObjectProperty(globalThis)` 把全局对象所有属性置为 `writable: false, configurable: false`
- 注入前 `delete` 掉所有 `__lx_native_call__*` 全局引用，只保留闭包捕获

**注意 §2.4 提到的「0 个 eval / new Function」指的是 musicSdk 自身**；这里 preload 主动禁掉动态执行是**安全设计**，两件事不矛盾。

### 4.5 一个现状边界：没有真正的执行中断

`src/core/init/userApi/index.ts:52` 的超时用 `BackgroundTimer.setTimeout`，是**协作式**的 —— 它只在请求层面计时，**无法中断一个死循环的 JS 脚本**。`wang.harlon.quickjs:wrapper-android` 未暴露 interrupt handler。

**Rust 侧反而可能改善这点**：QuickJS 原生提供 `JS_SetInterruptHandler`，Rust 绑定若暴露该能力，就能获得现状没有的真正中断。但这属于**可选增强，不是对等性要求** —— 现状没有，不补也不构成退化。

### 4.6 本节结论

| 维度 | 判断 |
|---|---|
| 能否去掉 JS | ❌ 不能，产品约束 |
| 引擎一致性风险 | ✅ **低**（两端同为 QuickJS，优于 iOS 方案的 JSC 路线） |
| 契约复刻工作量 | 低 —— 7 个函数 + console，全是纯计算 |
| 需要的引擎特性 | 全部 ES2015 基础特性，QuickJS 足够 |
| Rust 侧净新增风险 | 主要在 async/定时器与 Rust runtime 的集成 |

**这一层不是 Rust 路线的阻力点。** 具体 crate 的成熟度数据见 §8.9。

### rquickjs：能用，但移动端有一个具体的坑

仓库 978 star，MIT，最近 push 2026-08-10。绑定的是 **QuickJS-NG 分叉**（README 原文：*"a high level bindings of the QuickJS-NG JavaScript engine, a fork of the QuickJS"*），非 bellard 原版；两者均 MIT。

**注意这与 Android 现状不完全一致** —— `wang.harlon.quickjs:wrapper-android:2.4.0` 基于哪个 QuickJS 分支未查证。若一端是 NG 一端是原版，§4.2 说的「两端同引擎」优势会打折扣，需要实测确认。这是一个**必须验证的前提**，不是已确认的结论。

**具体的坑**：实测 `sys/src/bindings/` 目录下 17 个预生成 binding 覆盖的 target 里，**没有任何 Android 或 iOS target**（有 apple-darwin、linux-gnu/musl、windows、wasm32-wasi，无 `*-linux-android`、无 `*-apple-ios`）。README 原文：

> *"Rquickjs ships bindings for a limited set of platforms, for these platforms you don't have to enable the `bindgen` feature. In general you can allways try to compile rquickjs with the `bindgen` feature, this should work for most platforms."*

即移动端**必须启用 `bindgen` feature**，因此构建链要额外依赖 libclang 并正确指向 NDK/iOS sysroot。措辞是 *"should work"*，不是「已支持」。这不是阻塞问题，但是一个真实的构建复杂度，且**官方未做移动端 CI 验证**。

**中断能力确认存在**（`core/src/runtime/base.rs` 官方文档注释）：

> *"Set a closure which is regularly called by the engine when it is executing code. If the provided closure returns `true` the interpreter will raise and uncatchable exception and return control flow to the caller."*

```rust
pub fn set_interrupt_handler(&self, handler: Option<InterruptHandler>)
```

这印证了 §4.5：Rust 侧可以拿到 Android 现状**没有**的真正死循环中断。另有独立的 `runtime/async.rs`、`schedular.rs`、`spawner.rs`，async 支持是一等公民而非拼凑。

### 其余引擎为何不适用

| 引擎 | 排除理由 |
|---|---|
| `v8` / rusty_v8 | 有 JIT（TurboFan）。iOS 必须 jitless 构建 —— README 原文 *"iOS denies the JIT entitlement to non-WebKit apps"*。关掉 JIT 后性能优势即消失，却仍背着 V8 的体积。且 issue [#1640](https://github.com/denoland/rusty_v8/issues/1640)「Appetite for Android & iOS Support?」**仍 open**，无官方移动端支持声明。 |
| `boa_engine` | 纯 Rust、无 JIT 是优点，但 README 自标 *"experimental"*。声称 test262 通过率「超 90%」，**具体数字未能验证**（boajs.dev/conformance 打不开）。对一个要兼容存量第三方混淆脚本的场景，一致性数字无法验证就是硬伤。 |
| `deno_core` | 独立仓库已归档并入 deno 主项目，不适合新项目依赖。 |
| Hermes | **无任何 Rust 绑定**，需自写 C++ FFI。且它是 RN 专用引擎 —— 若保留 RN（§7.2 的务实变体），Hermes 本来就在，不需要从 Rust 调它。 |

> ⚠️ **需纠正一条容易误信的说法**：crates.io 上的 `javascriptcore-rs`（1.1.2，2,009 万下载，Tauri 维护）**不是 Apple JavaScriptCore.framework 的绑定**，因此**与 iOS 无关**。实测其 `Gir.toml` 用 GObject-introspection 生成，`sys/Cargo.toml` 的 system-deps 指向 **`javascriptcoregtk-4.1`**，keywords 为 `gtk-rs`/`gnome` —— 这是 **WebKitGTK（Linux）** 的绑定。它那个很高的下载量来自 Tauri 的 Linux 构建，不能作为「Rust 在 iOS 上用 JSC」的证据。iOS 上要用系统 JSC 仍需自写 objc2/FFI 封装。

### 一个信息空白

**所有引擎的 iOS/Android 二进制体积均无实测数据**（官方与社区都查不到）。这与 §8.7 的体积空白是同一个问题：Rust 移动端的体积讨论普遍缺乏可引用的实测基准。

**移动端生产案例：未查到任何公开的「Rust + 内嵌 JS 引擎」上架案例。** 主流做法仍是系统 WebView、系统 JSC/V8，或 RN 的 Hermes。

---

## 5. 音频与后台播放：Rust 方案的最大净损失

这一节的结论与直觉相反：**Rust 在音频领域看似强项（无 GC、DSP 自由），但对「音乐播放器」这个具体场景，换成 Rust 是净亏损。**

### 5.1 唯一可行的技术组合

经查证，Rust 移动端音频只有 `cpal`（输出）+ `symphonia`（解码）一条路可走：

| crate | 最新版 | 移动端支持 | 结论 |
|---|---|---|---|
| `cpal` | 0.18.2（2026-08-16） | README 平台表明确列 Android(AAudio) / iOS(CoreAudio) | 可用，但有坑 |
| `symphonia` | 0.6.1（2026-08-13） | 纯 Rust，平台无关 | 可用 |
| `rodio` | 0.22.2 | **README 完全不提 Android/iOS** | 谨慎 |
| `kira` | 0.12.3 | 自述 "mainly meant for desktop platforms" | ❌ 排除 |
| `awedio` | 0.8.0 | 提 Android，**未提 iOS**，下载量仅 1.5 万 | ❌ 排除 |
| `fon` | 0.6.0（**2022-01-29**） | 已 4 年未更新 | ❌ 排除 |

`cpal` 官方从未对「移动端生产可用」给出正式表态 —— issue #783 "Is it ready for production on Android and iOS?" 唯一的回复是用户反馈「Android 和 iOS 上音量很低，Android 列出重复设备」，该 issue 于 2026-08-17 关闭时**无维护者结论**。

### 5.2 编解码能力的三个实质缺口

`symphonia` 的支持表（官方 README）暴露了对音乐 App 的具体限制：

| 能力 | 状态 | 对本项目的影响 |
|---|---|---|
| MP3 / FLAC / Vorbis / Opus / WAV | Excellent，支持 gapless | ✅ 覆盖主流 |
| **AAC-LC** | Great，但 **无 gapless**，非默认 feature | ⚠️ 见下 |
| **HE-AAC / HE-AACv2** | **未开始实现**（issue #189、#473 均 open） | ❌ 低码率 AAC+ 流解不了 |
| **ISO/MP4 容器** | **不支持 gapless**（issue #544 open） | ❌ m4a 曲库无法无缝播放 |
| ALAC | Great，支持 gapless，**Apache 2.0 免版税** | ✅ 无风险 |

**AAC 专利责任转移（容易被忽略的一条）**：AAC 基线专利要到 **2028 年**才全部到期，扩展部分到 **2031 年**。分发 AAC *内容*免费，但**实现和分发 AAC 编解码器需要专利授权**。这正是 symphonia 把 `aac` 设为非默认 feature 的原因，其 README 明说只默认启用 royalty-free 的编解码器。

对比现状：用 ExoPlayer / AVPlayer 时，AAC 解码由**系统提供**，专利责任在 Google / Apple。**自己编译 symphonia 的 `aac` feature 进 APK/IPA，等于把这个责任移到项目自己身上。** 开源项目风险相对低，但这是一项从「零」变成「非零」的法律成本。

### 5.3 硬边界：系统集成必须写原生代码

这是本节最重要的结论。经多轮检索，**crates.io 上不存在能封装 Android MediaSession / AudioFocus / ForegroundService 的通用 crate**：

- `souvlaki` 0.8.3（Rust 生态最主流的媒体控制 crate，211K 下载）支持平台只有 **Linux/BSD (MPRIS)、macOS/iOS、Windows —— 完全不支持 Android**。且其 `src/platform/` 下**没有 `ios/` 目录**，所谓 iOS 支持是 `macos/mod.rs` 里的几个 `#[cfg(target_os = "ios")]` 分支，**不含 AVAudioSession 配置、后台模式、中断恢复**。最后更新 2025-06。
- `android-activity` crate 文档明确声明自己在 NDK 层，**不提供 MediaSession 这类 Java API 的 Rust 绑定**。
- `ndk` crate 的 `media` 模块只有 `AMediaCodec` / `AMediaFormat` / `AImageReader` —— **没有 AudioTrack，没有 MediaSession**。MediaSession 是 Java-only API，NDK 根本不暴露。

**根本原因（技术性的，不是生态不成熟）**：Android 的媒体控制需要**子类化** `MediaSessionCompat.Callback`，而 **JNI 无法从 Rust 侧创建 Java 子类**（只能靠 `java.lang.reflect.Proxy` 或运行时 dex 生成，两者都更糟）。这个限制不会随生态成熟而消失。

#### 能力归属表

| 能力 | Rust 能做？ | 说明 |
|---|---|---|
| 解码 mp3/flac/ogg/wav/opus | ✅ 干净 | symphonia |
| 混音、音量、EQ、变速、ReplayGain | ✅ 干净 | Rust 最强项 |
| 播放队列、shuffle、repeat | ✅ 干净 | 纯业务逻辑 |
| 流式下载 + seek + 缓存 | ✅ 干净 | `stream-download`，见 §5.4 |
| 解码 AAC-LC / ALAC | ⚠️ 需开 flag | AAC 有专利责任，无 gapless |
| iOS 中断处理（来电/Siri） | ✅ cpal 已内置 | `session_event_manager.rs`（PR #1295，2026-07-30） |
| iOS 锁屏信息/封面/耳机控制 | ⚠️ 绑定齐全 | `objc2-media-player` 0.3.2 |
| **iOS 后台音频（`UIBackgroundModes`）** | ❌ | **Info.plist 配置，不是 API** |
| **iOS `AVAudioSession` category/激活时机** | ❌ 时机躲不开 | cpal 自己从不设 category，官方示例在 **ObjC AppDelegate** 里设 |
| **iOS CarPlay** | ❌ | entitlement + scene delegate；`objc2-car-play` 仅 1,521 次下载，**无生产验证** |
| **Android ForegroundService** | ❌ | Java-only，必须写 Service 子类 |
| **Android MediaSession callback** | ❌ | **必须 Java 子类化，JNI 做不到** |
| **Android 通知栏 MediaStyle** | ❌ | `Notification.MediaStyle`，Java-only |
| **Android AudioFocus** | ❌ | 需 Java 监听器实现 |
| **Android Auto** | ❌ | `MediaBrowserServiceCompat`，纯 Java 架构 |
| **蓝牙插拔后保持播放状态** | ❌ **无方案** | rodio #836 至今 open，见 §5.5 |

### 5.4 唯一的真实技术优势：流式播放

`stream-download` 0.24.3（2026-08-02）是 Rust 方案里最有说服力的一段：提供「可读 + 可 seek」的 source，后台下载同时允许读取与跳转；存储后端可选临时文件 / 内存 / bounded 环形缓冲 / adaptive；与 `rodio` 配套，官方示例含 `basic_http.rs`、`adaptive.rs`、`infinite_stream.rs`。

它正好填上 `symphonia` 的 `MediaSource` trait（只要求 `Read + Seek + Send + Sync`，**无内建 HTTP 支持**）。完整链路 `reqwest → stream-download → symphonia MediaSource → 解码 → cpal` 对在线音乐场景确实比 ExoPlayer 的缓存机制更可控。

**限制**：官方 README 说下载进行中 seek 可能触发流重启；内容长度未知时（直播流）从末尾 seek 会失败；**README 不提 Android/iOS，无移动端验证声明**。

### 5.5 三个具体的回归风险

1. **蓝牙耳机插拔导致播放状态全丢**。rodio issue #836（2026-01 开，**至今 open，无官方推荐方案**）：Android 上音频设备变化会使 `OutputStream` 失效，重建 `Sink` 会丢失队列、音量、播放位置。**这是音乐 App 的日常场景**，ExoPlayer 已经处理好了。
2. **功耗变差**。ExoPlayer 走 MediaCodec **硬件解码**，symphonia 是纯软解。对手机音乐 App，**电池比 GC 抖动重要得多**。这是净损失。
3. **cpal 在 Android 上的 buffer 行为不可靠**：请求 `BufferSize::Fixed(480)` 实际得到 64~960 帧抖动；上报的最小 buffer size 约 40,000 samples（≈1 秒延迟）。既拿不到确定的低延迟，又要自己处理抖动。另有 issue #563（2020 开，**未修**）`dlopen failed: cannot locate symbol "__cxa_pure_virtual"`，需手动打包 `libc++_shared.so`。

补充一条：cpal 的 `realtime` feature（提升音频回调线程优先级）平台列表是 **Android、Linux、Windows —— 不含 iOS**。而且音乐播放本身不是低延迟场景，这个优势对本项目基本用不上。

### 5.6 三个真实案例的一致结论

我找到 3 个 Rust 写的移动端音乐播放器，**全部不是 Rust 全栈，全部留了 Kotlin**：

| 项目 | 技术栈 | 语言构成 | 关键发现 |
|---|---|---|---|
| **Kopuz**（Dioxus） | cpal + symphonia | Rust 3.7M / **Kotlin 57K** | Android 集成 = **926 行 Rust JNI + 491 行 Kotlin**；iOS 无系统集成 |
| **Fluyer**（Tauri 2） | **BASS**（闭源商业库） | Rust 291K / **Kotlin 46K** / Swift 2.4K | 放弃 cpal/rodio 选了收费库；**无 ForegroundService**，后台播放大概率不可靠；iOS 实质无媒体集成 |
| **perry** | 纯 JNI 调 MediaSessionCompat | Rust 59M / Kotlin 244K / Java 6.7K | 即使极度 Rust-first，**仍需 Java helper 类**才能收到耳机按键回调 |

**Kopuz 是最好的参照系**：926 行 Rust JNI + 491 行 Kotlin，换来的正是 Android 的 MediaSession + AudioFocus + ForegroundService + 通知栏 —— 而这些 `react-native-track-player` 已经免费提供了。

Kopuz 的 Kotlin 代码里有一条典型的平台知识，说明这类细节 Rust 层无法替你处理：

```kotlin
// Must call startForeground within 5s of startForegroundService regardless of
// play state, or the system kills us with a ForegroundServiceDidNotStartInTime.
```

另外两个信号：`tauri-plugin-native-audio` 的语言构成是 **Swift 52K / Kotlin 33K / Rust 1.1K** —— 「Rust 移动音频插件」的实现 98% 是 Swift 和 Kotlin。`tauri-plugin-media-session`（唯一声称同时支持 Android+iOS 的 crate）**仅 728 次下载，iOS 标记 WIP，且仍要你自己改 Info.plist**。

**未查到任何 Rust 全栈、已上架 App Store 或 Google Play 的音乐播放器。** Fluyer（41 stars）和 Kopuz（1 star）都是 GitHub Releases 分发。

### 5.7 本节结论

| 层 | 现状（RNTP） | Rust 方案 | 净变化 |
|---|---|---|---|
| 解码/输出 | ExoPlayer/AVPlayer 免费给 | symphonia + cpal 自己踩坑 | ⬆️ 工作量增，功耗差，gapless 差 |
| 流式/缓存 | ExoPlayer 缓存 | stream-download，更可控 | ➡️ 略有收益 |
| DSP/EQ/变速 | 受限 | 自由度高 | ⬆️ **真实收益** |
| Android 媒体集成 | RNTP 免费给 | **Kotlin 491 + Rust JNI 926 行**（Kopuz 实测） | ⬆️⬆️ 大幅增加 |
| iOS 后台/锁屏/CarPlay | RNTP 免费给 | Swift + objc2，无成熟参照 | ⬆️⬆️ 大幅增加 |
| 蓝牙插拔状态保持 | ExoPlayer 处理 | **无方案**（rodio #836） | ⬆️⬆️⬆️ 功能回归 |
| AAC 专利责任 | 在 Google/Apple | **转移到项目** | ⬆️ 法律成本 |

**Rust 版 = 现有原生代码量 + Rust 代码量 + AAC 专利责任 + 蓝牙状态丢失 + 更高功耗。** 原生代码不会减少，只会因多了 FFI 桥而增加。

**建议**：不替换播放层。若确有 DSP 需求（自定义 EQ、精确 ReplayGain、可视化 FFT），可行的是**混合方案** —— 保留 `react-native-track-player` 处理全部系统集成与播放，把纯计算部分（音频分析、格式转换、元数据解析）做成 Rust native module。拿到 Rust 的实际好处，不碰系统集成这堵墙。

---

## 6. 与现有 iOS 方案的正面对照

这是本报告最该被先看的一节：**如果诉求是「让 iOS 能用」，Rust 重构与现有方案不在同一个量级上。**

### 6.1 锚点

[ios-support-plan.md](./ios-support-plan.md) 的方案是在现有 RN 架构上补 iOS：

| 项 | 现有 iOS 方案 |
|---|---|
| 工期 | **21-33 天（约 4-7 周）** |
| 新增代码 | 约 1,600 行 Objective-C（4 个原生模块）+ 约 290 行 TS 平台后缀文件 |
| 修改点 | 约 20 处 |
| 61,667 行业务代码 | **零改动**，直接复用 |
| 23,760 行 UI | **零改动**，直接复用 |
| 风险 | 已逐条登记（R1-R6，含 2 个新增子项） |

### 6.2 两条 Rust 路线的对照

| | 现有 iOS 方案 | 路线 A：Rust 核心 | 路线 B：Rust 全栈 |
|---|---|---|---|
| UI 命运 | 复用 | **iOS 从零写 SwiftUI，Android 从零写 Compose** | 押注 Rust GUI（见 §3） |
| 业务逻辑 | 复用 | 重写 ~25,000 行为 Rust | 重写 ~25,000 行为 Rust |
| 状态层 551 行 hook | 复用 | 按平台重写 | 重写 |
| 播放层 | 复用 RNTP | 见 §5：净亏损 | 见 §5：净亏损 |
| 用户源沙箱 | JSC 实现（已规划） | 仍需嵌 JS 引擎（见 §4） | 仍需嵌 JS 引擎 |
| 桌面歌词 | iOS 桩化（无对等能力） | 同样无解 | 同样无解 |
| 业界先例 | RN 官方支持 iOS | Signal / 1Password / Mozilla | **无** |
| 量级 | 4-7 周 | **数量级更大** | 不可估（框架风险） |

### 6.3 一个关键的认知纠正

**路线 A 并不解决「支持所有平台」这个原始诉求。**

路线 A 的本质是「把跨平台复用的边界从 UI 层下移到业务逻辑层」。它让业务逻辑只写一遍，但 **UI 要按平台数量各写一遍** —— 这正是 1Password 的做法：Rust 核心 + iOS/macOS SwiftUI + Android 原生 View + Windows/Linux Electron，四套 UI。

所以对本项目：

- 想让 iOS 有界面 → 路线 A 下仍要写一套完整 iOS UI（23,760 行 tsx 的等价物）
- 想让 HarmonyOS 有界面 → 再写一套 ArkUI
- 想让桌面有界面 → 桌面版已是独立的 Electron 项目（lx-music-desktop）

**RN 现有架构在「UI 复用」这件事上，恰恰比路线 A 更强。** Rust 的优势在业务逻辑复用，而这个项目的业务逻辑本来就已经在 JS 里复用了（Android/iOS 共享同一份）。

换句话说：**路线 A 解决的问题（业务逻辑跨平台复用）在本项目中并不存在** —— RN 已经解决了。它真正能带来的是「类型安全 + 性能 + 消除原生桥」，而不是「跨平台」。

### 6.4 什么情况下 Rust 才划算

综合前面各节，Rust 在本项目的收益集中在一处：**musicSdk 的正确性与可维护性**（§2）。如果出现下列情况之一，值得考虑把它抽成 Rust 库：

1. **多端逻辑漂移成为实际痛点** —— 桌面版（lx-music-desktop，独立 Electron 项目）与移动版的音源代码已经分叉，同一个音源接口变更要改两处且行为不一致。这时把 musicSdk 做成 Rust 库 + UniFFI 绑定，桌面走 napi-rs，移动走 Kotlin/Swift 绑定，是标准解法。
2. **加密/协议正确性反复出问题** —— 见 §2.2，Rust 的显式填充能从类型层面消除一类 bug。
3. **有明确的 DSP 需求** —— 自定义 EQ、精确 ReplayGain、可视化 FFT（§5.7）。

**这三条都不要求重写 UI，也不要求动播放层。** 这是与「全量重构」完全不同的投入规模。

---

## 7. 工作量推算

### 7.1 推算口径说明

以下不给具体天数，只给**相对量级**。理由：Rust 移动端缺少可靠的生产力基准数据（§8 会说明编译时间与热重载的实测数据都查不到），给出精确天数会是伪精确。

推算基于 §1.2 的分组，并采用「重写行数 × 语言膨胀系数」的粗口径。JS→Rust 的膨胀主要来自弱类型转强类型（§2.4 实测：173 处动态属性访问、41 处 JSON 处理、114 处可选链），经验系数取 1.5-2。

### 7.2 路线 A：Rust 核心 + 各平台原生 UI

| 工作项 | 输入规模 | 产出估算 | 说明 |
|---|---|---|---|
| musicSdk → Rust | 10,040 行 JS | 15,000-20,000 行 Rust | 6 个音源逐个验证，需黄金向量 |
| core + plugins/sync + event → Rust | ~8,400 行 | 12,000-17,000 行 Rust | 同步协议须与桌面端互通 |
| utils 纯逻辑 → Rust | **1,077 行**（实测，见下） | 1,600-2,200 行 Rust | `listManage.ts` 329 行是歌单管理核心 |
| UniFFI 绑定层 | — | 1,000-2,000 行 | 含 Kotlin/Swift 两侧胶水 |
| **iOS UI 从零写** | 23,760 行 tsx 的等价功能 | **SwiftUI 全量** | 87 个设置页 + 横竖屏双份 |
| **Android UI 从零写** | 同上 | **Compose 全量** | 或保留现有 RN UI（见下） |
| 状态层 | 551 行 hook + 33 事件 | 按平台重写 | 状态本体可保留为 Rust |
| 播放层 | — | §5：Kotlin 491 + JNI 926（Kopuz 实测） | 或保留 RNTP |
| 桌面歌词 | 1,942 行 Java | Android 保留，iOS 无解 | 与语言无关 |

`src/utils` 的可移植边界是实测出来的（按是否 `import react-native` 或 `nativeModules` 划分）：

| 类别 | 行数 | 代表文件 |
|---|---|---|
| **纯逻辑，可直接移植** | **1,077** | `listManage.ts` 329、`common.ts` 244、`index.ts` 200、`log.ts` 121、`lrcTools.ts` 98 |
| 依赖 RN，需拆分或保留 | 2,008 | `data.ts` 584、`tools.ts` 575、`request.js` 227、`scroll.ts` 152、`version.js` 123 |

其中 `request.js` 只有 227 行、用标准 `fetch` + `AbortController` + 超时、无自定义 TLS 处理，Rust 侧 `reqwest` 直接对等，移植风险低。

**一个务实变体**：路线 A 不必同时换 UI。可以只把业务逻辑抽成 Rust 库，**UI 继续用 RN** —— 通过 UniFFI 生成 Kotlin/Swift 绑定，再包一层 RN native module。这样：

- 业务逻辑单一份 Rust，两端共享 ✅
- UI 23,760 行继续复用 ✅
- 播放层继续用 RNTP ✅
- 代价：多了一层 FFI 桥（RN ↔ 原生 ↔ Rust），调试链路变长

**这个变体是本报告认为唯一值得认真考虑的 Rust 方案**，它与 §6.4 的三个触发条件对应。

### 7.3 路线 B：Rust 全栈

工作量无法可靠估算，因为它取决于所选 GUI 框架能否支撑以下清单 —— 而这正是 §3 要回答的问题：

- 87 个设置页（平均 60 行，细碎但量大）
- 13 处虚拟化长列表（`FlatList`/`SectionList`，歌单可达数万条）
- 16 个内置主题的运行时切换 + 自定义主题
- 3 种语言的 i18n（516 个 key）
- 横竖屏双份布局（4,166 行）
- 16 个文件使用 `Animated` 动画
- 中文输入法（搜索框）
- 无障碍支持

**在 §3 的框架成熟度结论出来之前，任何路线 B 的工作量数字都是猜测。**

---

## 8. 「所有平台」的实际范围与逐平台可行性

### 8.1 先界定范围

README 明确写着「已支持的平台：Android 5 及以上」，并注明「**目前没有计划支持 iOS 和 HarmonyOS NEXT**」，桌面版是**独立项目**（lx-music-desktop，Electron）。

所以「支持所有平台」的真实范围是四端：

| 平台 | 现状 | Rust 编译可行性 | **UI 可行性** |
|---|---|---|---|
| Android | ✅ 已支持 | ✅ Tier 2 | 现有 RN UI |
| iOS | ❌ 无 | ✅ Tier 2 | 见 §3 |
| **HarmonyOS NEXT** | ❌ 无 | ✅ Tier 2 with Host Tools | ❌ **必须 ArkTS**，见 §8.3 |
| 桌面 | 独立 Electron 项目 | ✅ **Tier 1** | 桌面 Rust GUI 相对成熟 |

### 8.2 Rust target 的官方支持等级（已核对官方文档原文）

数据来自 [Rust Platform Support](https://doc.rust-lang.org/rustc/platform-support.html)（对应 stable 1.98.0）：

| Target | Tier | Host Tools |
|---|---|---|
| `x86_64-pc-windows-msvc` / `aarch64-apple-darwin` / `x86_64-unknown-linux-gnu` | **Tier 1** | ✅ |
| `aarch64-unknown-linux-ohos` / `armv7-unknown-linux-ohos` / `x86_64-unknown-linux-ohos` | **Tier 2 with Host Tools** | 部分 |
| `aarch64-linux-android` / `armv7-linux-androideabi` | Tier 2 without Host Tools | ❌ |
| `aarch64-apple-ios` / `aarch64-apple-ios-sim` / `x86_64-apple-ios` | Tier 2 without Host Tools | ❌ |

**一个必须理解的区别**（官方定义原文）：

- Tier 1 = *"guaranteed to work"*，*"automated testing ensures that each tier 1 target builds and passes tests after each change"*
- Tier 2 = *"Guaranteed to build"*，但 **"Automated tests are not always run so it's not guaranteed to produce a working build"**

**即：移动端和鸿蒙的 Rust target，官方只保证「编译得过」，不保证「跑得对」。** 桌面三平台才是 Tier 1。这个差异对「把核心逻辑押给 Rust」的决策有实质影响 —— 移动端出现 target 特有的运行时问题时，官方 CI 不覆盖。

有趣的是**鸿蒙的 Tier 等级反而比 Android/iOS 高**（Tier 2 *with* Host Tools）。晋级 PR 是 [#137011](https://github.com/rust-lang/rust/pull/137011)（2025-03-16 合并）与 [#149139](https://github.com/rust-lang/rust/pull/149139)（2025-11-21 合并）。不过实测 dist manifest 显示实际分发的 host tools 只有 `aarch64` 一个 target，且 `miri`/`llvm-tools` 均不可用 —— 对交叉编译产物的场景无影响。

### 8.3 HarmonyOS NEXT：Rust 能编，但 UI 必须 ArkTS

这是四端里结论最明确的一个，且**与选什么语言无关**。

**编译层没问题。** OpenHarmony ABI（musl libc + libc++，ELF）与 HarmonyOS NEXT 应用的 native 库 ABI 同源，`ohrs` 工具链直接用 DevEco Studio 里的 HarmonyOS NDK 编译，产物直接进 HAP。社区工具链状态：

| 项目 | 版本 | 状态 |
|---|---|---|
| `ohos-rs`（napi-rs 的 fork，Node-API 路线） | `napi-ohos` 1.2.0 / `ohrs` CLI 1.5.0（2026-08-14） | 活跃，236 star，1.0.0 博客称已有多个上架应用在用 |
| `ohos-sys`（openharmony-rs 组织） | 0.9.0 | 覆盖 arkui/ohaudio/drawing 等 30 个模块 |
| `ohos-arkui-binding` | 0.2.5（2026-08-04） | **仍 0.x** |
| `openharmony-rs/arkui-rs` | — | **最后 push 2024-12-04，自述 "still under development"** |

**华为官方的态度要分两层看**：

- **设备/系统开发（南向）**：官方支持 Rust，OpenHarmony 构建系统提供整套 GN 模板（`ohos_rust_shared_library`、`ohos_rust_cargo_crate` 等）+ `cargo2gn`。
- **应用开发（北向）**：**官方不支持 Rust**。NDK 文档定位原文是 *"a toolset that allows you to use **C and C++** code with OpenHarmony"*；DevEco Studio 官网列出的语言是「ArkTS、JavaScript、C/C++」，无 Rust。华为自研的「第三语言」是**仓颉 Cangjie**，不是 Rust。

**UI 层是硬断点。** ArkUI 确实开放了 C API，但官方文档给出两条明确约束：

> *"While ArkTS and the ArkUI declarative framework are recommended for most UI development, use the ArkUI NDK APIs when: You need to dynamically create and mount UI components for bridging to your own UI framework / You aim to reuse C or C++ UI libraries"*

> *"NDK APIs not only strip away the declarative UI syntax such as state management but also **streamline component capabilities** ... **NDK-created UI components must be mounted through ArkTS placeholder components.**"*

即：没有声明式语法、没有状态管理、组件能力是裁剪过的、且必须由 ArkTS 页面挂载入口。

**所有 Rust GUI 框架的鸿蒙支持无一上游合并**（实测 PR 状态）：

| 项目 | 鸿蒙支持状态 |
|---|---|
| winit | [PR #4117](https://github.com/rust-windowing/winit/pull/4117) 2025-02 开，**至今 open**；另一个 PR #4330 已 closed 未合 |
| GPUI（Zed） | [zed#61965](https://github.com/zed-industries/zed/pull/61965) **closed, merged=false** |
| Tauri | [PR #15845](https://github.com/tauri-apps/tauri/pull/15845) **merged=false**，分支已 diverged；主干搜 `ohos` 命中 0 |
| Dioxus | [#5752](https://github.com/DioxusLabs/dioxus/issues/5752)、#4508、#4036 **全部 open**，无官方支持 |
| Slint / egui | 官网与 README **无任何鸿蒙提及** |

**结论：鸿蒙端 = Rust 核心库 + ArkTS UI 单独写一套。** 这与 RN 现在的处境同构 —— 共享的是逻辑，不是 UI。

补充几个 `ohos-rs` 官方记录的实际坑（对评估有用）：鸿蒙 N-API 未对齐 Node.js 的部分包括 **不支持 Symbol**；`napi_create_buffer` 不接受空数组且**「目前无任何规避方案」**；产物体积普遍大于 C++，需开 `lto` + `strip`；其他平台构建的库无法直接用，第三方 native SDK 必须用鸿蒙 SDK 重编；单元测试**强依赖真机运行**。

上架 AppGallery 方面**未查到针对 Rust 的特殊限制**（华为文档站访问失败，无法取原文）。可确认的约束是 ABI 需匹配、须链 `libc++_shared.so`（namespace `__n1`）、ELF 需 code signing。

### 8.4 桌面端：唯一 Rust 真正占优的平台

桌面三平台是 **Tier 1 with Host Tools**，且桌面 Rust GUI 生态明显强于移动端。但要注意：

1. **桌面版已是独立项目**（lx-music-desktop，Electron），不在本仓库内。用 Rust 重写桌面版是另一个项目的决策。
2. 即便在桌面，[Are We GUI Yet](https://areweguiyet.com/) 的整体定调仍保守：*"The roots aren't deep but the seeds are planted"*，*"there is little consensus on what the best abstractions are"*，想要成熟方案的人 *"will most likely find themselves out of luck"*。

### 8.5 工具链现状（移动端）

| 工具 | 最新版 | 状态 |
|---|---|---|
| `cargo-ndk` | 4.1.2（2025-08-09） | ✅ Android 事实标准，578K 下载 |
| `cargo-mobile2` | 0.22.5（**2026-08-17**） | ✅ 最活跃，Tauri 官方维护 |
| `uniffi` | **0.32.0**（2026-06-30） | ✅ 非常活跃，3.6M 下载 |
| `objc2` | 0.6.4 | ✅ **38.8M 下载**，iOS 系统 API 首选 |
| `jni` | 0.22.4 | ✅ **48.1M 下载**，Android 事实标准 |
| `cargo-apk` | 0.10.0（**2023-11-30**） | ⚠️ 事实停滞，且只服务 `NativeActivity`，本就不适用 |
| `xbuild` | 0.2.0（**2022-12-21**） | ❌ 仓库 description 自述 **"(unmaintained)"** |
| `robusta_jni` | 0.2.2（2023-10-30） | ❌ 事实停滞 |
| `duchess` | 0.3.3 | ❌ 实验性，**累计仅 244 次下载** |

**UniFFI 的关键能力与限制**（官方 manual）：语言支持原文 *"UniFFI comes with full support for Kotlin, Swift and Python"*；支持 `async fn` 跨 FFI 与回调接口；**但明确不支持取消** —— *"We don't directly support cancellation in UniFFI even when the underlying platforms do."*，需自己实现 `cancel()` + flag。另一个正面点：源码 `uniffi_core/src/ffi/rustcalls.rs` 用 `panic::catch_unwind` 捕获 panic 转成 `CALL_PANIC` 状态码，**Rust panic 不会直接 abort 进程**。

### 8.6 开发体验会实质退化

这是重写中最容易被低估的成本。

**Dioxus Subsecond** 是目前唯一真正的 Rust 移动端热补丁方案（crate `subsecond` 稳定版 0.7.10）：

- 支持 Android（arm64-v8a / armeabi-v7a）与 iOS arm64，但**官方原文明确**：*"iOS device is currently not supported due to code-signing requirements"* —— **iOS 只能用模拟器**。
- 配套 ThinLink 链接器宣称增量构建**可低于 500ms**。
- 限制：**不能热补丁 struct 布局变更**（改布局后调用旧版 struct 的新函数会崩溃）；被补丁 crate 的 thread-local 会重置为初值。

对比现状：RN 的 Metro + Fast Refresh 是亚秒级、保状态、真机可用、无布局变更限制。**Rust 侧最好情况（Dioxus + 模拟器）能接近，但 iOS 真机直接不可用，改 struct 就要重启。** 这是确定发生的退化。

**编译时间的权威实测数据查不到** —— 只能确认 ThinLink 宣称的 <500ms 增量和 Tauri 文档承认的首次构建「several minutes」。不编造具体数字。

### 8.7 体积、审核、崩溃上报

**体积**：Rust vs RN（Hermes + RN framework）的官方实测对比数据**查不到**。RN 官方 Hermes 文档只有定性说法 *"smaller app size when compared to JavaScriptCore"*，无具体数字。可确认的是 Rust 侧的优化手段（`strip`、`opt-level="z"`、`lto`、`panic="abort"`）以及体积代价的真实来源 —— 本项目 `reactNativeArchitectures` 配了 4 个 ABI，Rust 静态库会按同样倍数放大。

**App Store 审核**：未发现 Rust 产物本身被拦截的报告。两条具体信息：

- Apple 的[第三方 SDK 清单](https://developer.apple.com/support/third-party-SDK-requirements/)（94 个需要 privacy manifest + 签名的 SDK）中**没有 Rust 及任何 Rust 库**；而**本项目现用的 `hermes` 在清单里**。
- bitcode 曾是 Rust on iOS 的历史痛点（rustc 不产出 Apple 要求的格式），其废弃后问题自然消失。但**这条我没能取到 Apple 一手原文**（官方页面正文抓取失败），不作为已验证结论。

**崩溃上报：路径存在，但没有一家把 Rust 列为受支持路径。**

- Sentry Rust SDK 0.49.1 自动捕获 panic，但**文档完全未提及 Android/iOS/mobile**。
- Sentry Android NDK 与 Firebase Crashlytics NDK 都支持原生崩溃，但文档聚焦标准 NDK 的 C/C++，**未表态支持其他原生语言**。Crashlytics 还**要求二进制含 GNU build ID**（`readelf -n` 可验证），这是个具体的待验证点。
- 实际结论：按「C/C++ 原生库」对待并自行验证符号化，属于需要自行投入的集成工作，不是开箱即用。

### 8.8 真实案例：核心库有先例，全栈没有

**Rust 做核心库 —— 三个一手案例：**

| 项目 | Rust 负责 | UI |
|---|---|---|
| **Signal**（[libsignal](https://github.com/signalapp/libsignal)） | 协议与密码学（Double Ratchet、AES-GCM、零知识证明）。原文 *"used by the Signal client apps (Android, iOS, and Desktop) as well as server-side"* | **明确不用于 UI**，经 Java/Swift/TS wrapper 消费 |
| **1Password**（[官方博客](https://1password.com/blog/1password-8-the-story-so-far)） | 原文 *"we chose to write our shared backend library in Rust"* —— 服务端通信、数据库、权限、密码学 | **四套原生 UI**：iOS/macOS SwiftUI、Android 原生 View、Windows/Linux Electron |
| **Mozilla**（[application-services](https://github.com/mozilla/application-services)） | 原文 *"most components have their FFI generated by the uniffi library"* | Kotlin（Android）+ Swift（iOS）各写 |

**Rust 做全栈含 UI：未查到任何知名生产案例。**

> **需纠正一处常见说法**：Dropbox 常被引作 Rust 移动端案例，但那篇被广泛引用的[工程博客](https://dropbox.tech/mobile/the-not-so-hidden-cost-of-sharing-code-between-ios-and-android)讲的是 **C++ 跨平台共享代码的失败经验以及回归 Swift/Kotlin 原生**，全文不涉及 Rust。把它列为 Rust 移动端案例是不准确的。

### 8.9 补充：Rust 侧 JS 引擎 crate 的实测数据

承接 §4。所有数字取自 crates.io API 与 GitHub API 实测（2026-08-21）。

| Crate | 最新版 | 累计下载 | 最近发布 | 判断 |
|---|---|---|---|---|
| **`rquickjs`** | **0.12.2** | 3,669,502 | 2026-07-27 | ✅ **唯一现实选项** |
| `v8`（rusty_v8） | 152.2.0 | 25,857,284 | 2026-08-20 | ⚠️ 见下 |
| `boa_engine` | 0.21.1 | 4,467,442 | 2026-03-29 | ⚠️ 自述 experimental |
| `deno_core` | 0.410.0 | — | 2026-08-06 | ❌ 独立仓库已归档 |
| `quickjs-rs` | 0.5.2 | 7,265 | **2023-08-21** | ❌ 停滞，上游建议改用 rquickjs |
| `quick-js` | 0.4.1 | 1,612,886 | **2021-03-15** | ❌ 五年未更新 |

---

## 9. 难度总表

按「难度来源」而非「工作量」归类 —— 工作量可以砸人力，前两类砸不动。

### 9.1 第一类：技术上无法绕过（与投入无关）

| 难点 | 实质 | 出处 |
|---|---|---|
| **Android 媒体控制必须写 Java/Kotlin** | 需要继承 `MediaSessionCompat.Callback`，**JNI 无法从 Rust 创建 Java 子类**。souvlaki 0.8.3 无 Android 支持 | §5.3 |
| **鸿蒙 UI 必须用 ArkTS** | ArkUI NDK C API 剥离声明式语法与状态管理，且 NDK 组件必须由 ArkTS 占位组件挂载 | §8.3 |
| **iOS 后台播放靠配置不靠 API** | `UIBackgroundModes` 是 Info.plist 配置；`AVAudioSession` 类别必须原生设置 | §5.3 |
| **用户源必须继续跑 JS** | 产品功能 + 公开契约，存量第三方脚本不可废 | §4.1 |
| **无生产级 Rust 移动 GUI** | 0 个消费级上架先例，0 个框架覆盖三平台 | §3.7 |

### 9.2 第二类：可解但代价明确

| 难点 | 代价 |
|---|---|
| **UI 按平台重写 ×N** | 路线 A 下 24,773 行 TSX 要按平台数各写一遍；这正是 RN 已经解决的问题（§6.3） |
| **AAC 专利责任转移** | symphonia 缺 HE-AAC/HE-AACv2、APE；自行实现 AAC 需授权，**基线专利 2028 到期、扩展 2031**。责任从 Google/Apple 转到项目自身（§5.2） |
| **蓝牙状态丢失与功耗上升** | rodio [#836](https://github.com/RustAudio/rodio/issues/836) 已知；软解码功耗高于系统硬解（§5.5） |
| **移动端 Rust target 只保证「编译得过」** | Tier 2 without Host Tools，官方 CI 不跑测试（§8.2） |
| **rquickjs 移动端需开 `bindgen`** | 17 个预置 binding 无任何 Android/iOS target，需接 libclang + NDK/iOS sysroot（§8.9） |
| **开发体验退化** | Subsecond 热补丁 **iOS 真机不可用**（代码签名），改 struct 布局要重启；对比 RN Fast Refresh 是确定的退化（§8.6） |
| **崩溃上报需自建** | Sentry Rust SDK 文档不提移动端；Crashlytics NDK 要求 GNU build ID（§8.7） |

### 9.3 第三类：Rust 真正带来收益的地方

| 收益 | 依据 |
|---|---|
| **musicSdk 移植消除原生桥依赖** | 76 文件仅 3 个引用 react-native，依赖的全是 md5/base64/AES 纯计算（§2.1） |
| **消除 JCE 隐式填充坑** | Rust 的 `aes`/`block-padding` 强制显式填充，写错编译不过（§2.2） |
| **流式播放** | `stream-download` 0.24.3 是真实优势（§5.4） |
| **真正的脚本执行中断** | `set_interrupt_handler` 可提供 Android 现状**没有**的死循环中断（§4.5、§8.9） |
| **桌面端 Tier 1** | 唯一 Rust GUI 相对安全的平台（§8.4） |

---

## 10. 结论

### 10.1 直接回答「难度有哪些」

难度不主要在 Rust 语言本身，而在三处：

1. **平台系统集成无法 Rust 化** —— Android 媒体控制、iOS 后台音频、鸿蒙 UI 都必须用平台语言写。Rust 重写后**这些原生代码一行都省不掉**，只是从「RN 桥接原生」变成「Rust FFI 原生」。
2. **UI 无路可走** —— 路线 B 无生产级框架；路线 A 要按平台各写一遍，等于主动放弃 RN 已经提供的 UI 跨平台能力。
3. **音频层是净损失** —— 换来专利责任、蓝牙状态丢失、更高功耗、编解码缺口，而现有 RNTP + ExoPlayer/AVPlayer 已经把这些交给了系统。

### 10.2 对原始诉求的回应

**若目标是「让 iOS 能用」**：Rust 重构是绕远路。[ios-support-plan.md](./ios-support-plan.md) 的 21-33 天方案不动 61,667 行业务代码与 23,760 行 UI；Rust 路线要重写其中大部分，且 iOS UI 照样得从零写。

**若目标是「支持所有平台」**：Rust **不能**达成。鸿蒙 UI 必须 ArkTS，iOS/Android UI 在路线 A 下各写一遍。真正能跨平台复用的只有逻辑层 —— 而**这正是 RN 现在已经做到的事**（§6.3）。

**若目标是「长期收敛逻辑重复」**：路线 A 值得考虑，但预算口径必须是「重写 UI × N 个平台」，不是「一次重写」。

### 10.3 唯一值得认真考虑的 Rust 形态

**Rust 逻辑库 + UniFFI + 保留 RN UI + 保留 RNTP**（§7.2 的务实变体）：

- 只把 musicSdk（10,040 行）和 utils 纯逻辑（1,077 行）移到 Rust
- UI 继续用 RN —— 保住 §6.3 说的 UI 跨平台能力
- 播放继续用 RNTP —— 避开 §5 的全部净损失
- 沙箱换 rquickjs —— 顺带拿到真正的执行中断

它不追求「全平台」，但每一项收益都落在 §9.3 里，且不触碰 §9.1 的任何硬边界。**这是 Rust 在本项目里唯一投入产出为正的形态。**

> 需要强调：即便是这个变体，也**不解决 iOS 支持问题** —— iOS 该写的原生模块一个不少。它和 ios-support-plan 是**互补**而非替代关系：先按 ios-support-plan 让 iOS 跑起来，再考虑把 musicSdk 下沉到 Rust。顺序反过来会让两件难事叠加。

---

## 11. 未查证事项

以下为本文查证过程中**明确未能证实**的内容，不应据此下判断。

| 事项 | 未能查证的原因 |
|---|---|
| **Rust vs RN/Hermes 的移动端二进制体积对比** | 官方与社区均无实测数据；RN 官方仅有 Hermes *"smaller app size"* 的定性说法 |
| **各 JS 引擎在 iOS/Android 的体积代价** | 所有引擎均无实测数据（§8.9） |
| **Rust 移动端编译时间权威基准** | 仅有 ThinLink 宣称的 <500ms 增量与 Tauri 的「several minutes」首次构建 |
| **`wang.harlon.quickjs:wrapper-android` 基于哪个 QuickJS 分叉** | 影响 §4.2「两端同引擎」这一优势是否成立，**需实测确认** |
| **boa 的 test262 具体通过率** | boajs.dev/conformance 页面打不开；README 只有「超 90%」的自述 |
| **Apple bitcode 废弃的一手说明** | 官方页面正文抓取失败 |
| **iOS 上 Rust 的 dSYM / 符号化官方指引** | 未查到 |
| **souvlaki 的 iOS 分支是否曾在真机跑通** | 未查到证据 |
| **AppGallery 对 Rust 二进制的审核要求** | 华为文档站返回 502 |
| **Makepad 移动端成熟度** | 官方平台文档页 404 |
| **各框架实现渐变/模糊/动画的定量难度** | 无官方量化数据，需原型验证 |
| **Rust + 内嵌 JS 引擎的移动端上架案例** | 未查到任何公开案例 |

> 本文另有两处对流传说法的纠正，均经一手核实：`javascriptcore-rs` **不是** Apple JSC 绑定而是 WebKitGTK 绑定（§8.9）；Dioxus README **不含** "Mobile (iOS/Android) - alpha" 字样（§3.2）。另 Dropbox 那篇常被引用的博客讲的是 **C++**，与 Rust 无关（§8.8）。
