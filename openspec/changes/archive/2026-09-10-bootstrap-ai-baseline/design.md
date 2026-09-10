# Design

> 分支：`dev-ios` · 依据：`docs/AI 辅助开发工程化落地白皮书.md` 阶段 2/3 与 Gate 5/7/8
> 本文所有「实测」标注均为本次会话在本机真实运行所得，命令与结果见「验证策略」。

## 当前实现

### 已有资产

| 资产 | 状态 | 证据 |
|---|---|---|
| OpenSpec | 已初始化，schema `spec-driven`，1 个活跃 change `add-ios-support`（四工件 done） | `openspec list`、`openspec status --change add-ios-support` |
| CodeGraph | 已索引；本次 `sync` 后新增 52 / 修改 13 / 移除 2 文件 | `codegraph status`、`codegraph sync .` |
| Skills | 12 个，三份副本 `.agents/` `.codex/` `.claude/`，同名文件 md5 完全一致 | `md5sum` 逐项比对 |
| README | 166 行，业务与协议为主，含 iOS 适配状态段 | `README.md` |
| CI | 6 个工作流：`ios-verify`（5 job）、`rust`、`build-test`、`beta-pack`、`release`、`publish-version-info` | `.github/workflows/` |
| 测试载体 | vitest，1 文件 4 用例（加密黄金基准完整性）+ 应用内 25 项自测 + 宿主断言脚本 | `npx vitest run`、`src/utils/ciSelfTest.ts`、`test/ci-report-assert.js` |

### 缺口

白皮书阶段 3 的三层事实源中，第二层与第三层缺失：

- 无 `AGENTS.md` —— 项目级 AI 规则只存在于 12 个 skills 的分散描述里，没有「技术栈底线 / OpenSpec 条件 / 验证矩阵」的单一入口。
- 无 `spec/` —— 架构事实散落在 `docs/` 七份文档（含 77KB 的 `ios-support-plan.md`）与 `openspec/changes/add-ios-support/design.md` 中，前者是历史方案与专题材料，后者是单次变更工件，都不适合当长期事实源。
- 无 `docs/tooling-sources.md` —— 工具版本口径未记录。

三处「验证不真实」（均本次实测）：

| 项 | 实测结果 | 根因 |
|---|---|---|
| `npm run lint` | 92708 errors / 49 warnings，退出码 1 | 26 个文件报错，其中 23 个是 `test/scripts-regression/candidates/` 的第三方社区音源脚本，贡献 92705 errors；本项目源码仅 3 errors + 1 warning |
| `npx tsc --noEmit` | 23 errors，退出码 2；无任何 CI 工作流执行它 | 17 个在 `src/utils/ciSelfTest.ts`（属 `add-ios-support` 范围），6 个在既有业务文件 |
| `openspec list` | `add-ios-support 27/42 tasks` | `tasks.md` 第 1 行为脚手架残留 `* [ ]`，被解析成第 42 个未完成任务；真实为 27/41 |

两处 README 数字漂移（均本次实测）：

| README 位置 | 写的 | 实际 | 事实源 |
|---|---|---|---|
| 第 92 行 | 任务进度 23/41 | 27/41 | `grep -c '^- \[X\]' tasks.md` = 27 |
| 第 83、90 行 | 应用内 13 项自测 | 25 项 | `ciSelfTest.ts` 中 `runTest(` 调用 25 处 |

## 目标设计

### 事实源分层落位

```text
README.md                 入口事实：项目是什么、怎么跑、规范在哪（增量追加工作流入口段）
AGENTS.md                 规则事实：技术栈底线、OpenSpec 条件、skills 门禁、验证矩阵、同步纪律
CLAUDE.md                 客户端差异：Claude 专属补充，显式声明以 AGENTS.md 为准
spec/requirements.md      长期需求、业务边界、非目标
spec/design.md            长期架构、模块边界、原生桥接契约、平台扩展机制
spec/structure.md         目录结构与职责归属
docs/tooling-sources.md   工具来源与核验版本表
docs/*.md                 历史方案与专题材料（不动）
openspec/changes/<name>/  单次变更过程（不动既有内容，除脏行）
```

分层判据：可从代码直接读出的结构信息进 `spec/structure.md`；跨模块契约与不可从单文件推断的约束进 `spec/design.md`；业务边界与非目标进 `spec/requirements.md`；AI 行为约束进 `AGENTS.md`。

### 门禁真实化方案

`.eslintrc.cjs` 的 `ignorePatterns` 追加 `test/scripts-regression/candidates`。

选择 `ignorePatterns`（而非 `.eslintignore` 新文件）的理由：项目已在 `.eslintrc.cjs` 用 `ignorePatterns` 管理 `node_modules`、`*.min.js`、`test.js`、`*Test.ts`，追加一行与现有约定一致，不新增配置文件。

不选的方案与原因：

- 给 23 个第三方脚本加 `/* eslint-disable */` —— 改写第三方原文，破坏回归集的「原文入库」语义（`test/scripts-regression/README.md` 与 `.gitignore` 均表明入库的是解压后原文）。
- 跑 `lint:fix` 格式化第三方脚本 —— 同上，且会让 `ci-expect.json` 的断言基准与脚本内容脱钩。

`tsc --noEmit` 不进 CI：当前 23 个错误中 17 个属活跃 change 范围，加门禁会立即阻断 `dev-ios`。本次只在 `AGENTS.md` 记录真实状态、错误数与建议路径。

补充实测发现（供后续 change 参考，本次不实施）：在 `tsconfig.json` 加 `moduleSuffixes: [".ios", ".android", ".native", ""]` 可消除 `src/utils/tools.ts` 的 `Cannot find module './toast'` 一类平台扩展解析错误，但会新暴露 4 个此前被掩盖的错误（`src/core/common.ts` 2 个、`ChoosePath/index.tsx` 1 个、`OpenStorageModal.tsx` 1 个），错误总数 23→25。已实测并还原 `tsconfig.json`，本次不改。

### 任务计数修正

删除 `openspec/changes/add-ios-support/tasks.md` 第 1 行 `* [ ]` 与紧随的空行。该行位于首个 `## 1. Phase 0` 标题之前，无任何任务语义，是脚手架残留。不触碰任何真实任务行与勾选状态。

## CodeGraph 影响面

- 查询命令：
  - `codegraph sync .` —— 同步索引（新增 52 / 修改 13 / 移除 2 文件，2119 节点，4.0s）
  - `codegraph status` —— 654 文件 / 6883 节点 / 16208 边（sync 前基线）
  - `codegraph query "playMusic"` / `codegraph callers "playMusic"` —— 定位播放链路
  - `codegraph query "ciSelfTest"` —— 定位自测入口
  - `codegraph impact "aesEncrypt"` —— 36 个受影响符号
  - `codegraph node index.js` —— 应用入口
  - `codegraph node "src/utils/nativeModules/crypto.ts"` —— 原生桥接面
  - `codegraph explore "app 启动 初始化 init"` —— 启动链与原生模块注册

- 入口：`index.js` → `./shim` + `./src/app`（`codegraph node index.js` 实测）
- 调用链（用于填 `spec/design.md` 的模块边界）：
  - 加密：`src/utils/nativeModules/crypto.ts` → `CryptoModule`（原生）；`src/plugins/sync/utils.ts`、`src/utils/musicSdk/wy/utils/crypto.js` 为主要消费方
  - 播放：`src/plugins/player/utils.ts:setResource` → `playMusic`（`src/plugins/player/playList.ts:191`）
  - 原生模块注册：`createNativeModules → UtilsModule`，`cn.toside.music.mobile` 导入 `CachePackage` / `CryptoPackage` / `LyricPackage` / `UserApiPackage` / `UtilsPackage`（`explore` 实测，佐证五模块清单）

- 影响面：**本次变更为纯文档与配置改动，CodeGraph 影响面为空** —— 不修改任何被索引的源码符号。CodeGraph 在此的作用是为 `spec/design.md` 与 `spec/structure.md` 提供可核验的结构事实，而非评估改动风险。

- 候选测试：`npx vitest run`（唯一自动化测试载体，与本次改动无关，用作回归基线）

## 盲区补充（rg / 源码精读）

CodeGraph 不覆盖以下项，均已用 `grep`/`find`/直接读文件补齐：

| 盲区 | 补盲方式与发现 |
|---|---|
| ESLint 配置 | 读 `.eslintrc.cjs`：现有 `ignorePatterns` 为 `node_modules`、`*.min.js`、`test.js`、`*Test.ts`；TS 走 `standard-with-typescript` override |
| CI 门禁位置 | `grep -rn 'npm run lint\|tsc\|npm test' .github/workflows/`：仅 `build-test.yml:25` 跑 lint（触发条件 `pull_request → dev`），`ios-verify.yml:52` 跑 `npm test`；无 tsc |
| gitignore 覆盖 | `git check-ignore -v .claude/settings.local.json` → 命中 `/home/openclaw/.config/git/ignore`，即**仓库外**的用户级规则；仓库自身 `.gitignore` 未覆盖 |
| CodeGraph 产物 | `.codegraph/.gitignore` 自带 `*` + `!.gitignore`，已自管；根 `.gitignore` 无需重复 |
| 自测用例真实数 | `grep -nE "runTest\(" src/utils/ciSelfTest.ts` → 25 项 |
| tasks 脏行 | `sed -n '1,2p' tasks.md \| cat -A` → `* [ ]$`，确认是残留占位而非任务 |
| skills 三份是否软链 | `ls -la` + `md5sum`：三份为独立实体目录，同名文件内容一致 |
| 平台扩展文件 | `find src -name '*.ios.*' -o -name '*.android.*'` → 6 个：`fs.ios.ts`、`localMediaMetadata.ios.ts`、`nativeModules/lyricDesktop.ios.ts`、`toast.android.ts`、`toast.ios.tsx`、`version.ios.js` |
| 目录规模 | `find` 计数：`screens` 222、`utils` 128、`components` 71、`core` 54、`store` 47、`plugins` 27 文件 |

## 异常路径

| 情况 | 处理 |
|---|---|
| 加 `ignorePatterns` 后 `npm run lint` 仍非 0 | 不声称门禁达成；如实报告剩余违规（预期为 `src/` 3 处已登记项），由用户决定是否单独修 |
| `openspec validate --all` 因新 change 失败 | 修工件直至通过；不通过不进入实现阶段 |
| 新增 `AGENTS.md` 与 `.claude/skills/` 描述冲突 | 以 skills 为流程权威，`AGENTS.md` 只引用其名称与触发条件，不重述其内部步骤 |
| `spec/` 某条事实无法当场核验 | 标注「待核验」并给出核验方式，不写成既成事实 |

## 回滚策略

全部改动为文档新增 + 两处配置追加 + 一行删除，无构建产物、无依赖变化、无数据迁移：

- 新增文件：`git rm` 或直接删除（`AGENTS.md`、`CLAUDE.md`、`spec/*`、`docs/tooling-sources.md`、本 change 目录）
- 改动文件：`git checkout -- .eslintrc.cjs .gitignore README.md openspec/changes/add-ios-support/tasks.md`
- 回滚后 `npm run lint` 回到 92708 errors 的原状态，其余门禁不受影响

风险等级：低。不触碰 `src/`、`ios/`、`android/`、`rust/`、CI 工作流。

## 验证策略

| 验证项 | 命令 | 通过判据 |
|---|---|---|
| 回归基线（改动前已跑） | `npx vitest run` | 1 文件 4 用例 PASS |
| 风格门禁真实化 | `npm run lint` | 退出码 0；若非 0，剩余违规必须全部是 proposal 已登记的 `src/` 3 处，且如实报告 |
| 第三方脚本已排除 | `npx eslint test/scripts-regression` | 无文件被检查 |
| OpenSpec 一致性 | `openspec validate --all` | 全部通过 |
| 任务计数真实 | `openspec list` | `add-ios-support` 显示 27/41 |
| README 数字一致 | `grep -c '^- \[X\]' openspec/changes/add-ios-support/tasks.md`、`grep -c 'runTest(' src/utils/ciSelfTest.ts` | 与 README 文本一致 |
| 未提交内容未被动 | `git status --short` | `evidence/g1-report.md` 仍为 `??`，无其他意外改动 |
| 私有产物已忽略 | `git check-ignore -v .claude/settings.local.json .worktrees` | 命中仓库自身 `.gitignore` |

不运行：iOS 构建、模拟器冒烟、Android 打包、Rust 交叉编译 —— 本次零代码改动，且本机为 Linux 无 Xcode。
