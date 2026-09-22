# fork 版本更新路径与发布流水线分析

分析日期：2026-09-10，2026-09-22 更新。分支基线：`main`（`c2ea32a`，已含
dev-ios 合并与上游 v1.8.4）。fork 仓库为 `wtfdelphia/lx-music-mobile`
（remote `origin`），上游为 `lyswhut/lx-music-mobile`（remote `cloud`）。

本文回答两个问题。第一，fork 的应用内版本更新链路，当前哪些环节有问题，怎么修。
第二，在「`master` 镜像上游、`main` 手动合并上游并发版」的分支模型下，构建与
发布流水线要怎么改。

结论先行：更新检测的代码逻辑没坏，坏的是它的指向。整条链硬编码在上游身份上，
fork 侧没有任何自己的版本发布通道，发布工作流也只认 `master` 分支，而发版动作
将来发生在 `main`。README 的下载入口也和 fork 的实际分发方式冲突。当前不出事
只是因为 fork 与上游版本号恰好都是 1.8.4。

## 更新检测路径

链路从启动到弹窗共四步：

1. 应用初始化时触发检查：`src/core/init/index.ts:24` 调 `checkUpdate()`，
   首次同意协议弹窗后也会触发一次（`src/navigation/components/PactModal.tsx:91`）。
2. `src/core/version.ts` 的 `checkUpdate()` 调平台扩展的 `getVersionInfo()`，
   Metro 按平台解析：Android 走 `src/utils/version.js`，iOS 走 `src/utils/version.ios.js`。
3. `getVersionInfo()` 按顺序尝试 8 个数据源，第一个成功的即返回。拿到远端
   `version` 后与本机 `process.versions.app` 用 `compareVer` 比较。
4. 有更高版本就弹更新弹窗；用户确认后走 `downloadNewVersion()`：
   Android 直接下载 APK 并调 `installApk`，iOS 用 `Linking.openURL` 跳转 Releases 页面。

8 个数据源由 `package.json` 的 `author.name`（值 `lyswhut`）和 `name`
（值 `lx-music-mobile`）拼出，两个平台文件内容一致：

| 序号 | 地址 | 归属 |
|---|---|---|
| 1 | `https://raw.githubusercontent.com/lyswhut/lx-music-mobile/master/publish/version.json` | 上游仓库 |
| 2 | `https://registry.npmjs.org/lx-music-mobile-version-info/latest` | 上游发布的 npm 包 |
| 3-5 | `cdn.jsdelivr.net` / `fastly.jsdelivr.net` / `gcore.jsdelivr.net` 上的上游 `publish/version.json` | 上游仓库的 CDN 镜像 |
| 6 | `https://registry.npmmirror.com/lx-music-mobile-version-info/latest` | 同 2 的镜像 |
| 7 | `https://gitee.com/lyswhut/lx-music-mobile-versions/raw/master/version.json` | 上游的 gitee 仓库 |
| 8 | `http://cdn.stsky.cn/lx-music/mobile/version.json` | 作者自有 CDN |

8 个源全部指向上游，fork 在这条链路上没有自己的发布面。

## 问题清单

| # | 问题 | 证据 | 发作条件 | 严重度 |
|---|---|---|---|---|
| 1 | 更新数据源全部指向上游 | `version.js:16-23`、`version.ios.js:8-15` 由 `author.name` 拼地址；fork 改自己的 `publish/version.json` 也没有客户端会读 | 结构性问题，靠版本号巧合不发作 | 高 |
| 2 | iOS「前往更新」跳转上游 Releases | `version.ios.js:69,73` 打开 `github.com/lyswhut/lx-music-mobile/releases`，上游只发 Android APK，没有 iOS 包 | 上游发布高于 1.8.4 的版本后立即发作 | 高 |
| 3 | Android 更新下载上游 APK | `version.js:89` 下载地址拼上游 Releases；fork 用户若已装 fork 自打包，更新时拉到上游 APK，签名不一致装不上 | 同 2 | 高 |
| 4 | fork 侧没有版本信息推送通道 | `release.yml` 只在 push 到 `master` 时触发（现主干是 `main`，永不触发）；`publish-version-info.yml` 需要 `secrets.PAT` dispatch 到上游的 `lyswhut/lx-music-mobile-version-info` 仓库，fork 既无此凭据也无权写该 npm 包 | 想建立自己的更新通道时才发现无路可走 | 高 |
| 5 | README 下载入口指向错误 | `README.md:32,34,36` 的「更新日志」「软件下载」「原始发布地址」全部链到 `lyswhut/lx-music-mobile`；与同页「iOS 适配状态」要求用户从 fork 的 `ios-verify` CI Artifact 取 IPA 互相矛盾 | 现在就错，与版本号无关 | 中 |

仓库内的 `publish/version.json` 内容是 `{"version":"1.8.4",...}`，这是上游随
v1.8.4 带来的发布数据。它由 `npm run publish`（`publish/index.js`）维护，
历史上由上游的发布流程写入。fork 从未自己更新过这个文件。

## 为什么现在没有症状

`checkUpdate()` 的比较结果是 `compareVer('1.8.4', '1.8.4') != -1`，
即 `isLatest = true`，不弹窗、不跳转。这是版本号巧合，不是链路正确。
上游一旦发布 1.8.5 或 1.9.0，问题 2 和问题 3 立即显现：

- iOS 用户收到更新弹窗，点「前往更新」进入上游 Releases 页面，那里没有 iOS 包；
- Android 用户下载的是上游签名的 APK，与已安装的 fork 包签名冲突，安装失败。

## 问题归类

三类问题性质不同，修复动作也不同：

1. 更新检测路径：代码逻辑没坏，坏的是指向。数据源、下载、跳转全部由
   `package.json` 身份拼出，指向上游。修复靠改身份或改地址构造。
2. 版本推送：在 fork 侧完全不存在。触发条件（`master` vs `main`）、
   凭据（`secrets.PAT`）、目标仓库（上游的 version-info 仓库）三处都对不上。
   修复靠新建 fork 自己的发布工作流。
3. README：独立于版本机制的既有错误。下载入口写上游，正文又要求用户从
   fork 的 CI Artifact 装 IPA。修复靠改文档，不依赖前两项。

## 修复方案

修复前先定几个决策点，选项不同，方案差很多。

### 决策点 1：fork 是否要独立版本节奏

方案 A，fork 独立更新通道（推荐，如果 fork 会持续发版）：

- 修改 `package.json` 的 `name` 或 `author.name`，让地址构造指向
  `wtfdelphia/lx-music-mobile`。两个平台文件无需逐条改地址，改身份即可生效。
- fork 仓库自己维护 `publish/version.json`，fork 发版时更新。
- 注意 `version.js:89` 的 APK 下载名也含 `${name}`，改 `name` 时要同步
  `release.yml` 产出的 APK 文件名，两处保持一致。
- 代价：与上游同名身份脱钩，后续合并上游时 `package.json` 与
  `version.js` / `version.ios.js` 会成为固定冲突点，需要在合并流程中登记。

方案 B，保持上游身份，放弃应用内更新：

- 不改代码，接受「检查更新永远读上游」。
- 把应用内的更新提示改造成指向 fork 自己的分发页面（改动仍在两个平台文件）。
- 适合「只自己用、不对外发版」的定位。

### 决策点 2：iOS 分发渠道

- 选项 1：fork GitHub Release 固定挂 IPA。地址长期有效，能支撑应用内更新
  提示的跳转目标。需要解决签名问题：未签名 IPA 挂 Release 后仍需用户自行
  重签，和现在的流程一致，只是取包地点从 CI Artifact 换成 Release。
- 选项 2：维持现状用 `ios-verify` CI Artifact。Artifact 只保留 30 天，
  做不了长期更新渠道，选它等于放弃应用内更新提示，只能靠 README 引导手动下载。

### 决策点 3：Android 发布工作流

若选方案 A：`release.yml` 的触发分支从 `master` 调整为 `main`，或新建
fork 专用发布工作流；`publish-version-info.yml` 改造为把版本信息写到
fork 自己的载体（fork 仓库的 `publish/version.json` 由发版流程直接提交即可，
不一定需要 npm 包）。

### README 修复

与上面两个决策无关，可以单独先做：

- 「软件下载」「更新日志」「原始发布地址」三处链接改指
  `wtfdelphia/lx-music-mobile`，或按决策点 2 的结论指向对应分发渠道；
- 与「iOS 适配状态」一节的取包方式描述对齐，消除同一页面内两种说法的矛盾。

各决策点的推荐选择与完整落地方案见下文「推荐方案」一节。

## 发布构建与版本发布链路

这一节说明上游现状的 CI 如何构建并发布版本，作为 fork 改造的事实基础。
工作流文件共 6 个，与发版直接相关的是 `release.yml` 和
`publish-version-info.yml` 两个。

### 上游发版工作流

`release.yml` 名为 Build，触发条件只有一个：`push` 到 `master`
（`.github/workflows/release.yml:4-6`）。两个 job 串行：

`Android` job 在 `ubuntu-latest` 上：

1. `.github/actions/setup` 装环境。Node 按 `.nvmrc`（v22），JDK 17
   （microsoft 发行版），gradle 与 npm 双层缓存，`npm ci`。
2. 把 `secrets.KEYSTORE_STORE_FILE_BASE64` base64 解码还原为
   `android/app/${{ secrets.KEYSTORE_STORE_FILE }}`，带 4 个签名参数跑
   `./gradlew assembleRelease`（`DISABLE_SVG=1`），构建完立即删除还原的
   keystore 文件。
3. 读 `package.json` 版本号，用 `pkgdeps/git-tag-action@v3` 打
   `v{version}` tag，tag 已存在则跳过。
4. `md5sum` 产物，上传 5 个 APK artifact。

`Release` job（needs Android）：

1. 下载 artifacts，把 APK 的 MD5 与安装包说明链接追加进
   `publish/changeLog.md`。
2. `softprops/action-gh-release@v2` 创建 GitHub Release，tag
   `v{version}`，正文即 `changeLog.md`，挂 5 个 APK。

Release published 事件再触发 `publish-version-info.yml`：用
`secrets.PAT` 向 `lyswhut/lx-music-mobile-version-info` 仓库发
`npm-release` 类型的 `repository_dispatch`，由那个仓库的流水线把版本信息
发布成 npm 包。应用内检查更新的第 2、6 号数据源读的就是这个包。

### 构建覆盖面

| 维度 | 覆盖情况 |
|---|---|
| Android ABI 变体 | 全覆盖。`build.gradle` 开 `splits.abi` + `universalApk`，产出 `arm64-v8a`、`armeabi-v7a`、`x86_64`、`x86`、`universal` 共 5 个。逐 ABI 包 `versionCode` 为 `versionCode * 1000 + abi 序号` |
| beta 版 | `beta-pack.yml` 在 `beta` 分支构建同样的 5 个 APK，只传 artifact 不建 Release，也不打 tag |
| 特别版 | `Android_SL`（状态栏歌词）与 `Android_5`（低版本安卓）两个 job 在 `release.yml` 里整段注释，不再构建 |
| iOS | 不在发布链路。`ios-verify.yml` 五个 job（JS 门禁、Rust 交叉编译、未签名构建 + IPA、模拟器冒烟、Android 回归）全是验证性质，产物是未签名 IPA artifact，没有签名与发布步骤 |
| AAB | 不产出，只出 APK |

### 版本号来源与人工发版动作

版本号唯一来源是 `package.json` 的 `version` 与 `versionCode`，
`build.gradle` 用 `JsonSlurper` 直接读取，APK 文件名拼为
`lx-music-mobile-v{version}-{abi}.apk`。

上游发版前由人工执行两步：把本版更新说明写进 `publish/changeLog.md`，
然后跑 `npm run publish <新版本号>`。这个脚本（`publish/index.js`）做四件事：
把当前 `version.json` 的 version/desc 移入 `history` 头部、写入新版本号与
新说明、更新 `package.json` 的 `version` 并把 `versionCode + 1`、在
`CHANGELOG.md` 头部插入带 compare 链接的版本段落。之后提交推送 `master`，
CI 接管。

### fork 现状与差距

1. `release.yml` 只认 `master`。fork 的 `main` 领先 `master` 8 个提交
   （含 iOS 支持合并 `bf16638`），从 `main` 推构建不会发生。
2. `main` 的 `package.json` 仍是 `version: 1.8.4`、`versionCode: 76`，
   与上游已发布的 `v1.8.4` tag 相同。不 bump 直接走发布流程，
   `git-tag-action` 会跳过、`gh-release` 因 tag 已存在而失败。
3. fork 仓库（wtfdelphia）需要自配 5 个签名 secrets 才能出包：
   `KEYSTORE_STORE_FILE_BASE64`、`KEYSTORE_STORE_FILE`、
   `KEYSTORE_KEY_ALIAS`、`KEYSTORE_PASSWORD`、`KEYSTORE_KEY_PASSWORD`。
   没有上游的 `PAT`，`publish-version-info.yml` 在 fork 侧必然失败。
4. 应用内检查更新读的是上游 `lyswhut/lx-music-mobile` 的 master 分支，
   fork 即使发了版，客户端也不知道。

## 推荐方案

目标分支模型：`master` 及时拉取上游最新版本、只做镜像，`main` 手动合并
上游并发布版本、推送构建。以下按决策点给出推荐选择，再给完整落地步骤。

### 决策点汇总

| 决策点 | 推荐选择 | 理由 |
|---|---|---|
| 1 版本通道 | 方案 A，fork 独立更新通道 | 只要持续发版就需要自己的通道；只改 `author.name` 即可让地址构造整体转向，逐条改地址反而更碎 |
| 2 iOS 分发 | 选项 1，GitHub Release 固定挂未签名 IPA | Artifact 只保留 30 天，做不了长期更新渠道。挂 Release 后地址稳定，应用内「前往更新」有固定落点。用户仍需自行重签，与现状一致 |
| 3 Android 发布工作流 | 改造现有 `release.yml`，触发分支改 `main` | fork 没有多套发布需求，新建并行工作流只会重复维护；`publish-version-info.yml` 整体禁用 |
| 版本号策略 | 上游版本号 + fork 递增后缀 | 见下节详述 |

### 一、工作流改动

| 文件 | 改动 | 原因 |
|---|---|---|
| `release.yml` | 触发分支 `master` → `main` | 发版动作发生在 `main`；`master` 推上游内容不应触发构建 |
| `publish-version-info.yml` | 删除或禁用 | 依赖上游 `PAT` 与上游 version-info 仓库，fork 两者皆无。每次发 Release 都会红一个 job。fork 的版本信息由仓库内 `publish/version.json` 直接分发，不需要 npm 通道 |
| `ios-verify.yml` | 不动 | 已覆盖 `main`，发版 push 自动跑全量验证 |

可选进阶项：`release.yml` 目前只出 Android。若要 iOS 包也进 Release，
在 `release.yml` 里加一个 macOS job，复用 `ios-verify.yml` ios-build 的
步骤产出未签名 IPA 挂到同一个 Release。代价是 macOS 分钟数。注意
`release.yml` 与 `ios-verify.yml` 是两个并行工作流，不存在「验证通过才
发版」的依赖；要这个语义就把 iOS 构建并进 `release.yml`，或用
`workflow_run`。

### 二、身份与更新渠道

| 文件 | 改动 | 影响面 |
|---|---|---|
| `package.json` | `author.name` 改为 fork 身份；`repository.url` 改为 fork 仓库地址 | `author` 在 `src/` 里只被 `version.js` 与 `version.ios.js` 消费，影响面就是这一条链。`name` 保持 `lx-music-mobile` 不动，否则 `build.gradle` 产出的 APK 文件名与 `version.js:89` 的下载 URL 都要跟着改 |
| `src/utils/version.js`、`version.ios.js` | 源列表换成 fork 自己的 `publish/version.json`，raw 地址的分支段 `master` 是硬编码字符串，要一并改成 `main`。删掉上游 npm、jsdelivr、gitee、stsky 源 | 保留上游源的降级路径有投毒风险：fork 直连失败时会 fallback 到上游版本信息，诱导用户下载上游签名的包 |
| `README.md` | 下载入口三处链接改指 fork 仓库，与「iOS 适配状态」的取包描述对齐 | 独立于工作流改动，可以先做 |

### 三、版本号策略

推荐「上游版本号 + fork 递增后缀」：如 `1.8.4.1`、`1.8.4.2`，上游发
1.8.5 后合并，下一版 `1.8.5.1`。依据：

- `compareVer`（`src/utils/index.ts:9-25`）按 `.` 分段数值比较，
  `1.8.4.1 > 1.8.4` 成立，四段版本无兼容问题。字母后缀会被替换成负数
  参与比较，`1.8.4-fork.1` 这类写法不要用。
- tag 永不与上游冲突。fork 的 `v1.8.4.1` 和从上游 fetch 来的 `v1.8.5`
  各占各的，`git-tag-action` 不会撞车。
- 不推荐 fork 直接递增上游版本号（1.8.5、1.8.6）。上游随后发真的 1.8.5
  时，fork 仓库会出现同名 tag 冲突。

`versionCode` 单独递增。合并上游时取「上游新值与 fork 现值的较大者」，
发版时 `npm run publish` 再 +1。

### 四、上游合并的固定冲突面

上游发版提交只动 4 个文件（`d295604 发布 v1.8.4` 的 stat 已验证）：
`package.json`、`package-lock.json`、`publish/version.json`、
`CHANGELOG.md`。fork 发版也恰好改这 4 个，所以每次合并的冲突集合是
确定且可预期的，解法固定：

1. `git fetch cloud master --tags`，本地 `master` 快进到上游，推给
   `origin`。fork 的 `master` 纯镜像，因触发条件已改不会引发构建。
2. `main` 合并 `master`。4 个冲突文件一律先取上游值，`package.json` 中
   保留 `author.name`、`repository.url` 两处 fork 字段。
3. `publish/version.json` 结构化合并：取上游的 `version`/`desc`，把 fork
   上一版的条目塞进 `history` 顶部。
4. 合并后重新执行发版流程，让版本号在干净基线上重新 bump。

### 五、发版操作流程（`main` 上）

1. 写 `publish/changeLog.md`。
2. `npm run publish 1.8.5.1`，更新 `version.json`、`package.json`、
   `CHANGELOG.md`。
3. 提交，推 `main`。`release.yml` 自动执行：签名构建 5 个 ABI APK，打
   `v1.8.5.1` tag，建 Release，正文为 changeLog + MD5。
4. 若 iOS 走选项 1，同一次流程产出未签名 IPA 挂在同一 Release。

### 六、fork 仓库配置清单

- Secrets：自建 5 个签名凭据，键名同上游（见「fork 现状与差距」第 3 条）。
  必须是 fork 自己的 keystore，新签名身份意味着从上游包覆盖安装会提示
  签名不一致。
- 仓库 Settings → Actions → Workflow permissions 需要读写（打 tag +
  建 Release），默认只读会静默失败。
- 不需要 `PAT`。

## 执行门禁

按 `AGENTS.md` 的 OpenSpec 门禁，决策点 1 与 3 触及发布配置（版本号、
`package.json` 身份、发布工作流触发条件），决策点 2 触及发布渠道，
都属于必须先建 `openspec/changes/<name>/` 的场景。建议 change 名
`fork-update-channel`，按 `openspec-propose` 或 `openspec-new-change` 起草。

另注意：`main` push 不触发 `build-test.yml`（仅 PR→`dev`），lint 没有
CI 兜底。按 `AGENTS.md` 纪律，在 `main` 上改代码后本地跑 `npm run lint`。

README 链接修正属于文档同步，不需要建 change，但改完后要过 `humanizer-zh`。

## 证据索引

更新检测链路：

- `src/utils/version.js:16-23` Android 数据源地址构造
- `src/utils/version.js:89` Android APK 下载地址
- `src/utils/version.ios.js:8-15` iOS 数据源地址构造
- `src/utils/version.ios.js:69,73` iOS 更新跳转
- `src/core/version.ts` 版本比较与弹窗逻辑
- `src/core/init/index.ts:24` 启动时触发检查
- `src/utils/index.ts:9-25` `compareVer` 实现，版本号策略的依据
- `publish/version.json` 当前值 1.8.4（上游内容）

构建发布链路：

- `.github/workflows/release.yml:4-6` 触发条件 `branches: [master]`
- `.github/workflows/release.yml` Android job 签名构建步骤与 `git-tag-action`
- `.github/workflows/publish-version-info.yml:15-17` 依赖 `secrets.PAT` 与
  上游 `lyswhut/lx-music-mobile-version-info` 仓库
- `.github/workflows/beta-pack.yml` beta 分支只出 artifact
- `.github/workflows/ios-verify.yml:4-8` 验证工作流覆盖 `master`、
  `dev-ios`、`main`
- `android/app/build.gradle:140` CI 签名配置入口
- `android/app/build.gradle:186-191` APK 文件名与逐 ABI `versionCode`
- `package.json:3-4` 当前 `version: 1.8.4`、`versionCode: 76`
- `publish/index.js` 人工发版脚本的四步动作
- 提交 `d295604 发布 v1.8.4` 的 stat：上游发版提交只改 4 个文件，
  冲突面结论的依据
- `README.md:32,34,36` 下载入口链接
