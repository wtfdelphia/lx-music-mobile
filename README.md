<p align="center"><a href="https://github.com/lyswhut/lx-music-mobile"><img width="200" src="https://github.com/lyswhut/lx-music-mobile/blob/master/doc/images/icon.png" alt="lx-music logo"></a></p>

<h1 align="center">LX Music 移动版</h1>

<p align="center">
  <a href="https://github.com/lyswhut/lx-music-mobile/releases"><img src="https://img.shields.io/github/release/lyswhut/lx-music-mobile" alt="Release version"></a>
  <a href="https://github.com/lyswhut/lx-music-mobile/actions/workflows/release.yml"><img src="https://github.com/lyswhut/lx-music-mobile/workflows/Build/badge.svg" alt="Build status"></a>
  <a href="https://github.com/lyswhut/lx-music-mobile/actions/workflows/beta-pack.yml"><img src="https://github.com/lyswhut/lx-music-mobile/workflows/Build%20Beta/badge.svg" alt="Build status"></a>
  <a href="https://github.com/facebook/react-native"><img src="https://img.shields.io/github/package-json/dependency-version/lyswhut/lx-music-mobile/react-native/master" alt="React native version"></a>
  <!-- <a href="https://github.com/lyswhut/lx-music-mobile/releases"><img src="https://img.shields.io/github/downloads/lyswhut/lx-music-mobile/latest/total" alt="Downloads"></a> -->
  <a href="https://github.com/lyswhut/lx-music-mobile/tree/dev"><img src="https://img.shields.io/github/package-json/v/lyswhut/lx-music-mobile/dev" alt="Dev branch version"></a>
  <!-- <a href="https://github.com/lyswhut/lx-music-mobile/blob/master/LICENSE"><img src="https://img.shields.io/github/license/lyswhut/lx-music-mobile" alt="License"></a> -->
</p>

<p align="center">一个基于 React Native 开发的音乐软件</p>

## 说明

所用技术栈：

- React Native
- Redux

已支持的平台：

- Android 5 及以上

***注：HarmonyOS NEXT 暂无支持计划；iOS 适配已完成并归档（2026-09-09），2026-09-10 已并入 `main`，见下文「iOS 适配状态」**。*<br>
*桌面版项目地址：<https://github.com/lyswhut/lx-music-desktop>*<br>
*LX Music 项目发展调整与新项目计划：https://github.com/lyswhut/lx-music-desktop/issues/1912*

软件变化请查看[更新日志](CHANGELOG.md)（上游记录见 [lyswhut/lx-music-mobile](https://github.com/lyswhut/lx-music-mobile/blob/master/CHANGELOG.md)）。

软件下载：

- iOS：本仓库 `ios-verify` 工作流的 Artifact（未签名 IPA），安装方式见下文「iOS 适配状态」
- Android：上游 [GitHub Releases](https://github.com/lyswhut/lx-music-mobile/releases)，本 fork 不另行发布 Android 安装包

使用常见问题请参阅[移动版常见问题](https://lyswhut.github.io/lx-music-doc/mobile/faq)。

本 fork 的 iOS 产物只从本仓库的 GitHub Actions Artifact 获取，无其他发布渠道；其他渠道流传的安装包与本项目无关，请自行鉴别。

为了提高使用门槛，本软件内的默认设置、UI 操作不以新手友好为目标，所以使用前建议先根据你的喜好浏览调整一遍软件设置，阅读一遍[音乐播放列表机制](https://lyswhut.github.io/lx-music-doc/mobile/faq/playlist)。

### 数据同步服务

从 v1.0.0 起，我们发布了一个独立的[数据同步服务](https://github.com/lyswhut/lx-music-sync-server#readme)。如果你有服务器，可以将其部署到服务器上作为私人多端同步服务使用，详情看该项目说明。

### iOS 适配状态

iOS 适配已完成并归档（2026-09-09），2026-09-10 已并入 `main`，不上架 App Store。
构建验证由 GitHub Actions macOS Runner 全自动完成，开发机无需 macOS：

```
Windows / Linux
     │ git push
     ▼
GitHub ──► GitHub Actions
                 │
                 └── macOS Runner（macos-15 / Xcode 16）
                         ├── Node.js（JS 依赖与 bundle）
                         ├── Rust（加密核心交叉编译）
                         ├── CocoaPods（pod install）
                         └── Xcode（unsigned 构建）
                               │
                               ▼
                         LxMusicMobile.ipa（未签名）
                               │
                               ▼
                     GitHub Actions Artifact
                               │
                               ▼
                   Windows / Linux 下载 IPA
                               │
                               ▼
                  AltStore / SideStore 重签侧载
                               │
                               ▼
                            iPhone
```

说明：

- `ios-verify` 工作流含 5 个并行门禁：JS 门禁（单测 + Metro 双端打包）、
  Rust iOS 交叉编译（含宿主黄金基准）、设备未签名构建（产出 IPA）、
  模拟器冒烟（启动到首页 + 进程判活 + 应用内 35 项自测 + 深链探针）、Android release 回归
  （守护双端共用的 `assets/script/user-api-preload.js`）；
- CI 产物为**未签名设备包**（`ios-verify` 工作流 Artifact，保留 30 天），
  下载后用个人免费 Apple ID 经 AltStore / SideStore 重签安装；
- 免费账号签名有效期 7 天、同时最多 3 个应用，需用电脑端
  AltServer / SideServer 定期刷新；
- 当前进度：设备版未签名 IPA 与模拟器冒烟（启动到首页、进程稳定存活、
  无崩溃、应用内自测 35 项全过）均通过。加密核心（Rust）经桥对齐
  Android 黄金基准、自定义源沙箱、播放、后台续播、横屏、四 Tab 切换、
  深链（含 `.lxmc` 导入弹窗）已在模拟器运行时逐项验证。另有 iPhone 17 Pro
  真机反馈的四项缺陷修复（图标缺失、竖屏宽窄失真、点菜单图标开抽屉即崩、
  自定义源本地导入无反应）已落地并通过真机判据，对应任务 9.1 / 9.2 / 9.3 / 9.4；
  排行榜加载失败与播放循环切歌（2026-09-02）已归因并修复：原生探针实锤
  全部明文 `http` 请求被 ATS 拦截（`NSAllowsArbitraryLoads` 与
  `NSAllowsLocalNetworking` 并存时前者被系统忽略），移除冲突键后内置源
  搜索/榜单/播放链路恢复，防回归断言见任务 9.5 / 9.6 / 9.7。该变更已于
  2026-09-09 归档（62 项任务全勾），任务清单见
  `openspec/changes/archive/2026-09-09-add-ios-support/tasks.md`。

## AI 辅助开发工作流（SpecCoding）

本项目采用规格驱动（spec-driven）的 AI 协作流程。人负责判断与决策，AI 负责实现与验证，规格文件是双方的共同事实源。

事实源分三层，按序阅读，不跳级：

| 层 | 位置 | 内容 |
|---|---|---|
| 入口 | `README.md` | 项目说明、命令、本工作流入口 |
| 规则 | [`AGENTS.md`](AGENTS.md) | 全部 agent 通用规则：门禁、验证矩阵、高风险清单、安全边界 |
| 架构 | [`spec/`](spec/) | 长期事实：[需求边界](spec/requirements.md)、[架构决策](spec/design.md)、[目录职责](spec/structure.md) |

客户端专属差异写在各自文件（如 [`CLAUDE.md`](CLAUDE.md)）；工具版本与安装口径见 [`docs/tooling-sources.md`](docs/tooling-sources.md)。

单次变更的过程事实放在 `openspec/changes/<change-name>/`，含四个顺序依赖的工件：

```
proposal.md   为什么改、改什么、非目标
      ↓
specs/*/spec.md   需求与验收场景（SHALL / Scenario）
      ↓
design.md     怎么实现、影响面、回滚策略
      ↓
tasks.md      可执行任务清单与勾选状态
```

完成后归档到 `openspec/changes/archive/`，其中的长期结论回写到 `AGENTS.md` 与 `spec/`。

需要建 change 的场景（新能力、跨模块、原生模块、加密、沙箱、播放链路、CI、发布配置、依赖变更等）与完整门禁矩阵见 [`AGENTS.md`](AGENTS.md)。拼写修正、注释小修一类无行为变化的改动不需建 change。

常用命令：

```bash
npm ci                              # 装依赖（不用 npm install）
npm test                            # 单元测试
npm run lint                        # 代码风格（main / dev-ios 的 push 都不触发 CI lint，本地必跑）
openspec list                       # 查看进行中的变更与任务进度
openspec validate --all --strict    # 校验规格工件
```

`AGENTS.md` 的验证矩阵标注了每项门禁的真实 CI 执行位置与已知红项。已知红项不是生效中的门禁，不要当作通过依据。

## 贡献代码

本项目欢迎 PR，但为了 PR 能顺利合并，需要注意以下几点：

- 对于添加新功能的 PR，建议在提交 PR 前先创建 Issue 进行说明，以确认该功能是否确实需要；
- 对于修复 bug 的 PR，请提供修复前后的说明及重现方式；
- 对于其他类型的 PR，则适当附上说明。

贡献代码步骤：

1. 参照[源码使用方法](https://lyswhut.github.io/lx-music-doc/mobile/use-source-code)设置开发环境；
2. 克隆本仓库代码并切换至 `dev` 分支进行开发；
3. 提交 PR 至 `dev` 分支。

<!--
## 用户界面

<p><img width="100%" src="https://github.com/lyswhut/lx-music-mobile/blob/master/doc/images/app.png" alt="lx-music mobile UI"></p> -->

## 项目协议

本项目基于 [Apache License 2.0](https://github.com/lyswhut/lx-music-mobile/blob/master/LICENSE) 许可证发行，以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准。

---

*词语约定：本协议中的“本项目”指 LX Music（洛雪音乐）移动版项目；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。*

### 一、数据来源

1.1 本项目的各官方平台在线数据来源原理是从其公开服务器中拉取数据（与未登录状态在官方平台 APP 获取的数据相同），经过对数据简单地筛选与合并后进行展示，因此本项目不对数据的合法性、准确性负责。

1.2 本项目本身没有获取某个音频数据的能力，本项目使用的在线音频数据来源来自软件设置内“自定义源”设置所选择的“源”返回的在线链接。例如播放某首歌，本项目所做的只是将希望播放的歌曲名、艺术家等信息传递给“源”，若“源”返回了一个链接，则本项目将认为这就是该歌曲的音频数据而进行使用，至于这是不是正确的音频数据本项目无法校验其准确性，所以使用本项目的过程中可能会出现希望播放的音频与实际播放的音频不对应或者无法播放的问题。

1.3 本项目的非官方平台数据（例如“我的列表”内列表）来自使用者本地系统或者使用者连接的同步服务，本项目不对这些数据的合法性、准确性负责。

### 二、版权数据

2.1 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 **24 小时内** 清除使用本项目的过程中所产生的版权数据。

### 三、音乐平台别名

3.1 本项目内的官方音乐平台别名为本项目内对官方音乐平台的一个称呼，不包含恶意。如果官方音乐平台觉得不妥，可联系本项目更改或移除。

### 四、资源使用

4.1 本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。

### 五、免责声明

5.1 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。

### 六、使用限制

6.1 本项目完全免费，且开源发布于 GitHub 面向全世界人用作对技术的学习交流。本项目不对项目内的技术可能存在违反当地法律法规的行为作保证。

6.2 **禁止在违反当地法律法规的情况下使用本项目。** 对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。

### 七、版权保护

7.1 音乐平台不易，请尊重版权，支持正版。

### 八、非商业性质

8.1 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。

### 九、接受协议

9.1 若你使用了本项目，即代表你接受本协议。

---

若对此有疑问请 mail to: lyswhut+qq.com (请将 `+` 替换成 `@`)
