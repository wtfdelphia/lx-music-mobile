# lx-music-mobile iOS 适配最优改造方案（综合决策版）

> 输入依据：[ios-analysis.md](./ios-analysis.md)（现状与困难）、[ios-support-plan.md](./ios-support-plan.md)（RN 补 iOS 实施方案，下称 **iOS 方案**）、[rust-rewrite-analysis.md](./rust-rewrite-analysis.md)（Rust 重构分析，下称 **Rust 分析**）、[ios-rust-hybrid-analysis.md](./ios-rust-hybrid-analysis.md)（组合路线分析，下称 **组合分析**）
> 定位：**最终决策与执行文档**。前述四份是分析，本文是结论。执行时以本文为准；细节取证回溯原文档。
> 基准：`master` @ `05c322a`（v1.8.1），RN 0.73.11 / 老架构 / Hermes。数字沿用 2026-08-24 修订后口径。
> 日期：2026-08-24

---

## 0. 决策结论

**最优路线 = iOS 方案主干（①）+ 加密核心 Rust 化增强（V1）+ JSC 沙箱 + Phase 1 末脚本回归闸门（G1）。**

| 决策项 | 结论 | 依据 |
|---|---|---|
| 总体路线 | 在现有 RN 工程内补齐 iOS（①），不做 Flutter / Rust 全栈 | iOS 方案 §0；Rust 分析 §3/§10 |
| 加密模块（CryptoModule） | **Rust 核心 + ObjC 薄封装**（仅 iOS 链接，Android 零改动） | 消除全案概率最高的两个风险 R2/R2b；黄金基准可用 `cargo test` 在桌面验证；详见 §2 |
| 自定义源沙箱（UserApiModule） | **JSC**（iOS 方案 §3.3 原样），是否换 rquickjs 由 G1 闸门实测决定 | 引擎统一的收益真实，但代价（Android 回归面、QuickJS 分叉差异）不应在 iOS 上线前预付；详见 §4 |
| Rust 完整形态（②/③） | 不进首期；工作包规格已备好，G1 失败或长期收敛诉求出现时启动 | 组合分析 §4/§8 |
| 明确不做 | 桌面歌词、APK 式应用内更新、App Store 上架、TestFlight 外部测试 | iOS 方案 §7/§8 |

**总工期：23-36 天（约 5-8 周）**，对比：纯 ① 为 21-33 天，最小组合 ② 为 39-61 天。多付的 2-3 天买的是：全案两个「高概率」技术风险降级、加密验证从「模拟器肉眼」升级为 `cargo test` 自动化、以及未来任何 Rust 演进的地基。

### 为什么这是最优（三条一句话论证）

1. **① 是唯一与目标匹配的路线**：目标是自用/内测可用（假设 A1），61,667 行业务代码 100% 复用，21-33 天基线；Rust 全栈（路线 B）无生产级移动 GUI（Rust 分析 §3），Rust 核心+原生 UI（路线 A）要按平台重写 24,787 行 UI，都与目标错配。
2. **加密是唯一值得在首期引入 Rust 的模块**：它是纯计算（无平台 API）、全 App 主干（搜索一个字就走它）、且它的两个头号风险（SPKI/PKCS#1 DER 转换 R2、ECB 隐式填充 R2b）恰好都是「Rust 显式类型系统 + 成熟 crate」直接消掉的；反过来，沙箱换引擎的风险（QuickJS 分叉差异）无法静态排除，只能实测 —— 所以沙箱留给 G1 闸门，加密直接上。
3. **所有「等待观望」的坏形态都被闸门设计排除了**：G1 在 Phase 1 末产出脚本回归数据，使「将来要不要引擎统一」从猜测变成测量结果；而加密 Rust 核心在任何未来分支下都不废弃（留 ① 它是更稳的加密，走 ② 它是现成的 WP-R1）。

---

## 1. 方案总览

### 1.1 架构

```
JS 业务层（61,667 行，零改动）
  src/utils/nativeModules/*  契约不变
        │
  ┌─────┴──────────────────────────── iOS 原生 ────────────────────────────┐
  │ UtilsModule（ObjC，新写 ~400 行）   CacheModule（ObjC，~60 行）          │
  │ LyricModule（桩）                                                      │
  │ CryptoModule（ObjC 薄封装 ~80 行 ──► lxcore-crypto Rust staticlib）     │
  │ UserApiModule（ObjC ~500 行，JSC 沙箱；G1 失败则二期换 rquickjs）        │
  │ fs.ios.ts（RNFS 适配 27 方法）  toast.ios.tsx  version.ios.js 等        │
  │ Info.plist：UIBackgroundModes / 深链 / CFBundleDocumentTypes / 字体     │
  └──────────────────────────────────────────────────────────────────────┘
        │（Android 侧：零代码改动，仅 iOS 方案 §12 的一处 assets 路径）
```

### 1.2 已验证的关键事实（执行前必读）

取证全部经 2026-08-24 复核（细节见 iOS 方案附录）：

- **启动即崩**：`src/app.ts:6` 顶层 import → `nativeModules/utils.ts:5` 对 `undefined` 取属性，iOS 上模块求值期 TypeError。Phase 0.3 解除。
- **5 个自研原生模块均无 iOS 实现**；2 个 fork（file-system `fcb0e6f5`、local-media-metadata `1b5be310`）远端核实**无 `ios/` 目录**，`pod install` 静默通过、运行时全 undefined。
- **Android 假设面实测约 2,300 行**（fs.ts 89 + tools.ts 575 + nativeModules 612 + ChoosePath 1,033，占 src 3.7%）。
- **四个坑**（iOS 方案 §0，全部复核属实）：
  1. `AES_MODE.ECB_128_NoPadding` 的值是 `'AES'`（`crypto.ts:24`），JCE 默认补全为 **AES/ECB/PKCS7Padding** —— 照名字实现必错，错了不报错。
  2. `Compression.framework` 的 `COMPRESSION_ZLIB` 产 raw DEFLATE 不是 gzip —— 跨端备份/同步报文不互通；用 libz `windowBits=31`。
  3. 项目无任何测试载体（无 `test` script、无框架、`cryptoTest.ts` 全是注释且枚举名失效）—— 必须先建 Phase 1.0。
  4. TestFlight 外部测试与正式上架同受指南约束（2.2）—— 只走内部测试（≤100 人，推定免审）。
- **两处不带 `Platform.OS` 的静默失效**：`StatusBar.currentHeight`（`components/common/StatusBar.tsx:10`、`components/SizeView.tsx:12`、`utils/windowSizeTools.ts:51`，iOS 上被 `?? 0` 吞掉，全局布局上移）；`useBackHandler` 整个 hook 建立在 Android 返回键上（桩化，并逐个检查调用方的关闭路径是否闭合）。

---

## 2. V1 增强：加密核心 Rust 化（本方案相对原 iOS 方案的唯一结构性改动）

### 2.1 内容

新增 `rust/lxcore/` 工作区，首期只有 `lxcore-crypto` 一个 crate（预计 500-700 行，含 ASN.1 处理），以 `staticlib` 链接进 iOS App，经**纯 C ABI**（`#[no_mangle] extern "C"`，字符串进字符串出）被 ObjC `CryptoModule` 薄封装调用。

不需要 UniFFI、不需要 bindgen、不碰 Android：加密 API 全是字符串契约（text/key/iv/mode → base64 或明文），C ABI 足够；`wang.harlon.quickjs`、gradle、4 个 ABI 全部无关。

### 2.2 必须逐字节复刻的 Java 契约（`AES.java`/`RSA.java` 已逐行读过）

| # | 契约 | 说明 |
|---|---|---|
| 1 | `ECB_128_NoPadding` 实际 = **ECB + PKCS7** | 全案第一坑；Rust 里显式 `Pkcs7`，写错编译不过 |
| 2 | base64 不对称：解码宽松（受换行）、编码不换行 | 对应 `Base64.DEFAULT` / `NO_WRAP`（`AES.java:15-21`） |
| 3 | IV 零填充到 16 字节（不足补 0、超长截断） | `AES.java:28-31` |
| 4 | 空串 IV 走无 IV 重载 | `AES.java:55-58` |
| 5 | `encrypt` 返回 base64 串、`decrypt` 返回 UTF-8 明文串 | 返回类型不对称，逐一照抄 |
| 6 | RSA 公钥 SPKI（X509）、私钥 PKCS#8 进出 | Rust 侧用 `spki`/`pkcs8` crate 直接解析，内部转 PKCS#1 供 SecKey 已不需要 —— Rust 自己做全套 |
| 7 | RSA 两种 padding：OAEP-SHA1 与 NoPadding（raw） | 对应 `RSA.java` 全文 |
| 8 | PEM 头尾剥离在 JS 侧（`crypto.ts`）已完成 | Rust 收到的是裸 base64 |
| 9 | `AES.java:13` 的 `AES_MODE_ECB_NoPadding` 是零引用死代码 | 不要当契约对齐 |

### 2.3 验证方式（这是 V1 最大的工程红利）

- Phase 1.0 在 Android 真机产出的黄金基准 JSON，直接成为 `lxcore-crypto` 的 `cargo test` 用例 —— **加密正确性在桌面/CI 上即可字节级验证**，不必等模拟器与桥。
- iOS 集成后再过一遍同一份基准（经桥），双保险。
- 未来若启动 ②（crypto 扩到 Android），同一份测试原样复用。

### 2.4 成本与退路

- 增量成本：约 2-3 天（工作区 + iOS 链接 2-3 天；加密核心比 ObjC 版多的部分被更顺的验证循环抵消）。
- 新增风险：`aarch64-apple-ios` 是 Tier 2 target（官方只保证编译），首版即测包体积增量，崩溃符号化按普通 C 库处理 —— 均为低概率小影响。
- **退路**：若 Rust 工具链在 Phase 1 前两天出现实质性阻塞，当天切回纯 ObjC 方案（iOS 方案 §3.2 规格完整，一天可切换），加密契约与黄金基准不变，只换实现语言。V1 是增强不是门槛。

---

## 3. 分阶段实施计划

阶段骨架、任务细节与验收标准继承 iOS 方案 §10（已逐项复核），本文只列差异与闸门。工期按 1 名熟悉 RN + iOS 的开发者估算。

### Phase 0：能跑起来（3-5 天）

完全按 iOS 方案 Phase 0 执行：`pod install`（关 Flipper）→ Bundle ID/版本/arm64 → UtilsModule 骨架（`exitApp` 桩 + `getWindowSize`）→ `fs.ios.ts`（27 方法，`stat`/`readDir` 合成 `mimeType`/`name`/`canRead`）→ 字体入 bundle。

**硬门槛**：模拟器启动到首页，四个 Tab 可切换，无红屏。此时无音源无播放，正常。

### Phase 1：加密与沙箱（8-13 天，最关键阶段）

相对原方案重排为 8 个子任务（1.0/1.4-1.6 与原方案一致，1.1-1.3 为 V1 替换）：

| # | 任务 | 验收标准 |
|---|---|---|
| 1.0 | **验证基础设施**：测试框架 + Android 真机产出加密黄金基准 JSON + **收集社区脚本回归集**（≥10 个，覆盖 6 大音源，加载→`inited`→搜索→取播放链接的断言脚本） | 基准落盘（两种 AES mode + 非对齐明文 + 空 IV + 短 IV + RSA 双 padding 往返）；回归集可一键跑 |
| 1.1 | `rust/lxcore` 工作区 + iOS staticlib 链接 + CI 编译步骤 | `cargo build --target aarch64-apple-ios` 过；哑函数经桥调通。**当天不过即启用 §2.4 退路** |
| 1.2 | `lxcore-crypto` 全部 9 方法（§2.2 契约） | **`cargo test` 黄金基准 100% 字节级通过** |
| 1.3 | iOS `CryptoModule` 薄封装（~80 行，含 4 个 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`） | 经桥复跑黄金基准，逐条一致 |
| 1.4 | UserApiModule：JSContext + console 注入 | `preload.js:593` 的 `Preload finished.` 出现在 Xcode 日志 |
| 1.5 | 7 个 `__lx_native_call__*` 注入 | 逐个调用返回值与 Android 逐字节一致 |
| 1.6 | `lx_setup` + `__lx_native__` 反向通道 + `set_timeout` | 社区脚本加载，收到 `inited`，定时器触发 |
| **G1** | **脚本回归闸门**：回归集在 iOS JSC 上全量跑 | 产出通过率报告，按 §4 分支 |

**硬门槛**：导入社区自定义源显示"已加载"，搜索有结果。原方案"同步桥不可用远程调试器、只能 Xcode 日志 + Safari Inspector"的注意事项照旧。

**G1 判读**（详见 §4）：核心音源可用 → 继续；核心音源在 JSC 上系统性失败 → 触发 Rust 二期。

### Phase 2：播放（4-6 天）

按原方案：track-player 构建 → `iosCategory: 'playback'`（后台出声）→ 锁屏控制 → `updateNowPlayingTitles` → 缓存三方法降级 → CacheModule。

**硬门槛**：完整听完一首在线歌，锁屏不中断、可控。**止损**：SwiftAudioEx 0.14.7 与 RN 0.73 不兼容时，1 天内切上游 track-player 4.x，不做更多纠缠。

### Phase 3：功能补齐（5-7 天）

按原方案：gzip 互通（libz `windowBits=31`，双向跨端验证）→ toast → 深链 → `.lxmc` 文件打开 → ChoosePath DocumentPicker（族共 8 文件改 4 个）→ 通知/常亮/分享/设备名/WiFi IP → 数据同步 → `tools.ts` 平台分支。

**硬门槛**：主流程（搜索→播放→收藏→歌单管理→备份恢复→同步）全通。

### Phase 4：降级与打磨（3-5 天）

按原方案：桌面歌词整组隐藏 + 桩 → 本地音乐降级 → 更新跳转 Release 页 → iPad 横屏（24 个 Horizontal tsx）→ CI unsigned build → 真机 ≥2 台（含 iOS 13/14 旧机）。

**硬门槛**：真机连续 30 分钟无崩溃，Instruments 无明显泄漏。

### 工期汇总

| 阶段 | 工期 |
|---|---|
| Phase 0 | 3-5 天 |
| Phase 1（含 V1 与 G1） | 8-13 天 |
| Phase 2 | 4-6 天 |
| Phase 3 | 5-7 天 |
| Phase 4 | 3-5 天 |
| **合计** | **23-36 天（约 5-8 周）** |

---

## 4. G1 闸门与 Rust 二期（条件分支）

### 4.1 闸门定义

G1 数据 = Phase 1.0 收集的回归集在 iOS JSC 上的通过率。判读：

实测结果（2026-08-29，run 33248314363）：加载→inited 通过率 21/23，
2 个失败均为远端依赖型而非引擎兼容性缺陷，核心加载链无系统性失败。
按上表第一行判读：留 JSC，Rust 二期不启动。

| 结果 | 动作 |
|---|---|
| 核心音源（日常使用的源）全部可用，个别脚本失败 | 留 ①。失败脚本按 iOS 方案 R1 缓解措施逐个 shim；Rust 二期**不启动** |
| 某核心音源在 JSC 上系统性失败（正则/`Error.stack`/数值边界等引擎差异，且 shim 不可行） | **触发 Rust 二期**：沙箱换 rquickjs（双端共用） |
| 上线后长期出现脚本兼容投诉，或产生多端逻辑收敛诉求 | 同上，随时可触发（规格已备好，见 4.2） |

### 4.2 Rust 二期（规格继承组合分析 §4，此处只列要点）

- 工作包：WP-R0 构建链（此时才需要 cargo-ndk/Android 侧）→ WP-R2 rquickjs 沙箱核心（8-12 天）→ WP-R3 Android 换芯（5-8 天，回归面最大）→ WP-R4 iOS 侧把 JSC 换成 rquickjs（3-5 天）。`lxcore-crypto` 即现成的 WP-R1，零废弃。
- 二期总增量约 19-30 天；**启动前必须先实测**：`wang.harlon.quickjs` 与 QuickJS-NG 的分叉差异（唯一无法静态排除的风险，组合分析 RH2）。
- musicSdk 下沉（组合分析形态 ③，+30-50 天）只在二期稳定后另行立项，永远不与 iOS 主线绑定。

---

## 5. 风险总表

继承 iOS 方案 §11（R1-R8），按本方案更新状态：

| # | 风险 | 本方案下的状态 |
|---|---|---|
| R1 | JSC 脚本行为异常 | **由 G1 闸门接管**：Phase 1 末实测判读，而非上线后被动承受 |
| R2 | RSA SPKI/PKCS#1 DER 转换 | **V1 降级**：`spki`/`pkcs8` crate 成熟，`cargo test` 桌面验证 |
| R2b | ECB 隐式填充误实现 | **V1 降级**：显式 `Pkcs7` + 黄金基准含非对齐明文用例 |
| R3 | SwiftAudioEx 不兼容 | 不变；1 天止损切上游 |
| R4 | track-player 缓存三方法 | 不变；首版降级 0/false |
| R5 | `fs.ios.ts` 行为差异 | 不变；重点断言 `stat().name`（TS 查不出） |
| R5b | gzip 跨端不互通 | 不变；libz `windowBits=31` + 双向实测 |
| R6 | TestFlight 审核 | 不变；只走内部测试，外部测试按指南 2.2 会被同等理由拒 |
| R7 | preload 移动破坏 Android 构建 | 不变；改后先跑 Android release |
| R8 | iOS 侧再腐化 | 不变；CI unsigned 编译回归是硬门槛 |
| 新 | Rust iOS target（Tier 2）运行时异常 / 体积增长 | 低概率；首版即测体积，崩溃按 C 库符号化 |

---

## 6. 分发与合规（结论速查）

依据 iOS 方案 §8（指南原文已核）：

1. **主推：源码 + 构建文档，用户自编译** —— 写进 README，合规责任留在用户侧，与开源定位一致。
2. **小圈子：TestFlight 内部测试**（≤100 人，需团队角色，90 天/build 重传）—— 免审为**推定**非明文，以实际提交结果为准。
3. 备选：付费账号自签（100 台/产品家族/年，手工分发 `.ipa`）。
4. **禁止**：TestFlight 外部测试/公开链接（指南 2.2，Beta 同受约束）；App Store 上架（5.2.2/5.2.3 第三方媒体下载授权不可能取得，另有 2.5.2/4.7 风险）。

### 6.1 CI 分发流水线（2026-08-24 增补）

主推路线的自动化形态：开发者在 Windows / Linux 上 `git push`，macOS
构建环境完全由 GitHub Actions 提供，用户侧以免费 Apple ID 重签侧载，
全程不依赖 App Store 与付费开发者账号。

```
Windows / Linux ──git push──► GitHub ──► GitHub Actions
                                              │
                                    macOS Runner（macos-15 / Xcode 16）
                                    Node.js + Rust + CocoaPods + Xcode
                                              │
                                              ▼
                                    LxMusicMobile.ipa（未签名）
                                              │
                                              ▼
                                    GitHub Actions Artifact（30 天）
                                              │
                                              ▼
                          Windows 下载 ──► AltStore / SideStore ──► iPhone
```

对应关系与现状：

| 流水线段 | 对应任务/决策 | 状态 |
|---|---|---|
| push → Actions 触发 | `.github/workflows/ios-verify.yml`（push dev-ios/master + PR） | ✅ 已通 |
| macOS Runner 四件套 | Node v18 / Rust stable / CocoaPods 1.17 / Xcode 16.4 | ✅ 已验证 |
| → `.app`（模拟器） | 任务 7.5 / R8 硬门槛（首验形态） | ✅ 已通（run 32705189097） |
| → IPA（设备 unsigned）+ Artifact | `-sdk iphoneos` + Payload 打包 + 上传（保留 30 天） | ✅ 已通（run 32707901201，11 MB） |
| → 重签侧载 | §6 主推"用户自编译/自签"的免账号降级形态；合规责任在用户侧 | 文档已入 README |
| Rust 进 App | 任务 3.1 桥调通 / 3.4 薄封装 | ✅ 已通（`crypto_golden` 经桥实证，run 32838388685） |

结构备注：首版曾拆"模拟器门槛 + 设备 IPA"两个并行 job，前置
（npm ci / pod install）重复。设备切片与分发物一致、编译级信号
覆盖重合，已归并为单 job（门禁 = 产物）。模拟器运行时验证后来
由应用内 27 项自测 + `ci-report-assert.js` 在冒烟 job 内完成，
运行时钉死 iOS 18.5（run 33248314363 全绿），不再依赖交互阶段。

固有约束（写进 README 提示用户）：免费 Apple ID 签名 7 天过期、
最多 3 个活跃应用、需电脑端定期刷新。

---

## 7. 改动文件清单

继承 iOS 方案 §12（已修订口径），差异仅加密模块：

**新增**

```
rust/lxcore/                                  工作区（首期仅 lxcore-crypto）
rust/lxcore/lxcore-crypto/                    ~500-700 行（含 ASN.1）+ cargo test 黄金基准
ios/LxMusicMobile/Modules/UtilsModule.{h,m}   ~400 行
ios/LxMusicMobile/Modules/CryptoModule.{h,m}  ~80 行薄封装（替代原 ~350 行 ObjC 加密）
ios/LxMusicMobile/Modules/UserApiModule.{h,m} ~500 行（JSC 沙箱）
ios/LxMusicMobile/Modules/CacheModule.{h,m}   ~60 行
src/utils/fs.ios.ts                           ~150 行
src/utils/nativeModules/lyricDesktop.ios.ts   ~40 行（全桩）
src/utils/toast.ios.tsx / version.ios.js / hooks/useBackHandler.ios.ts
assets/script/user-api-preload.js             （从 android/ 移动，R7 注意）
test/crypto-golden-vectors.json + 脚本回归集 harness
.github/workflows/ios-verify.yml              独立工作流：5 个并行门禁（JS 单测打包 / Rust 交叉编译 / 设备构建 / 模拟器冒烟 / Android 回归）
```

**修改 / 不动**：与 iOS 方案 §12 完全一致（Info.plist 7+2、AppDelegate 深链与 AVAudioSession、Podfile 关 Flipper、pbxproj、fs.ts 拆分、tools.ts、StatusBar/SizeView/windowSizeTools、player iosCategory、sync gzip 走 pako、ChoosePath 4 文件、core/common.ts SAF 恒真；其余 ~60,000 行与全部音源实现不动）。

---

## 8. 假设声明

| # | 假设 | 不成立时 |
|---|---|---|
| A1 | 目标为自用 / TestFlight 内测，不上架 | 工期与合规复杂度大幅上升（§6） |
| A2 | 允许 `src/` 平台分支与扩展文件，不重写业务逻辑 | 需给 fork 补 iOS 原生实现，工期 +50% |
| A3 | 有 macOS + Xcode 15+ 与 Apple 开发者账号 | 无账号只能 7 天自签循环 |
| A4 | 首版接受功能降级（桌面歌词/标签写入/应用内更新缺失） | 功能对等需重新设计交互 |
| A5 ★ | 接受 iOS 构建链引入 Rust 工具链（V1） | 当天启用 §2.4 退路（纯 ObjC 加密），总工期回到 21-33 天，R2/R2b 回到风险表头部 |

---

## 附录：文档关系与优先级

- 冲突时以本文为准；本文数字以 2026-08-24 修订口径为准（`wc -l` 全量，src 合计 61,667）。
- [ios-support-plan.md](./ios-support-plan.md)：阶段任务全文、取证细节、契约原文 —— 执行手册。
- [ios-rust-hybrid-analysis.md](./ios-rust-hybrid-analysis.md)：G1 触发二期时的工作包规格（§4）与风险（RH1-RH7）。
- [rust-rewrite-analysis.md](./rust-rewrite-analysis.md)：「为什么不走 Rust 全栈/路线 A」的完整论证，用于回应后续质疑。
- [ios-analysis.md](./ios-analysis.md) / [flutter-comparison.md](./flutter-comparison.md)：背景与替代路线对比。
