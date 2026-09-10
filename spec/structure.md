# 目录职责

本文记录仓库目录结构与各目录职责边界，帮助判断「新代码该放哪」与「改动会波及谁」。

## 顶层

| 目录 | 职责 | 备注 |
|---|---|---|
| `src/` | 全部 JS/TS 业务代码 | 详见下节 |
| `android/` | Android 原生工程 | 原生模块在 `app/src/main/java/cn/toside/music/mobile/` |
| `ios/` | iOS 原生工程 | 原生模块在 `LxMusicMobile/Modules/` |
| `rust/` | Rust 工作区 | `lxcore/lxcore-crypto`，仅 iOS 链接 |
| `assets/` | 打包进应用的静态资源 | 含双端共用的 `script/user-api-preload.js` |
| `test/` | 测试与回归资产 | 详见下节 |
| `openspec/` | 规格驱动工件 | `changes/`（进行中）、`archive/`（已归档）、`specs/`（长期 capability） |
| `spec/` | 长期架构事实 | 本目录，三件套 |
| `docs/` | 技术分析与方案文档 | 长期参考资料 |
| `doc/` | 上游遗留的图片资源 | 仅 `images/`，README 引用 |
| `publish/` | 发布相关资产 | — |

## src/ 各目录

按文件数排序（数字为当前实际文件数，仅供规模参考）：

| 目录 | 文件数 | 职责 | 放什么 / 不放什么 |
|---|---|---|---|
| `screens/` | 222 | 页面与视图 | 按页面分组（`Home` / `PlayDetail` / `SonglistDetail` / `Comment`）。只做展示与交互编排，业务动作调 `core/`，不直接改 `store/` |
| `utils/` | 128 | 工具与外部适配 | 见下节细分 |
| `components/` | 71 | 跨页面复用 UI | `common/` 为基础组件；专用弹窗（`MusicAddModal` 等）按功能建子目录。不含业务逻辑 |
| `core/` | 54 | 业务动作层 | `init/`（启动流程）、`music/`、`player/`、`search/`。页面调用的入口都在这里 |
| `store/` | 47 | 状态与持久化 | 按领域分子目录，各领域自治。跨领域通知走 `event/` |
| `plugins/` | 27 | 独立子系统 | `player/`（播放引擎适配）、`sync/`（同步协议）。相对独立、可整体替换的模块 |
| `types/` | 16 | 全局类型声明 | 仅类型，无运行时代码 |
| `navigation/` | 13 | 导航注册与配置 | react-native-navigation 的页面注册、栈定义 |
| `theme/` | 13 | 主题系统 | `themes/` 下具体主题定义 |
| `resources/` | 12 | 代码内引用的资源索引 | `fonts/` `images/` `medias/` |
| `config/` | 7 | 常量与配置 | 编译期常量、默认值 |
| `lang/` | 6 | 多语言文案 | — |
| `event/` | 5 | 全局事件总线 | 跨模块解耦通知，不承载状态 |

## src/utils/ 细分

| 子目录 / 文件 | 职责 |
|---|---|
| `nativeModules/` | **原生桥接层**。每个原生模块对应一个 TS 文件（`crypto.ts` / `cache.ts` / `userApi.ts` / `utils.ts` / `lyricDesktop.ts`）。所有跨原生调用都从这里走，业务代码不直接 `NativeModules.X` |
| `musicSdk/` | 音源适配。每平台一目录（`kw` / `kg` / `tx` / `wy` / `mg` / `bd`）+ `xm.js`；`api-source*.ts/js` 管源选择 |
| `hooks/` | 自定义 React hooks |
| `simplify-chinese-main/` | 繁简转换数据 |
| `ciSelfTest.ts` | 应用内自测用例集，供 CI 模拟器冒烟断言 |
| `fs.ios.ts` 等平台扩展文件 | 平台差异实现，清单见 `spec/design.md` |

## test/

| 项 | 职责 |
|---|---|
| `crypto-golden-vectors.json` | 加密黄金基准，**唯一权威**。修实现不修基准 |
| `crypto-golden-vectors.test.js` | vitest 用例，校验基准文件完整性 |
| `ci-report-assert.js` | 断言应用内自测产出的 JSON 报告，供 `ios-verify.yml` 调用 |
| `scripts-regression/candidates/` | 第三方社区音源脚本**原文**。已从 lint 豁免（`.eslintrc.cjs` ignorePatterns）。**自研测试代码不得放这里** |
| `golden/` | 其他黄金数据 |
| `fixtures/` | 测试夹具 |

## 原生模块对应关系

| iOS（`ios/LxMusicMobile/Modules/`） | Android（`android/.../mobile/`） | JS 桥接（`src/utils/nativeModules/`） |
|---|---|---|
| `CryptoModule.{h,m}` | `crypto/` | `crypto.ts`、`cryptoTest.ts` |
| `UserApiModule.{h,m}` | `userApi/` | `userApi.ts` |
| `UtilsModule.{h,m}` | `utils/` | `utils.ts` |
| `CacheModule.{h,m}` | `cache/` | `cache.ts` |
| `GzipModule.{h,m}` | （合并在其他模块） | — |
| （无，iOS 桩化） | `lyric/` | `lyricDesktop.ts` / `lyricDesktop.ios.ts` |

新增原生模块时三处都要动：原生实现、模块注册（Android `*Package.java`，iOS `RCT_EXPORT_MODULE`）、JS 桥接文件。

## 不提交的目录

`node_modules/`、`.worktrees/`、`.claude/settings.local.json`、`rust/**/target`、`ios/rust-libs/`（macOS Runner 的 iOS 构建期产物，无构建环境的本地机器上不存在）、构建产物——规则在根 `.gitignore`。

`.codegraph/`（CodeGraph 本机索引）例外：由目录内自带的 `.codegraph/.gitignore`（`*` + `!.gitignore`）自忽略，该 `.gitignore` 本身入库。所以根 `.gitignore` 里查不到 codegraph 规则是正常的。
