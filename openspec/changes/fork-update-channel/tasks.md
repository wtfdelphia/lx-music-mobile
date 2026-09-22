## 1. 上游对齐

- [x] 1.1 以 `git replace --graft` 嫁接 `fb84807` 于 `d295604`，
  合并上游 v1.9.1，解 3 处真实冲突（`e62b1f0`）
- [x] 1.2 同步上游 tags `v1.9.0`、`v1.9.1` 到 origin
- [x] 1.3 `npm ci` 通过（`--allow-git=all` 覆盖环境默认禁
  git 依赖）
- [x] 1.4 `npm run lint` 清零（上游新代码引入 2 处
  `no-unnecessary-type-assertion`，`eslint --fix` 移除）
- [x] 1.5 `npm test` 通过（1 文件 4 用例）

## 2. 发布流水线改造

- [x] 2.1 `release.yml` 新增 `CheckVersion` job：查
  `v{version}` tag 是否存在，输出 `should_run`，三个构建发布
  job 以 `if` 消费
- [x] 2.2 `release.yml` 新增 `iOS` job：复用 `ios-verify` 的
  ios-build 步骤产出 `lx-music-mobile-v{version}-unsigned.ipa`
- [x] 2.3 `Release` job：`needs` 扩为 `[Android, iOS]`，
  `files` 加入 IPA，MD5 清单覆盖全部产物
- [x] 2.4 删除 `publish-version-info.yml`
- [x] 2.5 YAML 语法校验五类文件全部通过

## 3. 身份与更新渠道

- [x] 3.1 `package.json`：`author.name` 改 `wtfdelphia`，
  `repository.url` 改 fork 地址
- [x] 3.2 `src/utils/version.js`：源列表收敛为单源（`main`
  分支 raw 地址）
- [x] 3.3 `src/utils/version.ios.js`：同 3.2
- [x] 3.4 `README.md`：下载入口三处链接改指
  `wtfdelphia/lx-music-mobile`

## 4. 验证与交付

- [x] 4.1 `openspec validate fork-update-channel` 通过
- [x] 4.2 `npm run lint`、`npm test` 通过
- [x] 4.3 PR 合入 `main`，`ios-verify` 在 `main` 上全绿
- [ ] 4.4 发版：写 `publish/changeLog.md`，
  `npm run publish 1.9.1.1`，合入后 `release.yml` 构建
  `v1.9.1.1` 并发布
- [ ] 4.5 归档前跑 `openspec-verify-change` 与
  `spec-compliance-check`
