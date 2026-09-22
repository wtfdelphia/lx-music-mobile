## Context

分析底稿为 `docs/update-channel-analysis.md`，本文只记录实现层面的
决策与理由。前置事实：

- 上游于 2026-09 重写 `master` 历史（squash），fork 的 `main` 与新
  上游无共同祖先。本次上游同步以 `git replace --graft` 把上游新根
  嫁接回旧基线 `d295604`（v1.8.4）后做三方合并，只余 3 处真实冲突。
  嫁接 ref 仅本地临时使用，提交后已删除。
- `release.yml` 触发分支 `master` → `main` 已随 PR #2 落地。
- fork 仓库的 5 个 `KEYSTORE_*` 签名 secrets 与 workflow 读写权限
  已由仓库管理员配置。

## Decisions

### D1：改 `author.name` 完成身份切换，不逐条改地址

`src/` 内 `author` 字段的消费点只有 `version.js` 与 `version.ios.js`
两个文件（已用 `rg` 核实），数据源、APK 下载地址、iOS 跳转地址全部
由 `author.name` + `name` 拼出。把 `author.name` 从 `lyswhut` 改为
`wtfdelphia`，全部地址自动转向。`name` 保持 `lx-music-mobile`：它是
APK 文件名前缀（`build.gradle` 的 `applicationName`）与 Release
附件名的一部分，改动会牵动构建产物命名。

### D2：数据源列表收敛为单一来源

上游实现有 8 个源的降级链（npm、jsdelivr、gitee、自建 CDN）。
fork 侧保留降级链意味着任一源失败时回退到别的载体，而这些载体
要么属于上游（错误身份，诱导下载上游签名包），要么需要额外维护
（npm 包、镜像仓库）。fork 的受众规模不需要这种可用性设计。
收敛为单源：`wtfdelphia/lx-music-mobile` `main` 分支的
`publish/version.json` raw 地址。检查失败即整体失败，应用内提示
无更新，用户走 README 的手动下载渠道。

### D3：release.yml 加版本门闩，防高频推送误触发发布

上游模型里 `master` 只有发版提交会推，工作流无门闩。fork 的
`main` 是日常开发分支，任何 push 都会触发 `release.yml`。若版本号
未变，构建会白跑（含 15 分钟的 macOS iOS 构建），且
`softprops/action-gh-release` 对已存在的 Release 是更新而非失败，
可能把错误产物覆盖进既有 Release。因此新增前置 `CheckVersion`
job：检查 `v{version}` tag 是否已存在，存在则三个构建发布 job
全部跳过。这实现了 spec 里「同一版本号不得发布两次」的要求。

### D4：iOS 产物复用 ios-verify 的构建步骤

不新建构建脚本，把 `ios-verify.yml` ios-build job 的步骤序列
（npm ci、pod install 关 Flipper、Rust staticlib、xcodebuild
unsigned、zip Payload）复制进 `release.yml` 的 `iOS` job，产物
命名改为确定性的 `lx-music-mobile-v{version}-unsigned.ipa`。
不引入任何签名步骤，与 `ios-distribution` 规范的自签合规通道
一致。`Release` job 的 `needs` 扩为 `[Android, iOS]`，`files`
列表加入 IPA，MD5 清单改为覆盖全部产物。

### D5：删除 `publish-version-info.yml`

它用 `secrets.PAT` 向上游 `lyswhut/lx-music-mobile-version-info`
仓库发 dispatch，fork 无此凭据也无权写该 npm 包，留着只会在每次
发版时红一个 job。fork 的版本信息由 `main` 分支的
`publish/version.json` 直接承载（D2 的单源），npm 通道整体放弃。

### D6：版本号取 `1.9.1.1` 作为首个自有版本

当前上游基线为 `1.9.1`。按分析文档的版本号策略，首个自有版本为
`1.9.1.1`：大于 `1.9.1`（`compareVer` 按 `.` 分段数值比较成立），
不与上游任何 tag 重名，后续上游发 1.9.2 时 fork 版本线平滑跟进为
`1.9.2.1`。

## Risks / Trade-offs

- 单源设计牺牲了更新检查的可用性：GitHub raw 被网络阻断时用户收
  不到更新提示。接受，README 提供手动渠道兜底。
- `author.name` 改动使 `package.json` 成为后续合并上游的固定冲突
  文件，已在分析文档的合并流程中登记解法（保留 fork 字段）。
- iOS job 让每次真实发版的流水线增加约 15 分钟与 macOS 分钟数
  消耗。接受，换取 Release 挂长期有效的 IPA 下载点。
- 覆盖安装冲突：装过上游包的设备首次安装本仓库 APK 会提示签名
  不一致，需先卸载。在 Release 正文（changeLog）中声明。

## Migration Plan

无数据迁移。上线顺序：本变更合入 `main`（此时版本号仍为 1.9.1，
CheckVersion 门闩跳过发布），CI 全绿后再做发版提交（`npm run
publish 1.9.1.1`），推送触发首个自有版本构建。

## Open Questions

无。三个决策点已在分析文档定案，仓库前置条件（secrets、权限）
已确认就绪。
