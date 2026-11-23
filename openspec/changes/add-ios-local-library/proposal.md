## Why

iOS 用户的音乐收藏有很大一部分不在在线源里，而是散落在三个地方：
- 「文件」App 里的本地文件夹、iCloud Drive、网盘 Provider
- 自建的 Navidrome、Subsonic、Jellyfin、Emby 服务器

LX 现在的「选择本地歌曲」在 iOS 上有四个缺陷：
- 只能浏览沙箱 Documents，而且只扫一层
- 存绝对路径，重签之后全部失效
- 元数据降级为只有文件名
- 能导入 AVPlayer 播不了的格式

本变更新增「本地曲库」，参考 LynMusic 公开描述的功能范围，以**净室方式**独立实现。iOS 包继续使用 Apache-2.0，不引入 LynMusic 的任何代码或资源。完整设计见 `design.md`。

## What Changes

- 新增 iOS 导航页「本地曲库」（`nav_library`，图标 `sd-card`），含三个 Tab：歌曲、专辑、艺人；另有专辑和艺人详情页（`LIBRARY_DETAIL_SCREEN`）、来源管理、扫描报告。歌词手动搜索在 P1 提供，歌词分享图延后
- 新增原生模块 `LxLibraryModule`：
  - sqlite3 曲库索引
  - security-scoped bookmark 文件夹授权
  - FileManager 加 NSFileCoordinator 扫描
  - AVFoundation 元数据
  - ImageIO 封面缓存
  - 内嵌歌词和同名 lrc
  - Keychain 凭据
- 新增 `src/core/library/` 与 `src/store/library/`：
  - 本地、Subsonic、Jellyfin、Emby 来源
  - 同步编排、查询、解析、播放上报
  - 文本导入歌单
  - 已下载曲目自动关联（`associate.ios.ts`）：下载完成的曲目自动进入曲库
- 曲库歌曲以 `MusicInfoLocal` 加定位符 `lxlib://<sourceId>/<itemKey>` 接入 LX，复用播放器、歌词页、列表和主题；「喜欢」和歌单映射到 LX 列表
- 新增 `src/utils/music.ios.ts`：解析定位符；旧的绝对路径本地歌曲按当前容器重新拼接（rebase），修复重签后失效的问题
- 下载引擎新增 `library` 任务类型：远程曲目离线下载到 `Documents/Download/Library/`，离线优先播放
- 设置新增「本地曲库」分组，共 8 项；三语文案
- Android 行为零变化

## Capabilities

### New Capabilities

- `ios-local-library`：来源管理、扫描与同步、元数据、浏览与搜索、播放解析、收藏与歌单映射、远程协议、播放上报、歌词手动搜索、文本导入、已下载曲目自动关联、安全与错误码

### Modified Capabilities

- `ios-playback`：本地歌曲播放地址经定位符解析；旧绝对路径 rebase；曲库串流 URL 不缓存
- `ios-download`：新增 library 任务类型，以及它的地址解析、保存路径和完成回写
- `ios-file-access`：外部文件夹只读授权与持有；曲库内部数据目录约定

## Impact

- 代码：
  - `ios/LxMusicMobile/Modules/Library/`（新增）、Xcode 工程链接 `libsqlite3.tbd`
  - `src/core/library/`、`src/store/library/`、`src/screens/Home/Views/Library/`、`src/screens/LibraryDetail/`
  - `src/navigation/`、`src/config/constant.ts`
  - `src/core/music/local.ts`、`src/utils/music.ios.ts`
  - `src/core/download/`、`src/types/`、`src/lang/`、`src/config/defaultSetting.ts`
  - `src/components/MetadataEditModal/`
- 依赖：P1 和 P2 零新增；P3 的歌词分享图另行决策
- 许可：全部为原创实现，Apache-2.0；PR 中声明未参考 LynMusic 源码
- 非目标：
  - 标签写入、投屏
  - WebDAV、飞牛、Samba（P4 另立 change）
  - 曲库跨设备同步
  - Android
