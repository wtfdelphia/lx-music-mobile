# 工具来源与版本口径

记录本项目 AI 协作与工程化链路所依赖的工具：从哪来、什么版本、怎么装、产物是否入库。目的是让任何人（或任何 agent）能复现同一套环境，并且不把本机产物误提交。

版本以本文表格为准；表格里的版本号是**实测输出**，非文档推断。核对方式列出了取值命令，环境有变时按同样命令重取并更新本文。

## 项目内工具（随仓库锁定）

这些工具由 `package.json` + `package-lock.json` 管理，`npm ci` 后即可用，不需单独安装。

| 工具 | 声明版本 | 实测版本 | 取值命令 | 用途 |
|---|---|---|---|---|
| Node | `>=18`（engines）/ `v22`（`.nvmrc`） | 本机 v26.5.1 | `node -v` | 运行时。CI 用 `.nvmrc` 的 `v22`；本机版本高于 CI 属正常，行为差异以 CI 为准 |
| npm | 随 Node | 本机 12.0.2 | `npm -v` | 依赖管理。**用 `npm ci` 而非 `npm install`**，避免动 lock |
| vitest | `^4.1.11` | 4.1.11 | `npx vitest --version` | 单元测试，`npm test` |
| eslint | 由 `@react-native/eslint-config` 传递引入（未直接声明） | 8.57.1 | `npx eslint --version` | 代码风格，`npm run lint` |
| TypeScript | `^5.9.3` | 5.9.3 | `npx tsc --version` | 类型检查（当前 23 errors，无 CI 覆盖，见 `AGENTS.md`） |

eslint 配置链：`.eslintrc.cjs` → `@react-native/eslint-config` + `eslint-config-standard` `^17.1.0` + `eslint-config-standard-with-typescript` `^43.0.1`。eslint 本体没在 `package.json` 直接声明，是配置包的传递依赖——升级 RN 或配置包时可能连带变主版本，改 lint 规则前先确认实装版本。

## 需单独安装的工具（本机全局，不随仓库）

| 工具 | 实测版本 | 取值命令 | 用途 | 安装 |
|---|---|---|---|---|
| OpenSpec | 1.8.0 | `openspec --version` | 规格驱动工件管理，`openspec/` 目录的读写与校验 | 见下 |
| CodeGraph | 1.5.0 | `codegraph --version` | 本地代码图谱，调用链与影响面查询 | 见下 |
| Rust toolchain | stable（本机 rustc 1.97.1） | `rustc --version` | iOS 加密核心编译；CI 用 `dtolnay/rust-toolchain@stable` | `rustup` |

### OpenSpec

- schema：`spec-driven`（见 `openspec/config.yaml`）
- 四工件顺序依赖：`proposal.md` → `specs/*/spec.md` → `design.md` → `tasks.md`
- 常用命令：`openspec new change <name>`、`openspec instructions <artifact>`、`openspec status --change <name>`、`openspec validate --all --strict`、`openspec list`
- specs 格式硬要求（不满足会静默失败或 `--strict` 报错）：
  - Scenario 标题**必须恰好 4 个 `#`**（写 3 个不会报错，但不会被识别）
  - 新 capability 必须有 `## Purpose`，且不少于 50 字符
  - 每个 Requirement 至少 1 个 Scenario
  - 需求语句用 SHALL / MUST
- 版本升级注意：schema 或校验规则变更会影响既有 `openspec/changes/` 工件，升级后先跑 `openspec validate --all --strict` 全量确认

### CodeGraph

- 索引数据落 `.codegraph/codegraph.db`，**本机产物**，由 `.codegraph/.gitignore`（`*` + `!.gitignore`）自忽略，该 `.gitignore` 本身入库
- 改动代码后先 `codegraph sync .` 再查询，否则结果过期
- 常用：`query` / `callers` / `callees` / `impact` / `explore` / `node` / `sync` / `status` / `files`
- **`codegraph files` 不支持 `--depth` 参数**，需要目录层级用 `find -maxdepth`
- 覆盖盲区（原生桥接契约、ObjC/Java 运行时、CI 工作流、配置文件、fork 依赖行为等）与补盲方式见 `AGENTS.md` 上下文获取章

### Rust

- 工作区 `rust/lxcore`，crate `lxcore-crypto`，产物为 C ABI staticlib
- 仅 iOS 链接，Android 构建不引入
- 交叉编译目标：`aarch64-apple-ios`、`aarch64-apple-ios-sim`、`x86_64-apple-ios`
- 命令用 `--locked`（`cargo test --locked` / `cargo build --locked`），保证 CI 与本地一致

## AI 客户端规则文件

| 路径 | 面向 | 说明 |
|---|---|---|
| `AGENTS.md` | 全部 agent | 项目通用规则唯一来源 |
| `CLAUDE.md` | Claude Code | 只写客户端专属差异，通用规则指向 `AGENTS.md` |
| `.agents/skills/` | 通用 | 12 个 skill |
| `.codex/skills/` | Codex | 同上内容副本 |
| `.claude/skills/` | Claude Code | 同上内容副本 |

三份 skills 副本内容一致，**手工同步**，改一处要同步另两处。客户端不支持 skills 时须等价遵循流程并输出同样的证据。

## CI 中的工具

| 工作流 | 触发 | 用到的工具 |
|---|---|---|
| `ios-verify.yml` | push | Node（`.nvmrc`）、npm、vitest、Metro、Rust stable、CocoaPods、Xcode（macos-15 / Xcode 16）、iOS Simulator、Gradle |
| `build-test.yml` | **仅 PR → `dev`** | Node、npm、eslint |
| `rust.yml` | — | Rust stable |

`build-test.yml` 的触发范围是已知缺口：`dev-ios` 的 push 不跑 lint，本地需自查（详见 `AGENTS.md`）。

## 不应提交的产物

| 路径 | 忽略规则位置 | 原因 |
|---|---|---|
| `node_modules/` | 根 `.gitignore` | 依赖，由 lock 复现 |
| `.codegraph/*`（除 `.gitignore`） | `.codegraph/.gitignore` | 本机索引数据库、pid、socket、日志 |
| `.worktrees/` | 根 `.gitignore` | git worktree 临时目录 |
| `.claude/settings.local.json` | 根 `.gitignore` | 本机客户端配置，含个人偏好与权限授予 |
| `rust/**/target` | 根 `.gitignore` | Rust 构建产物 |
| `ios/rust-libs/` | 根 `.gitignore` | staticlib 构建产物 |
| `test/scripts-regression/candidates/*.zip` | 根 `.gitignore` | 只入库解压后的 `.js` |
| token / Cookie / 账号密码 / keystore / 签名证书 / `.env` | 不入库 | 凭据。文档中引用只写键名不写值 |

`.claude/settings.local.json` 与 `.worktrees/` 此前只靠仓库外的用户级 git ignore 兜住，换机器或换用户就失效——现已写入仓库自身 `.gitignore`。
