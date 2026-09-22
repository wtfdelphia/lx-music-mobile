# fork-update-channel 完成前验证

日期：2026-09-22。分支：`codex/upstream-v1.9.1` → PR #4 squash 合入
`main`（`4b667dc`）。

## Verification

| 命令 | 结果 | 结论 |
|---|---|---|
| `git merge`（嫁接 `fb84807` 于 `d295604`） | 85 假冲突降为 3 真冲突，全部按文档口径解决 | 通过 |
| `npm ci --allow-git=all` | 成功（环境默认 `allow-git=none`，git 依赖需显式放行） | 通过 |
| `npm run lint` | 0 error（上游新代码引入 2 处 `no-unnecessary-type-assertion`，`eslint --fix` 移除） | 通过 |
| `npm test` | 1 文件 4 用例全过 | 通过 |
| `openspec validate --all` | 9 passed, 0 failed | 通过 |
| `python3 yaml.safe_load`（release/beta-pack/build-test/ios-verify/rust + 2 复合 action） | 7 文件全部合法 | 通过 |
| CI `ios-verify` PR #4（run 35686235924） | 5 job 全绿：Rust 交叉编译 1m3s、Android 回归 8m2s、iOS unsigned 构建 12m59s、JS 门禁 2m36s、模拟器冒烟 26m32s | 通过 |
| `cargo check --release --all-targets` | SKIPPED：本变更未触碰 `rust/` | 无新增告警风险 |

发布构建本身（`release.yml` 全链路：签名打包、打 tag、建
Release）尚未真实运行过一次。`ios-verify` 的 ios-build job 与
`release.yml` iOS job 步骤同源，覆盖了构建正确性；签名与
Release 步骤依赖 `KEYSTORE_*` secrets，只能由真实发版验证。

## Documentation Sync

| 文件 | 判断 |
|---|---|
| `README.md` | 已同步：下载入口三处改指本仓库，声明签名差异 |
| `AGENTS.md` | 已同步：项目上下文补 `master` 镜像、`main` 发版的分支模型 |
| `spec/` | 无需变更（未改长期架构与目录职责） |
| `openspec/specs/` | 待归档时同步（`release-distribution`、`update-channel` 两个新 capability） |
| `docs/tooling-sources.md` | 无需变更（CI action 版本升级不属工具版本口径） |
| `docs/update-channel-analysis.md` | 已入库并补实施记录 |

## Residual Risk

- 发版未实跑：`CheckVersion` 门闩、iOS Release 挂载、APK 签名
  三项待 `npm run publish 1.9.1.1` 触发的首次真实构建验证
- `publish/version.json` 现为上游 1.9.1 内容，首次发版时由
  `npm run publish` 改写为 `1.9.1.1` 与 fork 更新说明
- `tsc --noEmit` 仍为 21 errors（既有债，本变更未新增未减）
- change 未归档：归档前需 `openspec-verify-change` 与
  `spec-compliance-check`
- 覆盖安装提示：装过上游包的设备需先卸载再装本仓库签名包

## 发版首跑记录（2026-09-22）

`npm run publish 1.9.1.1` 后推送 `dff700e`，run 35688305232：

- CheckVersion 门闩放行（`v1.9.1.1` tag 不存在），行为符合设计
- iOS job 绿（10m7s，未签名 IPA 构建成功）
- Android job 红（7m43s）：`:app:packageRelease` 报
  `KeytoolException: Failed to read key from store: Keystore was
  tampered with, or password was incorrect`。编译、打包均通过，
  挂在签名读取环节，属 `KEYSTORE_*` secrets 配置问题（store
  密码不符或 base64 内容损坏），非流水线代码缺陷
- Release job 未执行，tag 未创建；修正凭据后
  `gh run rerun --failed 35688305232` 即可只重跑失败链路
- 注意：tag 创建前，任何 `main` push 都会再次触发完整构建，
  凭据修正前的收尾提交应暂缓推送

## 发版成功记录（2026-09-22，同一 run 重跑）

两次重跑定位并修复凭据问题后，run 35688305232 最终全绿：

- 第一次失败根因：传进 Secret 的 base64 副本被复制通道损坏
  （本地文件与密码经 `keytool -list` 验证无误）。用
  `gh secret set --body "$(base64 -w0 ...)"` 从本地原始文件直接
  推送，不经过剪贴板
- 第二次失败根因：工作流读的键名是 `KEYSTORE_PASSWORD`，误设成
  `KEYSTORE_STORE_PASSWORD`，store 密码传入空串。补设正确键并
  删除多余键
- 重跑结果：CheckVersion 4s、iOS 13m20s、Android 8m31s、
  Release 10s，全部通过
- `v1.9.1.1` tag 已创建（指向 `dff700e`），GitHub Release 已发布，
  附件含 5 个签名 APK 与 1 个未签名 IPA
- 首跑记录里「凭据修正前暂缓推送」的提示已解除：tag 存在后
  CheckVersion 门闩会跳过后续 `main` push 的构建
