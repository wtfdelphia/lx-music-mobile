## 背景与技术语境

取证结论（详见 `docs/ios-support-plan.md`，均已复核）：

1. 启动即崩：`src/app.ts:6` 顶层 import 链在模块求值期对 `undefined` 取属性
2. 五个自研原生模块全无 iOS 实现；`react-native-file-system`、`react-native-local-media-metadata` 两个 fork 远端无 `ios/` 目录，`pod install` 静默通过
3. `ios/` 为裸模板，缺 `UIBackgroundModes`（后台播放不工作）
4. JS 层 Android 假设面约 2,300 行（占 src 3.7%）：`fs.ts`、`tools.ts`、`nativeModules/*`、ChoosePath 族
5. 项目无任何测试载体

决策链：`rust-rewrite-analysis.md`（排除 Rust 全栈）→ `ios-rust-hybrid-analysis.md`（组合形态与闸门设计）→ `ios-optimal-plan.md`（最终决策，冲突时以它为准）。

## 关键决策

### D1 在现有 RN 工程内补齐，不做重写

业务代码 61,667 行 100% 复用；Flutter / Rust 全栈 / Rust 核心+原生 UI 三条路线与「自用/内测可用」目标错配（论证见上述文档）。

### D2 加密核心 Rust 化（V1），仅 iOS 链接

`lxcore-crypto` crate 以 `staticlib` + 纯 C ABI（`#[no_mangle] extern "C"`，字符串进出）链接进 iOS；ObjC `CryptoModule` 为 ~80 行薄封装。不用 UniFFI / bindgen。理由：

- 加密是全案概率最高的两个风险（RSA DER 转换、ECB 隐式填充），Rust 显式类型 + 成熟 crate 直接消除
- 黄金基准成为 `cargo test` 用例，桌面/CI 即可字节级验证
- Android 零改动；未来若启动引擎统一二期，此 crate 即现成组件

退路：Rust 工具链在 Phase 1 前两天实质性阻塞时，当天切回纯 ObjC 实现（`docs/ios-support-plan.md` §3.2 规格完整），契约与黄金基准不变。

### D3 沙箱用 JSC，引擎统一由 G1 闸门实测决定

`user-api-preload.js`（594 行）去注释后仅依赖基础 ES 特性（Proxy ×1、Promise ×4、Uint8Array ×6 等），iOS 13.4 的 JavaScriptCore 全部支持。不预付 rquickjs 双端换芯的回归成本；Phase 1 末以脚本回归集实测判读（见 D6）。

### D4 文件系统走 `react-native-fs` 适配层

`fs.ios.ts` 适配 27 个导出；`stat`/`readDir` 合成 `name`/`mimeType`/`canRead` 字段（RNFS 不提供）。ChoosePath 族 8 文件改 4 个，SAF 概念整体替换为沙箱 + DocumentPicker。

### D5 播放沿用 track-player fork

`iosCategory: 'playback'` + `UIBackgroundModes: audio`。SwiftAudioEx 0.14.7 与 RN 0.73 不兼容时，1 天内切上游 4.x，不做更多纠缠。缓存三方法（getCacheSize/clearCache/isCached）首版降级 0/false。

供给链现状（2026-08-31 核实）：上游 `doublesymmetry/react-native-track-player` v5.0.0 起转商业授权，v4 冻结在 `v4` 分支不再更新，免费修复通道已断。「切上游 4.x」的退路仍在（v4 分支留存），但上游已不会为它出补丁。本仓库播放栈（fork v2.1.2 + SwiftAudioEx 0.14.7）的后续修复只能自行 cherry-pick 或自写补丁。iOS 26 上已报出的相关上游问题（SwiftAudioEx 主线程同步属性查询、getArtwork 崩溃等）逐条对照记录在 `evidence/ios26-upstream-landscape.md`。

### D6 G1 闸门（Phase 1 末）

回归集：≥10 个社区自定义源脚本，覆盖 6 大音源，断言 加载→inited→搜索→取播放链接。判读：

- 核心音源可用 → 留 JSC；个别脚本失败按脚本级 shim 处理
- 核心音源系统性失败且 shim 不可行 → 触发 Rust 二期（规格见 `docs/ios-rust-hybrid-analysis.md` §4），另立 change

### D7 分发只走内部路径

源码自编译为主推，TestFlight 内部测试（≤100 人）与小圈子自签备选。外部测试与 App Store 上架被指南 2.2 / 5.2.2 / 5.2.3 封死（论证见 `docs/ios-support-plan.md` §8）。

## 数据流

```
JS 业务层（契约不变）
  src/utils/nativeModules/crypto.ts ──► CryptoModule(ObjC 薄封装)
                                            │ extern "C"（字符串进出）
                                            ▼
                                      lxcore-crypto (Rust staticlib)

  src/utils/nativeModules/userApi.ts ─► UserApiModule(ObjC)
                                            │ JSContext
                                            ▼
                                      user-api-preload.js + 第三方脚本
```

同步约束：`aesEncryptSync` 等 4 个同步方法经 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD` 在 JS 线程直接调 Rust FFI，`requiresMainQueueSetup` 显式返回 NO。

## 必须逐字节复刻的加密契约

1. `ECB_128_NoPadding` 实际 = ECB + PKCS7（枚举名是陷阱，错了不报错）
2. base64 不对称：解码宽松、编码不换行
3. IV 零填充到 16 字节（不足补 0、超长截断）
4. 空串 IV 走无 IV 重载
5. `encrypt` 返回 base64、`decrypt` 返回 UTF-8 明文（返回类型不对称）
6. RSA 公钥 SPKI / 私钥 PKCS#8 进出；两种 padding：OAEP-SHA1 与 NoPadding(raw)
7. PEM 头尾剥离在 JS 侧已完成，Rust 收裸 base64
8. `AES.java:13` 的 `AES_MODE_ECB_NoPadding` 是零引用死代码，不作契约

## 异常路径与回滚

| 触发 | 动作 |
|---|---|
| Rust iOS 工具链阻塞（Phase 1 前两天） | 切纯 ObjC 加密（D2 退路），工期回到 21-33 天 |
| SwiftAudioEx 不兼容 | 1 天内切上游 track-player 4.x |
| preload 移动破坏 Android 构建 | 回滚，iOS 侧拷贝一份 |
| gzip 跨端不互通 | 小数据路径改用已有 pako |
| G1 核心音源失败 | 触发二期评估，不在本变更内挣扎 |

## 验证策略

- 加密：Android 真机产出黄金基准 JSON → `cargo test` 100% 字节级通过 → iOS 经桥复跑同一份基准
- 沙箱：注入函数逐个与 Android 返回值对照；回归集全量跑并留报告（G1）
- 文件：27 个导出逐个断言，重点 `stat().name`（TS 检查不出）
- 跨端：`.lxmc` 备份与同步报文双向互通实测
- 回归：iOS job unsigned 编译回归进 CI，防再腐化
