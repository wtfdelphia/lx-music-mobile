## Why

移动版没有下载功能。桌面版的下载模块（队列、续传、元数据）完整，移动版只剩移植时预留的空壳：类型定义、被注释的导航项与菜单项、占位下载页。iOS 用户对离线收听的需求更刚性：在线流依赖自定义源链接的时效，把歌存成本地文件的唯一途径就是下载。`react-native-fs` 不能当 iOS 下载引擎（上游源码缺陷：错误时 Promise 悬空、非 2xx 误报完成、杀进程丢续传、在 iOS 上从未被调用过），需要自研原生传输层。完整取证与方案见 `docs/download-feature-design.md`。

## What Changes

- 新增 iOS 下载能力：任务队列（并发上限、五状态、重试、链接刷新与换源）、全局本地优先播放、原生 `NSURLSession` 后台传输层
- 新增原生模块 `LxDownloadManager`（纯 ObjC 单例，不依赖 RN 在场）与 `DownloadModule`（RCTEventEmitter 外壳）；`AppDelegate.mm` 接线 `handleEventsForBackgroundURLSession:`
- `src/` 新增 `core/download/`（scheduler / urlResolver / engine / downloadIndex / persist / reconcile / meta）与 `store/download/`；平台扩展文件 `engine.ios.ts` 配基础文件 `engine.ts`
- 导航改造：`NAV_MENUS` 按 `Platform.OS` 生成（iOS 增 `nav_download`），`viewMap` / `indexMap` / PagerView 子页改列表驱动，关闭功能时页面回退
- UI：单曲/批量音质选择弹窗、下载页（五 Tab）、设置下载分组（11 项，含首次开启合规提示）、两处列表菜单的下载项
- `.lrc` 输出（仅 UTF-8）；元数据标签写入留 P2，不在本变更
- `spec/requirements.md:73` 合规条款修订，明确本机个人保存不构成提供、代理或分发
- Android 行为零变化；Android 下载另立 change

## Capabilities

### New Capabilities

- `ios-download`: iOS 下载任务生命周期（创建、队列调度、五状态、重试与链接刷新）、原生后台传输层、事件可靠性（日志 + ack）、存储布局（用户可见下载目录与不可见内部文件）、设置与入口行为、本地优先播放与对账

### Modified Capabilities

- `ios-playback`: 新增本地优先播放要求——已下载歌曲在任意列表优先本地文件，播放失败回落在线并触发对账
- `ios-file-access`: 新增下载文件目录约定——`Documents/Download` 用户可见，内部文件放 `Library/Application Support/lx-download/` 不可见且排除备份
- `verification-gates`: 新增实证门禁要求——原生下载行为模拟器不可复现的部分，未真机实证不得标为通过

## Impact

- 代码：`ios/LxMusicMobile/Modules/`、`ios/LxMusicMobile/AppDelegate.mm`、`src/core/download/`、`src/store/download/`、`src/core/player/player.ts`、`src/core/init/player/preloadNextMusic.ts`、`src/screens/Home/`（导航、下载页、设置）、`src/components/`（弹窗、两处列表菜单）、`src/lang/`、`src/config/`、`src/types/`
- 依赖：P1 零新增
- 文档：`spec/requirements.md` 条款修订、`AGENTS.md` 平台扩展清单、`spec/structure.md` 目录登记
- 验证：vitest 新增、本地 `npm run lint` + `npm test`、CI `ios-verify.yml` 现有 job 回归、4 项真机实证（P1b 启动门禁）
- 非目标：ID3/FLAC 标签（P2）、APE 嵌入、分享分发入口、自选保存目录、跨设备同步、下载列表导入导出、Android 下载
