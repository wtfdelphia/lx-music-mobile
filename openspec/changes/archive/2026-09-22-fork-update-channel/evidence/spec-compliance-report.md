# fork-update-channel Spec Compliance Report

日期：2026-09-22。审查范围：PR #4（squash `4b667dc`）+ 发版提交
`dff700e` + 后续收尾提交（`0461a39`/`0b8ea98`/`e33ce45`，均为
证据与文档）。配套报告：同目录 `verification-before-completion.md`。

## 六维审查

| 维度 | 状态 | 结论 |
|---|---|---|
| Scope | PASS | PR 共 51 个文件：38 个属上游 v1.8.4→v1.9.1 差异（嫁接合并带入，非本变更改动），19 个属 change 授权范围（工件/实现/文档/证据），差集为空，无越界 |
| Design | PASS | D1 身份切换（`author.name=wtfdelphia`，`name` 不动）、D2 单源收敛、D3 CheckVersion 门闩、D4 iOS job 复用 ios-verify 步骤、D5 删 `publish-version-info.yml`、D6 版本号 `1.9.1.1`，六项全部落地且与实现一致 |
| Scenarios | PASS | 13 个 Scenario：12 个有实现 + 真实运行证据（门闩放行/跳过双验证、Release 六产物、`compareVer` 三组实测、单源零残留、`ciSelfTest` 7.3 断言跳转形态）；「下载与安装兼容」仅能真机覆盖安装验证，已在 `verification-before-completion.md` 登记为残余风险 |
| Project Rules | PASS | OpenSpec 门禁先行（四工件先于实现）；`main` 改动后本地跑 `npm run lint`（0 error）；`openspec validate --all` 9 通过；签名凭据只经 `gh secret set` 管道推送，未进仓库任何提交（近 20 个提交 `git grep` 零命中）；工作区无残留 keystore |
| Verification | PASS | 只报告真实运行命令：`npm ci`/`lint`/`test`、`ios-verify` PR 全绿（run 35686235924）、发版构建全绿（run 35688305232）、YAML 语法校验、`compareVer` 本地复刻实测。`cargo check` 按未触碰 `rust/` 标 SKIPPED，无隐瞒 |
| README/AGENTS Sync | PASS | README 下载入口与第三方声明已同步；AGENTS 项目上下文补分支模型与嫁接口径；`docs/tooling-sources.md` 无需变更（CI actions 版本不属本地工具口径）；`openspec/specs/` 待归档时同步 |

## 总体状态

**PASS**

## 发现项

无 CRITICAL，无 FAIL 条件触发（无越界改动、无凭据入库、
Requirement/Scenario 均可对应、无验证缺失）。

两项 WARN 均已在 `verification-before-completion.md` 登记：

1. 「下载与安装兼容」场景无 CI 覆盖，属固有残余风险，待首次真机
   覆盖安装实测后回填
2. Release 正文的安装包说明链接仍指上游文档页，不影响合规，后续
   可自建

## 剩余风险

- 首跑签名失败的两轮根因（base64 副本损坏、secret 键名
  `KEYSTORE_PASSWORD` 误写为 `KEYSTORE_STORE_PASSWORD`）已修复，
  修复方式为 `gh secret set` 从本地原始文件直接推送，未在工作区
  留下明文凭据
- `main` 为日常分支，后续任何发版都必须先改版本号再推送，由
  CheckVersion 门闩兜底；若绕过门闩直接打 tag 再推送，发布步骤
  会因 Release 已存在而行为不可预期
