## 1. 工件与文档入库

- [x] 1.1 `docs/download-feature-design.md` 与四工件随本 change 首个提交入库；验证：`git show --stat` 含该文件且 `docs/legal-risk-analysis.md` 不在提交内
- [x] 1.2 `openspec validate --all` 全绿；验证：命令退出码 0，`add-ios-download` 四工件齐全

## 2. 类型、配置与持久化

- [x] 2.1 `src/types/download_list.d.ts` 补 `listId` 字段；`src/types/app_setting.d.ts` 与 `src/config/defaultSetting.ts` 补 11 项下载设置（键名见长文档 §10.5）；验证：`npx tsc --noEmit` 错误数不超 21
- [x] 2.2 `src/config/constant.ts`：`storageDataPrefix` 加 `downloadList`；`NAV_MENUS` 改按 `Platform.OS` 生成（iOS 增 `nav_download`，两个 `as const` 元组取并集）；验证：`tsc` 不新增错误，Android 构建路径下列表内容不变（人工比对）
- [x] 2.3 `core/download/persist.ts`：AsyncStorage 分片读写（`@download_list__meta` + 每 100 条一片）、100ms 合并、`flush()` 强制落盘；验证：vitest 覆盖分片合并、写入顺序、flush 语义
- [x] 2.4 `store/download/state.ts` + `action.ts` + `hook.ts`：任务列表状态、`downloadListUpdate` 事件接线；验证：vitest 覆盖状态更新与事件触发

## 3. 核心层（JS）

- [x] 3.1 `core/download/utils.ts`：7 档 `QUALITYS`、`getMusicType` 降级、`getExt`、`createDownloadInfo`（任务键 `${id}_${quality}_${ext}`）、`buildSavePath`（按列表名分子目录）、`clipNameLength`（80 字符）与 `clipFileNameLength`（150 字符）移植；验证：vitest 覆盖降级逐档、键去重、截断与清洗（含 `#`）
- [x] 3.2 `core/download/urlResolver.ts`：两段式 `getUrl`（`toggleMusicInfo` 优先）与 `refreshUrl`（刷新上限 2 次），直调 `core/music/online.ts` 不经过本地优先；验证：vitest 覆盖两段式回落与上限
- [x] 3.3 `core/download/downloadIndex.ts`：双 id 索引（原 id + `toggleMusicInfo` id）、`lookupLocal`（`stat` 确认存在）；验证：vitest 覆盖双 id 命中与文件缺失不命中
- [x] 3.4 `core/download/reconcile.ts`：对账（冷启动 + 进入下载页触发，缺失标 `FILE_MISSING` 移出索引）；验证：vitest 覆盖缺失检测与索引移除
- [x] 3.5 `core/download/engine.ios.ts` + `engine.ts`：接口按完整形态冻结（configure/start/pause/resume/cancel/removeResumeData/getActiveTasks/drainEvents/ack），P1a 未实现方法抛 `not supported`；验证：`tsc` 通过，Android 侧调用即 reject
- [x] 3.6 `core/download/scheduler.ts`：`checkStartTask` 并发补位、`tryNum`（仅 `start` 事件清零）、错误映射表（§7.4 逐行）、`enable = false` 时不启动新任务；验证：vitest 覆盖补位数量、错误映射逐行、冻结语义
- [x] 3.7 `core/download/lrc.ts`：`.lrc` 输出（UTF-8，`buildLyrics` 拼装，子开关生效）；验证：vitest 覆盖拼装结果与开关组合

## 4. 播放联动与本地优先

- [x] 4.1 `src/core/player/player.ts` `getMusicPlayUrl`（`:96`）：`!isRefresh` 时查 `downloadIndex.lookupLocal`，命中返回 `file://`；`isRefresh` 跳过本地并触发对账；验证：vitest 覆盖命中/未命中/刷新跳过三条路径
- [x] 4.2 `src/core/init/player/preloadNextMusic.ts`：`file://` 路径跳过 `checkUrl` 与 `isRefresh` 重取；验证：vitest 或代码走查确认无网络探测
- [x] 4.3 `src/core/music/download.ts` 解开本地分支注释；`src/core/player/playInfo.ts:141` DOWNLOAD 分支返回下载列表；验证：下载页点击已完成任务走本地播放（P1a 用模拟器 + 预置文件验证路径）

## 5. UI 与导航

- [x] 5.1 `src/components/DownloadModal/`：单曲弹窗（`meta.qualitys` ∩ `qualityList[source]`，附大小）与批量弹窗（四档 + 计数文案）；验证：手动走查渲染逻辑，文案进三语
- [x] 5.2 两处 `ListMenu`（`OnlineList`、`Mylist/MusicList`）启用 `download` 项：显示条件 = `isDownloadSupported()` ∧ `download.enable` ∧ 非本地歌曲；多选走批量弹窗；验证：手动走查条件矩阵
- [x] 5.3 下载页 `src/screens/Home/Views/Download/index.tsx`（替换 `index.js` 空壳）：五 Tab（全部/下载中/已暂停/出错/已完成）、行内进度、长按菜单（播放/开始/暂停/删除/删除含文件）、顶部全部开始/暂停；验证：手动走查 + `tsc` 无新增错误
- [x] 5.4 导航改造：`viewMap`/`indexMap`/PagerView 子页改列表驱动，`Horizontal/Main.tsx` 加 `nav_download` 分支，关闭功能时回退 `nav_search`，`dataInit.ts:34` 恢复时非法 id 回退；验证：`android-regression` 通过 + 双布局双滚动模式手测（`homePageScroll` 开/关）
- [x] 5.5 设置分组 `settings/Download/index.tsx`：11 项设置 + 只读项（保存位置说明、占用、清除全部）；`SETTING_SCREENS` 仅 iOS 加 `download`；首次开启走 `confirmDialog` 合规提示；验证：手动走查开关语义（含 §7.7 冻结）
- [x] 5.6 三语文案：`download_*`/`download__*`/`nav_download`/错误码新增项（`download_status_error_no_space`、`download_status_error_file_missing`、`download_status_paused_force_quit`、`download_status_paused_system`）；验证：三语 key 集合一致，无缺失引用

## 6. 原生最小集（P1a）

- [x] 6.1 `ios/LxMusicMobile/Modules/LxDownloadManager.{h,m}`：单例、固定 identifier 后台会话、`didFinishDownloadingToURL` 2xx 校验后 move + 排除备份、`didWriteData` 首个 2xx 发 start、非 2xx 记 `HTTP_<status>`、事件日志 `events.jsonl`（seq 递增）与 `ack` 截断、`drainEvents`；验证：编译通过 + 模拟器 `ios-simulator-smoke` 全绿
- [x] 6.2 `DownloadModule.{h,m}`（RCTEventEmitter 外壳）：JS 接口按冻结形态导出，P1a 未实现方法显式报错；验证：JS 侧调用 start/cancel 链路通，`tsc` 无新增
- [x] 6.3 `AppDelegate.mm`：`didFinishLaunching` 开头创建 manager；`handleEventsForBackgroundURLSession:` 交 manager；验证：编译通过，启动路径无回归（35 项自测全绿）

## 7. 测试与回归（P1a）

- [x] 7.1 vitest 全套：§13 清单逐条（`QUALITYS`/降级、去重、文件名、状态迁移、补位、错误映射、`tryNum` 清零、flush-then-ack、drain 幂等、`enable=false` 冻结、`lookupLocal` 双 id、导航回退）；验证：`npm test` 全绿
- [x] 7.2 `npm run lint` 退出码 0；`npx tsc --noEmit` 错误数不超存量基线 24；验证：真实运行并记录数字
- [x] 7.3 CI 全量回归：`ios-verify.yml` 现有 job 全绿（js-verify、rust、ios-build、ios-simulator-smoke、android-regression）；验证：CI run 全绿，35 项自测不变
- [ ] 7.4 真机前台功能清单（12 项，长文档 §13）：由用户侧载执行；验证：结果记录入 `evidence/p1a-manual.md`

## 8. 文档同步

- [x] 8.1 `spec/requirements.md:73` 修订（本机个人保存不构成提供/代理/分发，措辞经用户确认）；验证：用户确认措辞后落盘
- [x] 8.2 `AGENTS.md` 平台扩展清单补 `engine.ios.ts`；`spec/structure.md` 登记 `core/download/`、`store/download/`；验证：两文件与实际目录一致
- [x] 8.3 `humanizer-zh` 过一遍所有新增/改写 Markdown；验证：无 AI 套话残留

## 9. P1b（实证门禁）

- [x] 9.1 写 `evidence/p1b-empirics.md` 骨架（四项实证 × 操作/观察/结论）；验证：文件存在，四项待实证标记
- [ ] 9.2 P1a 收尾提交触发 CI 出未签名 IPA，用户侧载跑四项实证（后台会话重挂接、后台唤醒独立完成、强退取消分类、备份排除读回）；验证：四项结论全部落 `evidence/`，任一证伪即停下重估
- [ ] 9.3 实证全绿后实施：`pause`/`resume`/resumeData 落盘、`getActiveTasks` 重挂接、`drainEvents` 冷启动合并、强退分类；验证：真机复测杀进程续传与强退恢复，记录入 `evidence/`

## 10. 归档前终检

- [x] 10.1 `openspec validate --all` 全绿；`tasks.md` 勾选状态真实；验证：命令输出与勾选一致
- [x] 10.2 `git status --short` 比对基线，确认未纳入 `legal-risk-analysis.md` 与本地配置/构建产物；验证：改动面与变更声明一致
