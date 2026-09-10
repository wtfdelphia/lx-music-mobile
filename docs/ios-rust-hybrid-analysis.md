# iOS 适配 × Rust 重构组合路线 —— 可行性与实施难度分析

> 输入依据：[docs/ios-support-plan.md](./ios-support-plan.md)（iOS 实施方案，下称 **iOS 方案**）、[docs/rust-rewrite-analysis.md](./rust-rewrite-analysis.md)（Rust 重构分析，下称 **Rust 分析**）
> 本文回答的问题：**如果目标是 iOS 适配，同时采用 Rust 重构作为手段，是否可行、有多难。**
> 分析日期：2026-08-24。所有代码数字沿用两份输入文档 2026-08-24 修订后的口径（`wc -l` 全量，含 `.js`）。
>
> **后续结论**：本文的组合形态分析已被最终决策文档 [ios-optimal-plan.md](./ios-optimal-plan.md) 采纳 —— 首期采用「① 主干 + 仅加密核心 Rust 化（V1）+ G1 闸门」，形态 ② 整体作为 G1 失败后的条件分支保留（本文 §4 即其工作包规格）。

---

## 0. 结论先行

**组合路线技术上可行，但它不是 iOS 适配的捷径，而是用「更晚上线」换「更高天花板」的重构投资。**

四条核心判断：

1. **Rust 最多只能替换 iOS 方案五层阻塞中的两层**（CryptoModule、UserApiModule 沙箱），外加 JS 层的 musicSdk。UtilsModule、CacheModule、`fs.ios.ts`、Info.plist/后台播放配置等全部是平台 API，**Rust 一行都省不掉**（Rust 分析 §9.1）。所以「用 Rust 做 iOS 适配」不会减少 iOS 原生工作量的大头。
2. **组合路线真正的协同收益有两个**：一是两端共用 rquickjs，消除 iOS 方案中 JSC 与 QuickJS 的引擎分裂（iOS 方案 R1）；二是加密改为 Rust 显式实现，把 JCE 隐式填充坑（iOS 方案 R2b）从「靠人记住平台默认行为」变成编译期明确的代码。这两个收益都是长期质量收益，不是工期收益。
3. **代价同样明确**：Android 端的加密与沙箱也要一起换掉，回归面从「仅 iOS」扩大到「双端」；工具链（cargo-ndk / iOS staticlib / rquickjs bindgen / UniFFI）成为新的常驻维护对象；iOS 上线时间比纯 iOS 路线晚约 3-5 周。
4. **决策时机比路线本身更关键**：组合路线若在 iOS 方案 Phase 1 开工**前**锁定，Phase 1 直接按 Rust 实施，无废弃成本；若在 Phase 1 按 ObjC/JSC 做完**后**再转，约 850 行原生实现（CryptoModule ~350 行 + UserApiModule ~500 行，iOS 方案 §12 估算）成为废弃工作。

**推荐**：若唯一目标是「iOS 尽快能用」，走纯 iOS 路线（21-33 天）；若同时有「跨端脚本行为一致」或「长期多端逻辑收敛」的诉求，在 Phase 1 开工前锁定**最小组合形态**（仅 crypto + 沙箱下沉，见 §2），**不要**一次性把 musicSdk 也押进去。

---

## 1. 问题界定：Rust 能替换 iOS 方案里的什么

iOS 方案把阻塞分成五层。逐层标注 Rust 的可替换性：

| iOS 方案阻塞层 | 内容 | Rust 可替换性 |
---|---|---|
| 第一层：启动即崩 | `exitApp` 等 UtilsModule 方法缺失 | ❌ 平台 API（UIKit），与语言无关 |
| 第二层：5 个自研原生模块 | Utils / Crypto / UserApi / Cache / Lyric | ⚠️ **仅 Crypto、UserApi 两层可换 Rust 核心**；Utils/Cache 是平台 API；Lyric 本就桩化 |
| 第三层：2 个 fork 无 iOS 代码 | `react-native-file-system`、`local-media-metadata` | ❌ 文件系统/元数据是平台 API；`fs.ios.ts` 适配层照写 |
| 第四层：iOS 工程配置 | Info.plist、`UIBackgroundModes`、AVAudioSession | ❌ 纯平台配置 |
| 第五层：JS 层 Android 假设 | `tools.ts`、`StatusBar.currentHeight`、ChoosePath 等 | ❌ RN/UI 层，与语言无关 |

再叠加 Rust 分析中「唯一净收益层」的结论（Rust 分析 §2）：

| 额外层 | 内容 | 说明 |
|---|---|---|
| `src/utils/musicSdk` | 10,040 行 / 76 文件，仅 3 处 react-native 引用 | 可下沉 Rust，但属于**二期收敛**，不是 iOS 适配的必要条件 |

**结论：组合路线的作用域 = iOS 方案第二层的 Crypto + UserApi（+ 可选的 musicSdk）。其余四层原封不动照 iOS 方案执行。**

---

## 2. 组合形态与关键决策时机

### 2.1 四种形态

| 形态 | 内容 | 相对纯 iOS 路线的差异 |
|---|---|---|
| ① 纯 iOS 路线 | iOS 方案原样执行（ObjC CryptoModule + JSC 沙箱） | 基线，21-33 天 |
| ② 最小组合 | Phase 1 改为：**Rust crypto 核心 + rquickjs 沙箱核心**，双端共用，原生侧只剩薄封装 | Phase 1 变贵，换来引擎统一与加密坑消除 |
| ③ 完整组合 | ② + musicSdk（10,040 行）下沉 Rust | 再 +6-10 周，属于长期收敛投资 |
| ④ Rust 先行 | 先做 Rust 重构，再谈 iOS | ❌ 不成立：两件难事叠加，且 Rust 路线本身不解决 iOS（Rust 分析 §10.3 已论证） |

形态 ④ 在 Rust 分析 §10.3 已有明确结论（「顺序反过来会让两件难事叠加」），本文不再展开。以下只分析 ② 与 ③。

### 2.2 决策时机：Phase 1 是分岔口

iOS 方案 Phase 1（6-10 天）的产物是 ObjC CryptoModule（~350 行）与 JSC UserApiModule（~500 行）。这两块恰好是形态 ② 要换成 Rust 的部分：

- **Phase 1 开工前锁定 ②**：Phase 1 直接实施「Rust 核心 + 双端薄封装」，零废弃。
- **Phase 1 按 ① 做完后再转 ②**：~850 行 ObjC/JSC 实现废弃重写，且 iOS 侧要经历一次「已可用的加密/沙箱被换芯」的回归，纯属浪费。
- **Phase 2（播放）之后任何时点转 ②**：技术上仍可行（模块边界清晰），但废弃成本同上，且越晚转正，双引擎分裂的存量脚本兼容负担越重。

> 🔴 **如果有意向走组合路线，必须在 Phase 1 开工前决定。** 这是本报告的第一个硬结论。

---

## 3. 可行性分析

### 3.1 所需组件全部有现实存在（引用 Rust 分析已实测数据）

| 组件 | 作用 | 状态（Rust 分析 §8.5/§8.9 实测） |
|---|---|---|
| `rquickjs` 0.12.2 | QuickJS-NG 的 Rust 绑定，沙箱引擎 | 3,669,502 次下载，2026-07-27 发布，**唯一现实选项** |
| `aes`/`rsa`/`block-padding` | 加密核心 | 强制显式指定填充，从类型系统层面消除 JCE 坑 |
| UniFFI 0.32.0 | 生成 Kotlin/Swift 绑定 | 非常活跃（3.6M 下载）；**注意不生成 JS 绑定**（见 §3.2），不支持取消操作 |
| `cargo-ndk` 4.1.2 | Android 交叉编译 | 事实标准（578K 下载） |
| `cargo-mobile2` 0.22.5 | 移动端构建脚手架 | Tauri 官方维护，最活跃 |
| `jni` 0.22.4 / `objc2` 0.6.4 | 手写 FFI 备选 | 48.1M / 38.8M 下载，兜底路径成熟 |

**业界先例**：Signal（libsignal）、1Password、Mozilla application-services 都是「Rust 核心库 + 各端原生 UI + UniFFI/手写 wrapper」形态（Rust 分析 §8.8）。组合路线 ② 正是这个形态，**不是**被证伪的「Rust 全栈含 UI」（路线 B）。

### 3.2 与 RN 0.73 老架构的对接方式

项目为 RN 0.73.11 + 老架构 + Hermes（iOS 方案取证基线）。对接链路：

```
JS 层（不变）                平台薄封装（重写）           Rust 核心（新增）
src/utils/nativeModules/*  →  Android: Kotlin Module   →  lxcore（staticlib）
  aesEncryptSync(...)         iOS:     ObjC Module         ├─ crypto（aes/rsa）
  loadScript(...)             通过 UniFFI/JNI/objc2 调用    └─ sandbox（rquickjs）
```

三个关键约束都满足：

1. **JS 侧契约零改动**。`src/utils/nativeModules/crypto.ts`、`userApi.ts` 的导出签名不变，61,667 行业务代码无感。这是组合路线与「Rust 全栈」的本质区别 —— 桥的形状不动，只换桥墩。
2. **4 个同步方法可保留**。`aesEncryptSync` 等必须同步返回（iOS 方案 §3.2）。同步桥经 `nativeCallSyncHook` 在 JS 线程直接执行，Rust FFI 调用本身是线程无关的普通函数调用，ObjC/Kotlin 薄封装里同步调 UniFFI 即可，无需异步化。
3. **UniFFI 无 JS 绑定不是障碍**。RN 的桥本来就是「JS ↔ 平台原生模块」，Rust 核心由 Kotlin/ObjC 侧消费即可，不需要 Rust→JS 直连。

### 3.3 工具链与目标平台

| 项 | 状态 | 出处 |
|---|---|---|
| `aarch64-apple-ios` | Tier 2 without Host Tools：官方只保证「编译得过」，不保证运行时正确 | Rust 分析 §8.2 |
| `aarch64-linux-android` 等 | 同上 | 同上 |
| rquickjs 移动端 | 需开 `bindgen` feature：17 个预置 binding 不含任何 Android/iOS target，要自备 libclang + NDK/iOS sysroot | Rust 分析 §9.2 |
| iOS 产物形态 | Rust staticlib → Xcode 链接（或打包 xcframework）；bitcode 已死，无历史包袱 | Rust 分析 §8.7 |
| Android 产物 | `.so` × 4 个 ABI（`reactNativeArchitectures` 配置），构建时间按 ABI 数放大 | Rust 分析 §8.7 |
| CI | 公开仓库的 GitHub-hosted macOS runner 免费（iOS 方案 §9 已论证），Android job 加装 NDK + Rust 即可 | iOS 方案 §9 |

### 3.4 可行性结论

**形态 ② 与 ③ 在技术上均可行**：组件齐备、先例充分、与老架构兼容、JS 契约零改动。可行性不是瓶颈，**难度全部集中在实施侧**（§4）：工具链搭建、JCE 行为复刻、QuickJS 分叉差异、双端回归。

---

## 4. 实施难度拆解（形态 ②）

按工作包展开。工期为 1 名熟悉 RN + iOS + Rust 的开发者的估算（与两份输入文档同口径），**均已含验证成本**。

### WP-R0 Rust 工作区与构建链（3-5 天）

内容：`lxcore` crate 工作区；cargo-ndk 出 Android `.so`（4 ABI）并接入 gradle；iOS staticlib 接入 `ios/LxMusicMobile.xcodeproj`；CI 两条流水线（ubuntu + NDK + Rust，macos + Xcode + Rust）。

验证标准：双端空 crate 编译进 App 并可从原生侧调通一个哑函数。

难度点：rquickjs 的 `bindgen` feature 首次接 NDK/iOS sysroot 是本包最大不确定项（Rust 分析 §9.2），建议第一天就验证它能否在 CI 编过，编不过则整个 ② 止损回退 ①。

### WP-R1 Rust crypto 核心（5-8 天）

内容：复刻 Android `AES.java`/`RSA.java` 的**实际行为**（不是枚举名声称的行为）：

- `ECB_128_NoPadding` 实际是 **ECB + PKCS7**（iOS 方案 §3.2 的 JCE 默认补全坑；Rust 里必须显式写 `Pkcs7`）
- base64 flag 不对称：解码宽松、编码 `NO_WRAP`（`AES.java:15-21`）
- IV 零填充到 16 字节、空串 IV 走无 IV 重载（`AES.java:28-31, 55-58`）
- RSA SPKI/PKCS#8 ↔ PKCS#1 的 ASN.1 头处理（iOS 方案 §3.2，约 60 行的工作量移到 Rust，双端共用一次）
- `AES.encrypt` 返回 base64、`AES.decrypt` 返回明文串的非对称契约

验证标准：iOS 方案 Phase 1.0 的黄金基准 JSON 全量通过，**字节级一致**；Android 端现有密文可被 Rust 核心解出（反向兼容）。

难度点：契约细节全部来自已逐行读过的 Java 源码（iOS 方案附录），无未知项；风险在执行而非探索。这是形态 ② 里**确定性最高**的工作包。

### WP-R2 rquickjs 沙箱核心（8-12 天，形态 ② 最难）

内容：复刻 `QuickJS.java:55-130` 的 7 个注入（`__lx_native_call__` 总入口 + 6 个 utils_*）与 console 注入、`lx_setup` 调用、`__lx_native__` 反向通道、`set_timeout` 的 native 侧调度（独立线程 + 消息循环，对应 Android 现状的 `JavaScriptThread extends HandlerThread`）。

验证标准：`user-api-preload.js`（594 行）原样加载跑通，`Preload finished.` 出现在双端日志；社区高频音源脚本回归通过。

难度点：

1. **QuickJS 分叉差异**：Android 现用 `wang.harlon.quickjs:wrapper-android:2.4.0`（`build.gradle:196`），其基于哪个 QuickJS 分支**未查证**（Rust 分析 §11）；rquickjs 绑的是 QuickJS-NG。两端分叉不一致时，存量脚本行为可能有细微差异 —— 这是形态 ② **唯一无法从源码静态排除**的风险，只能靠脚本回归实测。
2. `set_timeout` 与反向通道涉及跨线程调度，是沙箱里最容易出时序 bug 的部分。
3. 脚本中断（`set_interrupt_handler`）是顺带收益（Android 现状没有死循环中断，Rust 分析 §9.3），建议在本包一并做掉。

### WP-R3 Android 换芯（5-8 天）

内容：`CryptoModule.java`（4 文件 / 375 行）与 `UserApiModule` 相关（8 文件 / 541 行）内部改为调用 Rust 核心；移除 `wang.harlon.quickjs` 依赖；保留这两个模块全部 `@ReactMethod` 签名（9+5 个方法的对外契约不动；UtilsModule 不参与换芯）。

验证标准：Android 全功能回归 —— 搜索（走加密主干）、自定义源加载、数据同步（`plugins/sync/utils.ts:9,15` 的 ECB 路径）；**社区脚本回归集**（承 iOS 方案 R1 的缓解措施，且现在 Android 也需要它了）。

难度点：这是组合路线**新增的回归面** —— 纯 ① 路线 Android 零改动，② 则把稳定运行的加密与沙箱整体换芯。必须灰度：先在 dev 构建验证，再进 release。

### WP-R4 iOS 薄封装（3-5 天）

内容：ObjC `LXCryptoModule`/`LXUserApiModule`，各自只是把 `RCT_EXPORT_METHOD` 转发给 Rust 核心；同步方法用 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`（约束见 iOS 方案 §3.2）；`requiresMainQueueSetup` 显式返回 NO。

验证标准：同一份黄金基准在 iOS 侧字节级通过；自定义源在 iOS 模拟器加载成功。

难度点：低 —— 这是形态 ② 相对 ① 最省的一块：① 里要写 ~350 行 ObjC 加密（含 ASN.1 处理）+ ~500 行 JSC 沙箱，② 里合计只剩 ~200 行转发代码，且 ASN.1/引擎逻辑在 Rust 侧双端共用。

### 汇总

| 工作包 | 工期 | 确定性 |
|---|---|---|
| WP-R0 构建链 | 3-5 天 | 中（rquickjs bindgen 是止损点） |
| WP-R1 crypto 核心 | 5-8 天 | 高 |
| WP-R2 沙箱核心 | 8-12 天 | 中（分叉差异需实测） |
| WP-R3 Android 换芯 | 5-8 天 | 中（回归面最大） |
| WP-R4 iOS 薄封装 | 3-5 天 | 高 |
| **Phase 1' 合计** | **24-38 天** | |

### 形态 ③ 增量：musicSdk 下沉（+30-50 天）

在 ② 稳定后追加：10,040 行 JS → Rust（serde 类型化，经验膨胀 1.5-2 倍，Rust 分析 §2.4/§7），6 个音源逐个黄金向量验收，桥面从「几个加密函数」扩大到「每个音源的全部接口」。同时获得 Rust 分析 §9.3 的全部收益（零原生桥依赖、显式加密、执行中断）。**建议作为独立二期立项，不与 iOS 上线绑定。**

---

## 5. 时间线对比

iOS 方案各阶段原工期：Phase 0（3-5）+ Phase 1（6-10）+ Phase 2（4-6）+ Phase 3（5-7）+ Phase 4（3-5）= 21-33 天。

| 路线 | 构成 | 总工期 | 备注 |
|---|---|---|---|
| ① 纯 iOS | 0+1+2+3+4 | **21-33 天** | 基线 |
| ② 最小组合（Phase 1 前锁定） | 0 + **1'（24-38）** + 2+3+4 | **39-61 天**（约 8-12 周） | 无废弃成本 |
| ①→② 事后追加 | ① + 1' - R4 已含 + ~850 行废弃重写 | **约 45-71 天** | 多付 1-2 周废弃成本，且 iOS 侧经历二次换芯回归 |
| ③ 完整组合 | ② + musicSdk（30-50） | **69-111 天**（约 14-22 周） | musicSdk 部分可推迟到上线后 |
| ④ Rust 先行 | — | 不成立 | Rust 分析 §10.3 |

解读：

- ② 比 ① 多花约 **3-5 周**，买到的不是 iOS 功能，而是：双端脚本引擎统一（消 iOS 方案 R1）、加密坑显式化（消 R2b）、Android 同步获得执行中断、以及未来 ③ 的地基。
- 「①→② 事后追加」永远劣于「Phase 1 前锁定 ②」：多花钱、多一次回归。**组合路线没有「先观望」选项。**
- ③ 的增量部分（musicSdk）与 iOS 上线无依赖，可以晚做，因此 ③ 的实际决策只是「② 做完后要不要继续」。

---

## 6. 收益-风险对照

| 维度 | ① 纯 iOS | ② 最小组合 | ③ 完整组合 |
|---|---|---|---|
| iOS 上线时间 | 最快（21-33 天） | +3-5 周 | +3-5 周（③ 增量可后置） |
| 自定义源脚本兼容性 | ⚠️ 双引擎分裂（JSC vs QuickJS），iOS 方案 R1 常驻 | ✅ 双端同引擎，行为一致 | ✅ 同 ② |
| 加密正确性风险 | ⚠️ 靠黄金基准 + 人工记住 JCE 坑（R2b） | ✅ 显式 padding + 同一份黄金基准 | ✅ 同 ② |
| Android 回归风险 | ✅ 零改动（仅 ① 的 assets 路径） | ⚠️ 加密 + 沙箱换芯，需脚本回归集 | ⚠️ 再 + 音源解析换芯 |
| 维护栈 | RN + ObjC + Java | + Rust 工具链常驻 | + Rust 工具链 + 更大桥面 |
| 长期多端收敛 | ❌ 无地基 | ✅ 地基已就位 | ✅ 逻辑层已收敛 |
| 包体积 | 基线 | ⚠️ Rust staticlib/.so 按 ABI 放大，**无实测数据**（Rust 分析 §11） | ⚠️ 同上，更大 |

---

## 7. 风险登记（组合路线增量）

承接两份输入文档的风险编号，新增：

| # | 风险 | 概率 | 影响 | 缓解 | 止损 |
|---|---|---|---|---|---|
| RH1 | rquickjs `bindgen` 在 NDK/iOS sysroot 下编译失败或长期不稳 | 中 | 形态 ② 整体不可行 | WP-R0 第一天验证；备选 `quickjs-rs` 已死，真正备选是手写 `quickjs-ng` C FFI | 回退形态 ① |
| RH2 | QuickJS-NG 与 `wang.harlon.quickjs` 分叉行为差异，存量脚本在 Android 换芯后异常 | **中-高** | Android 存量用户受影响 | 社区高频脚本回归集（在 WP-R2 末与 ① 的 iOS 脚本回归合并执行）；差异逐个 shim | 单脚本 shim；极端情况 Android 保留旧 wrapper 一段时间（双轨） |
| RH3 | 移动端 Tier 2 target 的运行时问题（官方 CI 不跑测试，Rust 分析 §8.2） | 低-中 | 难定位的崩溃 | 黄金基准 + 脚本回归在真机跑；崩溃上报按「C/C++ 原生库」接入（Rust 分析 §8.7） | — |
| RH4 | 双端同时换芯导致问题归因困难（是 Rust 核心还是薄封装？） | 中 | 排障时间翻倍 | 黄金基准先过 Rust 单元测试，再上桥；两端薄封装各留日志开关 | — |
| RH5 | 维护负担：单人项目同时背 RN + ObjC + Kotlin + Rust 工具链 | **高** | 长期腐化（`ios/` 三年未动的前车之鉴，iOS 方案 §2.4） | 附录中的 CI 编译回归是硬门槛；UniFFI 减少绑定手写 | — |
| RH6 | 包体积增长不可控（无实测基准） | 中 | 分发体验 | WP-R0 产出首版即测量双端增量，超 5MB 则启用 `opt-level="z"` + `lto` + `strip` | 接受或回退 ① |
| RH7 | 决策过晚，Phase 1 产物废弃（§2.2） | — | 1-2 周浪费 + 二次回归 | 本报告即为决策输入；Phase 1 开工前必须定案 | — |

RH2 是组合路线特有的、且无法静态排除的风险；RH5 是最容易被低估的长期成本。**若对这两项没有承受意愿，应选 ①。**

---

## 8. 推荐路线图

**默认路径（目标 = iOS 尽快能用）：**

1. 按 ①（iOS 方案）执行，21-33 天上线。
2. 上线稳定后，若多端收敛诉求成立，再按本文 §4 的工作包立项 ②（接受 ~850 行废弃成本），等价于「①→② 事后追加」。

**组合路径（目标 = iOS + 长期跨端一致性）：**

1. **Phase 0 照旧**（3-5 天）：`pod install`、工程配置、`fs.ios.ts`、字体 —— 与 Rust 无关。
2. **Phase 0 期间并行执行 WP-R0**：第 1 天验证 rquickjs bindgen 双端可编，作为 ② 的 go/no-go 门。
3. **Phase 1' = WP-R1→R2→R3→R4**（24-38 天）：顺序上 crypto 先行（沙箱注入依赖加密函数，与 iOS 方案「从 R2 开始」的建议同构）；Phase 1.0 的黄金基准载体仍是验收前提，一项不省。
4. **Phase 2-4 照旧**（12-18 天）。
5. 上线后按独立二期评估 ③（musicSdk 下沉）。

两条路径在 Phase 0 完全重合，分岔只在 Phase 1 —— 这正是「决策时机 = Phase 1 开工前」的操作含义。

---

## 9. 假设与未查证事项

**假设**（继承两份输入文档，新增标注 ★）：

- iOS 方案 A1-A4 全部成立（自用/内测目标、允许平台分支、有 macOS+Xcode+开发者账号、接受功能降级）
- ★ 项目接受「iOS 上线晚 3-5 周」换取引擎统一（若不接受，直接选 ①）
- ★ Android 端允许一次加密/沙箱换芯的回归窗口

**未查证**（继承 Rust 分析 §11，与本路线直接相关的两项）：

| 事项 | 影响 |
|---|---|
| `wang.harlon.quickjs` 的 QuickJS 分叉来源 | 决定 RH2 概率，② 立项前必须实测 |
| Rust staticlib 在双端的实际体积增量 | 决定 RH6 是否触发，WP-R0 首版即测 |

---

## 附录：相对 iOS 方案 §12 文件清单的增删

**新增（形态 ②）**

```
rust/lxcore/                       Rust 工作区（crypto + sandbox 两个 crate）
rust/lxcore/ffi/                   UniFFI 或手写 FFI 定义
android/.../gradle 构建钩子         cargo-ndk 产物拷贝（4 ABI）
ios/LxMusicMobile.xcodeproj        链接 Rust staticlib
.github/workflows/release.yml      双 job 加装 Rust toolchain + NDK
test/scripts-regression/           社区音源脚本回归集（①② 共用，② 扩容）
```

**替代（相对 ①）**

```
① 的 ios/Modules/CryptoModule.{h,m}（~350 行 ObjC 加密）   → ~80 行 ObjC 转发
① 的 ios/Modules/UserApiModule.{h,m}（~500 行 JSC 沙箱）  → ~120 行 ObjC 转发
① 的 Android QuickJS wrapper 依赖                         → Rust rquickjs（Android 侧同样经薄封装）
```

**不变**

```
iOS 方案的其余全部改动：fs.ios.ts、toast.ios.tsx、Info.plist 7 处、
UIBackgroundModes、StatusBar/SizeView/windowSizeTools、ChoosePath、
UtilsModule/CacheModule 的 iOS 实现、CI macOS job —— 一项不少。
```
