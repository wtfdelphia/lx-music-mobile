# Bridge Plan: add-ios-local-library

- 分支：`dev-ios`（基线 `f2ed240`）
- 生成时间：2026-10-12
- `openspec status`：state 正常（非 blocked），四工件齐备
- `openspec validate add-ios-local-library`：通过
- 净室复核：2026-10-12 由用户确认通过（§0.5 开工硬门禁已满足）

## 范围

P1（本 plan 覆盖）：原生模块 `LxLibraryModule`（Store / Access / Scanner /
Probe / Artwork / 歌词 / Credential 接口）、本地文件夹来源、三 Tab 浏览、
详情页、播放接入（`music.ios.ts` + 旧路径 rebase）、喜欢与歌单映射、
标签查看、歌词手动搜索（F14）、设置分组、三语文案。

P2 / P3 在 P1 出口通过后另起 bridge。

## 非目标

- Android 任何行为变化（共享文件改动必须证明零行为差异）
- 标签写入、投屏、车机/TV、曲库跨设备同步
- `kind:'library'` 离线下载与自动关联（P2）
- 每日推荐（已砍）

## 关键设计决策（已定稿，实现不再讨论）

1. 曲库歌曲一律 `MusicInfoLocal`（`source:'local'`），不扩充 `LX.Source`
2. 定位符 `lxlib://<sourceId>/<itemKey>` 同时作 id 与 filePath
3. `finishSync` 用 upsert 即 seen 标记，不过桥全量定位符数组
4. NSFileCoordinator 协调失败回退普通枚举
5. 歌词编码探测 BOM → UTF-8 → GB18030 → Big5（Big5 实际接近死代码，接受）
6. `E_CELLULAR` 等错误码必须有本地化 toast 接线，不能停在错误码层
7. `getOtherSourceByLocal` 路径段先 `decodeURIComponent` 再匹配

## 高风险项

| 项 | 风险 | 对策 |
|---|---|---|
| bookmark 生命周期 | 重签后授权失效是核心验收项 | 真机实证 1；`relink` 不改定位符 |
| `libsqlite3.tbd` 链接 | 工程配置改动，影响双端构建产物 | Android 侧确认不链接、产物比对 |
| 共享文件改动 | `types/download_list.d.ts`（FileExt 扩 m4a/aac 在 P2，P1 不动）、`defaultSetting.ts`、`lang/*.json` 是双端共享 | 每项改动标注平台门控；`npm run lint` + 构建回归 |
| 三语文案 | 键漏加导致运行时 fallback | 键清单校验脚本（tasks 3.6 验证） |
| tsc 基线红 21 | 新增代码不许加重 | 每阶段 `npx tsc --noEmit` 计数不增 |

## CodeGraph 证据

```
codegraph impact "getLocalFilePath"
→ 5 affected symbols: src/utils/music.ts:4 (定义)、
  src/core/music/local.ts:69 (getMusicUrl)、src/core/music/index.ts:22
```

结论：平台扩展 `music.ios.ts` 替换 `music.ts` 后，调用面仅
`core/music/local.ts` 一处，无其他隐藏消费点。

## rg / 源码补盲

| 项 | 结论 |
|---|---|
| 导航注册 | `nav_download` 出现在 `src/screens/Home/Vertical/Main.tsx` 与 `Horizontal/Main.tsx` 的 viewMap；`nav_library` 同处注册 |
| `downloadListUpdate` 事件 | `store/download/action.ts:26` 唯一触发点；三完成入口都经它 |
| `metadata.musicInfo` 消费点 | urlResolver、scheduler、reconcile、lrc、downloadIndex 五处；P1 不改下载链路，仅读面不受影响 |
| 图标 | `sd-card` 在 `src/resources/fonts/selection.json` |
| `openspec/project.md` | 不存在；本仓库长期事实在 `spec/` 与 AGENTS.md，按仓库惯例处理 |
| CI | `build-test.yml` 仅 PR→dev 触发 lint；`dev-ios` push 不跑，本地必跑 `npm run lint` |

## 任务到执行步骤

| 任务 | 执行步骤 | 验证 | 停止点 |
|---|---|---|---|
| 1.1 模块骨架 | 建 `Modules/Library/`，链接 `libsqlite3.tbd`，注册 RCTEventEmitter | iOS 模拟器构建过、JS ping 通 | 链接失败即停，先查工程配置 |
| 1.2 Store | v1 schema + WAL + user_version + FTS 触发器 + 结构化 query + upsert 即 seen + finishSync | 真机日志覆盖 CRUD、清理保护、万行写入耗时 | query 接口面与设计不符即停回设计 |
| 1.3 Access | 选择器（复用稳定 VC 管线）+ bookmark + 引用计数 + relink | 真机实证 1 | 嵌套呈现失败模式超出 §9.4 管线能力即停 |
| 1.4 Scanner | 枚举 + 协调读取 + 白名单 + iCloud + 增量 + 并发 4 + 取消 + 报告 | 真机实证 2、3 | 协调读取在真机 Provider 上挂死即启用回退分支并记录 |
| 1.5 Probe | 标识符映射 + 超时 8s + 13.4/15 分支；FLAC 实证 | 真机实证 5 | AVFoundation FLAC 覆盖率不足 → 补最小 Vorbis 解析（设计已授权） |
| 1.6 Artwork + readLyric | ImageIO 缩放 + SHA-1 命名；编码探测四步 | 样例文件逐项比对 | Big5 乱码属已知接受项，不停 |
| 1.7 Credential 接口 | Keychain 封装（P2 使用） | 单元可调用 | — |
| 2.1–2.6 JS 核心 | native 薄封装 → locator → sources/local → sync/query → store → music.ios.ts | vitest（locator、resolver 分支矩阵）；Android 调用 reject | `npx tsc --noEmit` 错误数超实测基线 24 即停 |
| 3.1–3.7 UI | 导航 → 三 Tab 页 → 详情页 → 来源管理 → 菜单 → 设置+三语 → 歌词搜索 | 键清单校验；Metro 双端打包过 | 组件复用冲突（OnlineList 行假设在线曲目）即停，评估适配层 |
| 4.1 门禁 | `npm run lint`、`npm test`、`tsc` 不新增、CI 回归 | 退出码与基线比对 | 任何新增错误不允许带病过 |
| 4.2 实证 | 1、4、6 必过；2、3、5 记录观察项 | evidence/ 归档 | 1/4/6 任一项失败：定位根因，不回退出口标准 |

## 必跑验证

- `npm run lint`（本地必跑，CI 不覆盖本分支）
- `npm test`
- `npx tsc --noEmit`：错误数 ≤ 实测基线 24，且新增文件零错误
  （2026-10-12 实测：AGENTS.md 记载的 21 已漂移，`git stash` 排除本
  变更全部改动后复测为 24，分布见下方备注）
- `openspec validate --all`
- Metro 双端打包（ios-verify js-verify 同法）
- iOS 未签名构建 + 模拟器冒烟（ciSelfTest 走 ios-verify）
- 真机实证 1、4、6（必过），2、3、5（观察项记录）

## 文档同步判断

| 文件 | 判断 |
|---|---|
| `README.md` | 不动。进度数字与用例数以 tasks.md / ciSelfTest.ts 为准，实现完成时再评估 |
| `AGENTS.md` | 实现完成后：平台扩展清单新增 `music.ios.ts`、`associate.ios.ts` 等；验证矩阵不变 |
| `spec/` | 归档时同步：`structure.md` 登记 `src/core/library/`、`screens/Home/Views/Library/` |
| `openspec/specs/` | 归档时同步主规范（ios-local-library 新增等） |
| `docs/tooling-sources.md` | 不动（无新工具） |

## tsc 基线备注（2026-10-12 实测）

排除本变更改动后（`git stash` 暂存 `src/core/library`、
`src/utils/music.ios.ts`、`test/library`、`src/core/music/local.ts`、
`src/utils/data.ts`）复测：24 errors = 15 × `ciSelfTest.ts` +
2 × `store/player/action.ts` + 2 × `Image.tsx`（`@d11/react-native-fast-image`
类型缺失）+ 1 × `tools.ts` + 1 × `SourceSelector.tsx` + 1 ×
`plugins/player/utils.ts` + 1 × `plugins/player/hook.ts` + 1 ×
`core/player/timeoutExit.ts`。AGENTS.md 记载的「21 = 15 + 6」中
`core/common.ts` / `ChoosePath` / `OpenStorageModal` 三处错误已不复现，
新增若干处。本环境 `node_modules` 缺 `@d11/react-native-fast-image`
安装，CI 环境需另测。

## 停止条件

- 任一高风险项触发且对策失效（上表逐行列出）
- 实现中发现规格未覆盖的原生契约差异（bookmark / AVFoundation 行为与设计不符）：先更新工件再改代码
- `dev-ios` 上出现他人未提交内容与本变更冲突：停下问人
- 真机实证 1、4、6 无法在当前设备条件复现：记录条件缺口，不伪造通过
