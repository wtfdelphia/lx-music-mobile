# 架构事实

本文记录 lx-music-mobile 的**长期**架构决策与关键机制。单次变更的设计写在 `openspec/changes/<name>/design.md`，归档后其中的长期结论回写到本文。

## 整体分层

```
                        index.js
                           │
                    react-native-navigation
                           │
              ┌────────────┴────────────┐
              │                         │
        src/screens/               src/components/
        （页面与视图）              （复用 UI）
              │                         │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   src/core/          src/store/         src/event/
  （业务动作）        （状态与持久化）    （全局事件总线）
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
  src/plugins/       src/utils/musicSdk/  src/utils/nativeModules/
 （player / sync）    （音源适配）          （原生桥接层）
                                               │
                        ┌──────────────────────┴──────────────────────┐
                        │                                             │
              android/.../mobile/                        ios/LxMusicMobile/Modules/
              crypto · cache · lyric · userApi · utils    Crypto · Cache · Gzip · UserApi · Utils
                                                                      │
                                                            rust/lxcore/lxcore-crypto
                                                              （C ABI staticlib）
```

## 关键架构决策

### 导航：react-native-navigation，非 React Navigation

使用 `react-native-navigation` 7.39.2（原生导航栈）。这意味着页面注册、生命周期与栈操作走原生实现，不能套用 React Navigation 的模式。注册逻辑在 `src/navigation/`。

### 状态：自建 store，非 Redux 常规范式

`src/store/` 按领域切分为独立子模块（list / player / setting / theme / search / songlist / sync / userApi / version / hotSearch / leaderboard / dislikeList / common），配合 `src/event/` 的事件总线做跨模块通知。业务动作集中在 `src/core/`（init / music / player / search），视图层不直接改 store。

### 平台差异：Metro 平台扩展，非运行时分支

平台差异通过文件名后缀由 Metro 在打包期解析：

| 文件 | 差异原因 |
|---|---|
| `src/components/common/DrawerLayoutFixed.ios.tsx` | iOS 上 `DrawerLayoutAndroid` 解析为桩，用同接口自绘抽屉（任务 9.3） |
| `src/utils/exportPicker.ios.ts` | iOS 导出走系统另存为面板（任务 9.16），Android 用内置目录浏览器 |
| `src/utils/fs.ios.ts` | 文件系统路径与沙箱语义不同 |
| `src/utils/localMediaMetadata.ios.ts` | 本地媒体元数据读取 API 不同 |
| `src/utils/nativeModules/lyricDesktop.ios.ts` | iOS 无桌面歌词，桩化 |
| `src/utils/statusbarHeight.ios.ts` | iOS 无 `StatusBar.currentHeight`，经 `StatusBarManager.getHeight` 读真实高度（任务 9.2） |
| `src/utils/toast.android.ts` / `toast.ios.tsx` | Android 用原生 Toast，iOS 需自绘 |
| `src/utils/version.ios.js` | 更新检查改道应用内（无 App Store 通道） |

业务代码不散落 `Platform.OS` 分支。**注意**：Metro 原生支持该解析，但 TypeScript 需要 `moduleSuffixes` 才能同样解析——当前 `tsconfig.json` **未配置**，这是 `tsc --noEmit` 部分报错的来源之一（详情与实验结论见 `AGENTS.md` 验证矩阵）。

### 加密：iOS 走 Rust，Android 走 Java

Android 侧加密为既有 Java 实现（`android/.../mobile/crypto/`）。iOS 侧新建 Rust 实现（`rust/lxcore/lxcore-crypto`），编译为 C ABI staticlib 后由 `CryptoModule.m` 链接调用。

选择 Rust 而非移植 Java 或用 CommonCrypto 的原因：加密逻辑需与 Android 字节级一致，Rust 可用同一套代码在宿主机跑黄金基准测试，把「实现正确性」和「桥接正确性」两个问题分离验证。

约束：
- Rust 产物**仅 iOS 链接**，Android 构建不引入
- 唯一权威基准是 `test/crypto-golden-vectors.json`
- 验证分两级：`cargo test --locked`（宿主，验实现）+ iOS 模拟器经桥实测（验桥接）
- 交叉编译目标：`aarch64-apple-ios`（设备）、`aarch64-apple-ios-sim` + `x86_64-apple-ios`（模拟器）

### 自定义源沙箱：独立 JS 引擎实例

自定义源脚本不在应用主 JS 上下文执行，由原生侧 `UserApiModule` 起独立引擎实例（iOS 用 JSC）承载，通过约定通道与宿主通信。注入脚本 `assets/script/user-api-preload.js` **双端共用**，因此 `ios-verify.yml` 专门有 android-regression job 校验该文件仍正确入包。

桥接层在 `src/utils/nativeModules/userApi.ts`。改动注入面时需同时精读该文件与 preload 脚本两侧。

### iOS 原生模块清单

| 模块 | 职责 | Android 对应 |
|---|---|---|
| `CryptoModule` | 音源签名与同步握手加密，调 Rust | `crypto/` |
| `UserApiModule` | 自定义源脚本沙箱 | `userApi/` |
| `UtilsModule` | 系统能力杂项 | `utils/` |
| `CacheModule` | 缓存读写 | `cache/` |
| `GzipModule` | 压缩解压 | （合并在其他模块） |
| — | iOS 无桌面歌词，JS 侧桩化 | `lyric/` |

### 构建与验证：CI 承担 iOS 构建

开发机无需 macOS。iOS 构建与验证由 GitHub Actions macOS Runner 完成，产出**未签名** IPA 作为 Artifact，本地下载后经 AltStore / SideStore 重签侧载。

`ios-verify.yml` 的 5 个 job：

| job | 覆盖 |
|---|---|
| `js-verify` | `npm test` + Metro 双端打包 |
| `rust-ios-target` | 三目标交叉编译 + 宿主黄金基准 |
| `ios-build` | `xcodebuild` 未签名构建 + IPA 打包 |
| `ios-simulator-smoke` | 启动到首页、进程判活、应用内自测、深链探针，用 `test/ci-report-assert.js` 断言 |
| `android-regression` | Android release 打包 + preload 入包校验 |

应用内自测（`src/utils/ciSelfTest.ts`）是模拟器冒烟的核心手段：把无法在 CI 里外部驱动的运行时行为（加密经桥、沙箱、播放、主题、深链）做成应用内可断言用例，结果落 JSON 供 CI 断言。

其他工作流：`build-test.yml`（lint，**仅 PR→`dev` 触发**）、`rust.yml`（Rust 测试）。

### 依赖：多个 fork commit 锁定

`react-native-track-player`、`react-native-file-system` 等关键依赖锁定在 fork 的特定 commit，行为可能与上游文档不一致。涉及这些依赖的行为判断以实测为准，不引用上游文档结论。

## 已知技术债

| 债项 | 现状 | 影响 |
|---|---|---|
| `tsc --noEmit` 21 errors | 无 CI 覆盖 | 类型错误无拦截；修复需另立 change（加 `moduleSuffixes` 会使总数 21→23，新暴露 4 个被掩盖错误） |
| lint 仅 PR→`dev` 触发 | `dev-ios` push 不跑 | iOS 适配期引入的风格违规无人拦截（已发生 2 处，2026-09-10 已清零） |
| ~~3 处 lint 违规~~ | 2026-09-10 已清零 | `npm run lint` 退出码 0 |
| skills 三副本手工同步 | `.agents/` `.codex/` `.claude/` 各一份 | 漂移已实际发生：2026-08-24 `fa557d9` 升级 1.8.0 只覆盖 `.agents`/`.claude` 部分，`.codex` 停留 1.4.0，2026-09-10 复核时发现并以 `.agents` 为基准重新同步 |
| iOS 桌面歌词桩化 | 无实现 | 功能缺口，非 bug |
