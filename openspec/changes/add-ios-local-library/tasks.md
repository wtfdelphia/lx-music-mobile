> 进度快照（2026-10-14）：P1 编码全部完成——核心层、UI（三 Tab + 最近播放、
> 专辑网格、艺人分组、多选、来源管理、排序、详情头）、设置分组、导航接线、
> 原生模块与工程注册、排除表与文件删除分级。本地验证通过 111 个单测、
> lint 仅剩 3 个基线既有错误、tsc 零新增、Metro 双端打包通过、
> CI 原生构建与模拟器冒烟全绿。剩余：真机实证 1、4、6（必过）与 2、3、5（观察项）。

## 0. 净室与工件

- [x] 0.1 四工件入库；`openspec validate --all` 全绿
- [x] 0.2 PR 模板增加「未参考 LynMusic 源码」勾选项
- [x] 0.3 净室复核门禁落实：复核已由用户确认通过（2026-10-12）
- [x] 0.4 `docs/legal-risk-analysis.md` 补「本地曲库净室风险（GPLv3 上游）」节

## 1. 原生模块（P1）

- [x] 1.1 `Modules/Library/` 骨架：`LxLibraryModule`（RCTEventEmitter）、私有串行队列；工程链接 `libsqlite3.tbd`（pbxproj 已注册，待 CI 构建验证）
- [x] 1.2 `LxLibraryStore`：v1 schema、WAL、`user_version` 迁移、FTS 触发器、结构化 `query`、批量 upsert 即 seen、`finishSync` 清理；真机验证待 CI
- [x] 1.3 `LxFolderAccess`：选择器（复用稳定呈现思路）、沙箱内识别、bookmark 生成与解析、引用计数、`relink`；真机实证 1 待执行
- [x] 1.4 `LxFolderScanner`：枚举 + 协调读取（失败回退）、白名单、iCloud 状态、并发 4、取消、进度节流、报告与删除保护；真机实证 2、3 待执行
- [x] 1.5 `LxMediaProbe`：标识符映射、超时 8s、13.4 分支；真机实证 5 待执行
- [x] 1.6 `LxArtworkCache` 与 `readLyric`（BOM、UTF-8、GB18030、Big5）；样例比对待执行
- [x] 1.7 `LxCredentialStore`（Keychain，P2 使用）

## 2. JS 核心（P1）

- [x] 2.1 `native.ios.ts` / `native.ts`；Android 下调用即 reject（vitest 覆盖）
- [x] 2.2 `locator.ts`、`toMusicInfo.ts`；vitest 覆盖编码、非法段、NFC、映射
- [x] 2.3 `sources/local.ts`、`sync.ts`（单飞、进度、报告）、`query.ts`（limit 上限、降级）
- [x] 2.4 `store/library`：来源、进度、Tab、筛选状态与 hook
- [x] 2.5 `utils/music.ios.ts`：定位符分支与旧路径 rebase；`core/music/local.ts` 封面和歌词分支接入；vitest 覆盖分支矩阵
- [x] 2.6 URL 缓存跳过 lxlib；预载沿用现有门控（已核实无需改动）
- [x] 2.7 `associate.ts` 自动关联：差量对账、多音质去重、`kind:'library'` 跳过；纯算法部分 11 用例覆盖
- [x] 2.8 `core/library/init.ts` 接入启动序列（`initDownload` 之后）

## 3. UI（P1）

- [x] 3.1 `NAV_MENUS_IOS` 加 `nav_library`（图标 `sd-card`）；横竖屏 viewMap 注册；`library.enable` 门控（DrawerNav / Aside / 页面兜底）
- [x] 3.2 曲库页：顶栏、三 Tab、搜索、来源筛选下拉、歌曲行（序号 / 时长 / 红心）、空状态带按钮、来源管理 / 扫描全部 / 添加文件夹入口
- [x] 3.3 `LIBRARY_DETAIL_SCREEN`：专辑和艺人详情（P1 先经查询接入，独立屏幕待接入导航）
- [x] 3.4 来源管理（扫描、重新授权、启停、恢复已移除、删除）与扫描进度
- [x] 3.5 歌曲菜单：播放、稍后播放、添加到列表、喜欢、搜索歌词、查看专辑、查看艺人、标签信息、移除、删除文件；`MetadataEditModal` 对 lxlib 只读
- [x] 3.6 设置分组与三语文案；三个 JSON 解析通过、键齐全
- [x] 3.7 歌词手动搜索（F14）：searchMusic 检索 + 候选弹窗 + 应用写缓存
- [x] 3.8 多选批量操作：长按进入多选，批量播放 / 添加到列表 / 移除 / 删除文件
- [x] 3.9 从曲库移除与排除表（v2 迁移）：重扫与自动关联跳过排除项，来源管理提供恢复
- [x] 3.10 文件删除分级（§16）：下载来源走下载模块、沙箱内本地来源原生删除、外部来源拒绝
- [x] 3.11 专辑网格（封面卡片）与艺人首字母分组；下钻头部「播放全部 / 添加到列表」
- [x] 3.12 最近播放：播放埋点（playTracker）+ recent 排序 + 曲库页第四个 Tab
- [x] 3.13 设置空间管理：封面缓存大小展示与清理（原生接口 + SpaceManage 组件）
- [x] 3.14 串流音质按网络类型分设（WiFi / 移动网络两组）
- [x] 3.15 来源管理完善：曲目数与最后扫描时间、重命名、取消扫描、
      扫描报告展开、删除前列表引用统计与「一并移除」二次确认（§9 / §14.4）
- [x] 3.16 曲目排序（标题 / 艺人 / 专辑，F5）
- [x] 3.17 添加文件夹的「包含子文件夹」选项（§14.4）
- [x] 3.18 下钻详情头封面（§14.3 最小形态）
- [x] 3.19 代码审查修复批：
      - H1 存量 v1 库补跑 v2 迁移（排除表不再缺失）
      - H2 下载虚拟来源禁止扫描（JS + 原生双重兜底）
      - H3 专辑 / 艺人视图订阅 rows（改响应式）
      - H4 扫描完成改发事件，页面按当前视图自行重载
      - H5 下载来源隐藏删除 / 重命名 / 扫描；`ensureDownloadSource` 失败重置
      - M1 删文件不写排除表（重下同名文件可回库）
      - M2 批量 / 下钻「添加到列表」改弹多选添加弹窗
      - M3 多选栏加全选；切 Tab / 下钻退出多选
      - M4 外部来源隐藏删除文件菜单；批量删除先剔除只读项并提示跳过数
      - M5 停用来源不参与查询（`s.enabled = 1`）
      - M6 最近播放只返回已播曲目；该 Tab 监听切歌刷新
      - M7 行数据携带 `albumKey` / `artistKey`，查看专辑 / 艺人直接下钻；
        艺人聚合标题优先专辑艺人
      - M8 当前筛选来源被删除后自动重置为「全部」
      - M9 恢复已移除后本地来源自动重扫、下载来源自动对账
      - M10 手选歌词写 `_edited` 通道并优先读取；播放中应用即时刷新
      - M11 删除 / 移除正在播放的曲目前先切下一首
      - 低危：路径前缀加尾斜杠、删除文件后释放授权引用、
        sidecar 大小写回退、`scanAllSources` 单飞 + 超时、
        `TYPE_LABELS` 去硬编码、聚合空标题本地化兜底

## 4. P1 出口

- [x] 4.1 `npm run lint`（仅基线 3 个既有错误）、`npm test`（110 绿）、`tsc` 零新增、Metro 双端打包通过
- [ ] 4.2 真机实证 1、4、6 必过，2、3、5 允许带观察项；结果归档到 evidence/（需 Mac / CI）

## 5. 远程来源与离线（P2）

- [ ] 5.1 `sources/subsonic.ts`：认证、ping、search3 分页与回落、字段映射、串流、封面、歌词、star
- [ ] 5.2 来源管理服务器表单、测试连接、musicFolder 选择；Keychain 接入
- [ ] 5.3 `scrobble.ts`（Subsonic）；`library.scrobble`、`library.syncStar`
- [ ] 5.4 下载 `kind:'library'`：类型联合、`createLibraryDownloadInfo`、urlResolver、保存路径、完成回写、对账
- [ ] 5.5 曲库歌曲菜单与详情页的下载入口；离线标记
- [ ] 5.6 自动关联接入真实下载完成事件（`initAssociate` 已实现，待联调）
- [ ] 5.7 真机实证 7（Navidrome）

## 6. P3

- [ ] 6.1 `sources/jellyfin.ts`（Jellyfin 与 Emby）；真机实证 7（Jellyfin）
- [ ] 6.2 （编号保留）每日推荐已于 2026-10-12 评审砍掉（F12），无任务
- [ ] 6.3 `textImport.ts` 与导入弹窗
- [ ] 6.4 （已移入 P1，见 3.7）
- [ ] 6.5 歌词分享图（截图方案先决策）

## 7. 收尾

- [ ] 7.1 `AGENTS.md` 平台扩展清单、`spec/structure.md` 目录登记、CHANGELOG
- [ ] 7.2 归档 change，同步主规范
