# add-ios-local-library 设计文档（净室方案 v1.0）

> 适用对象：lx-music-mobile dev-ios（f2ed2408 起），只用于 iOS，Android 行为零变化。许可证：Apache-2.0。

## 0. 净室声明与执行规则

### 0.1 功能来源
功能范围只参考 LynMusic 的公开描述（README 的功能介绍和截图）以及它对外可观察的行为，不参考源码。

### 0.2 实现依据
本设计的全部技术依据如下：
- Apple 公开文档：
  - UIDocumentPickerViewController
  - URL bookmark 与 security-scoped resource
  - FileManager 与 NSFileCoordinator
  - AVFoundation 的 AVAsset 与 AVMetadataIdentifier
  - ImageIO
  - Keychain Services
  - SQLite3
- 媒体服务器公开 API：
  - Subsonic API 1.16.1 与 OpenSubsonic 扩展
  - Jellyfin OpenAPI（10.9 起）
  - Emby REST API
- lx-music-mobile 自身代码：播放器、列表、下载引擎、主题与组件。

### 0.3 定义均为本设计新定义
以下内容都由本设计重新定义，与 LynMusic 无对应关系：
- 定位符格式
- 数据库表结构
- 元数据映射方式：按 AVMetadataIdentifier 常量精确匹配，不用关键词包含匹配
- 扫描策略
- 编码探测顺序

### 0.4 实现者规则
1. 实现期间不得打开、检索或复制 LynMusic 仓库的源码、资源和字符串。
2. 遇到规格没覆盖的问题，回到本文档和公开文档补充规格，不去看对方的实现。
3. PR 描述中声明「未参考 LynMusic 源码」。
4. 图标、配色和组件全部使用 LX 现有资源，不引入 LynMusic 的任何图片或文案。

### 0.5 已知瑕疵
本设计的作者曾为可行性评估阅读过 LynMusic 源码。严格净室已经不成立，
当前能做到的是降低推导性依赖。缓解措施：
- 本文档只描述行为和公开 API 用法，不含对方的结构、命名或算法细节。
- 开工硬门禁：实现前必须复核本文档与 specs。优先请未接触过上游源码
  的人复核；找不到这样的人时降级为结构化自审：逐节列出「本节设计
  依据的公开文档条目」，形成证据清单，并在 PR 中声明降级事实。
- 处置规则：复核认为某节设计疑似源自上游（结构、命名、算法层面的
  相似）时，该节按公开文档独立重写；重写后仍无法自证依据的，砍掉
  对应功能，不带病实施。
- 功能范围参照基线见 §1.3。

## 1. 目标与非目标

### 1.1 目标
在 LX iOS 版新增「本地曲库」导航页，提供面向个人收藏的离线与私有曲库能力：
- 本地或外部文件夹
- 自建 Navidrome、Subsonic、Jellyfin、Emby
- 统一浏览、播放、收藏和离线下载

**播放器、歌词页、列表和主题全部复用 LX 现有能力。**

### 1.2 非目标
- 元数据回填：只读。`react-native-local-media-metadata` 无 iOS 原生
  实现，写入在 iOS 上没有实现路径（现有 `localMediaMetadata.ios.ts`
  即降级 shim）
- 标签写入（iOS 上只读）
- 投屏
- 车机、TV、桌面歌词
- 曲库数据跨设备同步：曲库数据只在本机。加入 LX 列表的歌曲随 LX 列表同步，在 PC 端不可播放，与现有本地歌曲的行为一致
- Android 端

### 1.3 功能范围参照基线
功能范围以 LynMusic 公开描述（README 与截图可见功能）为参照基线，
逐项按本项目实际情况取舍；基线之外的功能记为 LX 自有需求，不属于
净室参照范围，也不受净室约束。逐项出处见 §2 的「出处」列：

- 参照基线：本地文件夹导入、多维浏览、喜欢与歌单、歌词搜索、歌词
  分享、标签编辑（降级为只读查看）、Samba 与 WebDAV（延后）
- 参照基线但按实际情况变形：标签编辑只读（无 iOS 写入能力）；
  「在线回填」在本设计中只做播放回落（§8.3），元数据与歌词回填由
  现有 `getOtherSourceByLocal` 链路部分覆盖，不另做；TV、车机、
  投屏不做
- LX 自有需求（不受净室参照约束）：Subsonic 通用协议、Jellyfin、
  Emby、离线下载、播放上报、文本导入、已下载曲目自动关联
- 已砍：每日推荐（F12），见 §2

## 2. 功能清单与分期

| 编号 | 功能 | 期 | 出处 |
|---|---|---|---|
| F1 | 来源管理：添加、编辑、删除、启用或停用、重新授权 | P1（本地）/ P2 / P3 | 参照基线 |
| F2 | 本地文件夹来源：系统文件夹选择器（文件 App 任意位置、iCloud Drive、第三方 Provider、本 App 沙箱） | P1 | 参照基线 |
| F3 | 扫描：全量与增量、进度、取消、失败报告（不支持的格式、未下载的 iCloud 文件、读取失败） | P1 | 参照基线 |
| F4 | 元数据：标题、艺人、专辑、专辑艺人、音轨号、碟号、年份、流派、时长、码率、封面 | P1 | 参照基线 |
| F5 | 浏览：歌曲、专辑、艺人三个 Tab，支持来源筛选、搜索、排序；专辑详情和艺人详情 | P1 | 参照基线 |
| F6 | 播放：用 LX 播放器播放，支持「下一首播放」和加入播放列表；本地文件持续持有访问授权 | P1 | 参照基线 |
| F7 | 歌词：内嵌歌词、同名 .lrc、服务端歌词（P2），在线匹配回落复用 LX | P1 / P2 | 参照基线 |
| F8 | 收藏与歌单：「喜欢」映射 LX 的「我的收藏」，歌单映射 LX 自建列表 | P1 | 参照基线 |
| F9 | Subsonic、Navidrome 来源：同步曲库、串流（可选转码码率）、封面、歌词、收藏回写（可选）、播放上报 | P2 | LX 自有 |
| F10 | 离线下载：远程来源的曲目下载到本机，复用 LX 下载引擎；离线优先播放 | P2 | LX 自有 |
| F11 | Jellyfin、Emby 来源：同 F9 | P3 | LX 自有 |
| F12 | 已砍：每日推荐。2026-10-12 评审砍掉，编号留缺口不重排 | — | 参照基线 |
| F13 | 文本导入歌单：粘贴「歌名 - 歌手」多行文本，与曲库匹配后生成 LX 列表 | P3 | LX 自有 |
| F14 | 歌词手动搜索与应用 | P1 | 参照基线 |
| F14b | 歌词分享图 | P3（决策前置） | 参照基线 |
| F15 | 标签查看（只读） | P1 | 参照基线（标签编辑降级） |
| F16 | WebDAV、飞牛、Samba 来源 | P4（另立 change） | 参照基线 |
| F17 | 已下载曲目自动关联：LX 下载完成的曲目自动进入曲库（第 11 节） | P2 | LX 自有 |

## 3. 总体架构

```
┌──────────── RN（TS） ────────────┐        ┌──────── 原生（ObjC）────────┐
│ screens/Home/Views/Library/       │        │ LxLibraryModule (RCTEventEmitter)│
│   Tracks / Albums / Artists       │  NM    │  ├─ LxLibraryStore   (sqlite3)   │
│ screens/LibraryDetail (album/art) │◀──────▶│  ├─ LxFolderAccess   (bookmark)  │
│ store/library  (状态/hook)        │ events │  ├─ LxFolderScanner  (FM+NSFC)   │
│ core/library                      │        │  ├─ LxMediaProbe     (AVAsset)   │
│   sources/local.ts                │        │  ├─ LxArtworkCache   (ImageIO)   │
│   sources/subsonic.ts             │        │  └─ LxCredentialStore(Keychain)  │
│   sources/jellyfin.ts (emby 共用) │        └──────────────────────────────────┘
│   sync.ts / query.ts / resolver.ts│
│   textImport.ts / associate.ios.ts│──▶ core/player（getLocalFilePath 解析定位符）
│   scrobble.ts                     │──▶ core/download（新增 library 任务类型）
└───────────────────────────────────┘──▶ core/list（喜欢/歌单 = LX 列表）
```

### 原则
1. 曲库歌曲在 LX 中一律表示为 `LX.Music.MusicInfoLocal`（`source: 'local'`），不扩充 `LX.Source` 联合类型。原因：
   - `Source` 被同步协议、换源、列表等大量代码使用
   - 桌面端同步遇到未知 source 时的行为不可控
2. 用定位符（locator）标识曲库歌曲，它同时作为 `id` 和 `meta.filePath`，保证稳定：
   - 重签导致容器路径变化时不变
   - 授权刷新时不变
   - 重复加入列表时依靠 id 天然去重
3. 原生层只负责三件事：文件系统、媒体探测、持久化。网络协议、调度和 UI 都在 JS 层。
4. 新增依赖为零：
   - SQLite 用系统 `libsqlite3.tbd`
   - Keychain、AVFoundation、ImageIO 都是系统框架
   - 唯一例外是 F14 的歌词分享图，P3 单独评估是否引入 `react-native-view-shot`（MIT）

## 4. 定位符

```
lxlib://<sourceId>/<itemKey>
```

### 4.1 各部分取值
- `sourceId`：创建来源时生成，取 UUID v4 的小写去横线形式，32 位十六进制。
- `itemKey`：
  - 本地来源：相对来源根目录的路径，每段单独做 `encodeURIComponent`，段之间用 `/` 连接。
  - 远程来源：服务端歌曲 ID，用 `encodeURIComponent` 编码。

### 4.2 规范化与校验
- 解码后，任何一段为 `.`、`..` 或空串时，判定为非法。
- 相对路径统一用 NFC 规范化（Unicode 正规化）。原因是 APFS 不改写文件名的规范化形式，而各 Provider 返回的形式不一。

### 4.3 MusicInfoLocal 映射
| 字段 | 取值 |
|---|---|
| `id` | 定位符 |
| `name` | 标题，缺失时用不带扩展名的文件名 |
| `singer` | 艺人，多个艺人用 `、` 连接，与 LX 现有习惯一致 |
| `interval` | `formatPlayTime2(durationSec)` |
| `meta.songId` | 定位符 |
| `meta.filePath` | 定位符 |
| `meta.albumName` | 专辑名 |
| `meta.ext` | 扩展名，远程来源取服务端的 suffix |
| `meta.picUrl` | 本地来源为 `file://` 缓存封面；远程来源为封面 URL，不带认证参数，解析时再拼接 |

## 5. 原生模块 LxLibraryModule

位置：`ios/LxMusicMobile/Modules/Library/`。

所有方法都返回 Promise。耗时操作在模块私有的串行队列 `lx.library.io` 上执行；扫描用独立的并发受限队列。

### 5.1 LxLibraryStore（sqlite3）
- 文件位置：`Library/Application Support/lx-library/library.sqlite3`
  - 开启 WAL 和 `foreign_keys=ON`
  - 目录设置排除 iCloud 备份
  - 用户不可见
- 迁移：用 `PRAGMA user_version` 控制版本，迁移脚本内嵌在模块里，按版本顺序执行。

表结构（v1）：

```sql
CREATE TABLE source (
  id TEXT PRIMARY KEY, type TEXT NOT NULL,          -- local|subsonic|jellyfin|emby
  name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,                              -- JSON：baseUrl/username/folderLabel/recursive/…（不含密码）
  state TEXT NOT NULL DEFAULT 'ok',                  -- ok|needs_reauth|unreachable|scanning
  last_scan_at INTEGER, last_scan_report TEXT,       -- JSON 摘要
  created_at INTEGER NOT NULL
);
CREATE TABLE track (
  locator TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL, title TEXT NOT NULL, title_sort TEXT NOT NULL,
  artist TEXT, album TEXT, album_artist TEXT, album_key TEXT NOT NULL, artist_key TEXT NOT NULL,
  track_no INTEGER, disc_no INTEGER, year INTEGER, genre TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0, bitrate INTEGER, ext TEXT, size INTEGER, mtime INTEGER,
  artwork TEXT,                                      -- 本地：缓存文件名；远程：coverArt id
  has_embedded_lyric INTEGER NOT NULL DEFAULT 0, sidecar_lrc TEXT, -- 同名 lrc 的 itemKey
  remote_starred INTEGER, offline_path TEXT,         -- 相对 Documents 的离线文件路径
  added_at INTEGER NOT NULL, play_count INTEGER NOT NULL DEFAULT 0, last_played_at INTEGER
);
CREATE INDEX idx_track_source ON track(source_id);
CREATE INDEX idx_track_album ON track(album_key, disc_no, track_no);
CREATE INDEX idx_track_artist ON track(artist_key);
CREATE INDEX idx_track_title ON track(title_sort);
CREATE VIRTUAL TABLE track_fts USING fts5(title, artist, album, content='track', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
-- 触发器维护 track_fts 与 track 同步
-- 曾有 kv 表（推荐缓存用），随每日推荐砍掉，不再引入
```

#### 键的计算
- `album_key = lower(trim(album_artist ?: artist)) + '\u0001' + lower(trim(album))`
- `artist_key = lower(trim(album_artist ?: artist))`
- 专辑和艺人用 `GROUP BY` 视图查询，不单独建表。

#### 中文搜索
FTS5 的 unicode61 分词器不切分中文。查询时按以下规则处理：
- 关键词全是 CJK 字符时，退回到 `LIKE '%kw%'`，对三个字段做 OR 查询，配合 `LIMIT`。1 万首以内实测应该在 50ms 以下，属于待实证项。
- 其他情况用 FTS 前缀查询。

#### 导出方法
- `query(spec)`：只接受结构化查询，不接受 SQL 字符串，防止注入。`spec` 包含：
  - `kind`：`tracks`、`albums`、`artists`、`albumTracks` 或 `artistTracks`
  - `sourceIds`
  - `keyword`
  - `sort`
  - `offset` 和 `limit`（limit 上限 200）
- `upsertTracks(sourceId, rows[])`：批量写入，每批事务最多 500 条。
- `upsertTracks` 时顺带打 seen 标记（临时列或本次会话标记），
  `finishSync(sourceId)` 只删除本次同步未见、且不在第 5.3 节
  「读不到的子目录」之下的曲目。不把全量定位符数组
  （本地 1 万首、Subsonic 2 万首规模）一次过 RN bridge。
- 来源与单曲：
  - `getSources()`
  - `saveSource()`
  - `deleteSource(id)`：级联删除曲目，并清理封面缓存
  - `getTrack(locator)`
- `setOffline(locator, relPath | null)`
- `bumpPlay(locator)`

### 5.2 LxFolderAccess（文件夹授权）

#### `pickFolder()`
1. 用 `UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])`，开启 `asCopy=false` 和 `directoryURL` 记忆。iOS 13 使用 `initWithDocumentTypes:@[kUTTypeFolder] inMode:UIDocumentPickerModeOpen`。
2. 呈现逻辑复用 UtilsModule 已有的「稳定 VC 查找 + 重试呈现」，满足 ios-file-access 规范里的嵌套 Modal 场景。
3. 选中后的处理：
   - 选中的 URL 在本 App 的 `Documents` 内：记录 `{kind:'sandbox', relPath}`，不生成 bookmark。
   - 其他情况：`startAccessingSecurityScopedResource`，接着 `bookmarkDataWithOptions:0`，然后 stop，返回 `{kind:'bookmark', bookmark(base64), label}`。

#### 访问持有
- `acquire(sourceId)` 和 `release(sourceId)` 使用引用计数。
- 首次 acquire 时解析 bookmark（`NSURLBookmarkResolutionWithoutImplicitStartAccessing`），然后 start。
  - bookmark 已过期（stale）时，重新生成并回写到 `source.config`。
  - 解析失败时，把来源状态置为 `needs_reauth`，返回错误码 `E_REAUTH`。
- 播放持有策略：
  - 曲库中有曲目进入播放队列（当前曲或下一首预载）时，acquire 对应来源。
  - App 生命周期内不主动 release。
  - 删除来源时强制 release。
- 理由：AVPlayer 是惰性分段读取，按曲 start/stop 会导致中途读失败。

#### `relink(sourceId)`
重新弹出选择器，只替换 bookmark：
- itemKey（相对路径）不变，所以列表中已有歌曲自动恢复。
- 选中的目录名和原来的不同时，弹确认提示。

### 5.3 LxFolderScanner（扫描）

#### 遍历
- 用 `NSFileManager enumeratorAtURL:includingPropertiesForKeys:options:errorHandler:`：
  - 资源键：`isDirectory`、`isSymbolicLink`、`fileSize`、`contentModificationDate`、`isPackage`、`ubiquitousItemDownloadingStatus`
  - 选项：`SkipsHiddenFiles | SkipsPackageDescendants`
  - 不递归时再加 `SkipsSubdirectoryDescendants`
- 整个遍历包在一次 `NSFileCoordinator coordinateReadingItemAtURL:options:NSFileCoordinatorReadingWithoutChanges` 中（对来源根目录），以获得 Provider 的一致视图。协调读取失败时回退普通枚举，避免在部分第三方 Provider 上整个来源不可扫。
- 单文件读取元数据时，再各自做一次协调读取。
- 符号链接一律跳过，不跟随，以避免环路，也避免越出授权范围。
- `errorHandler` 遇到错误的目录时：记录该相对路径到 `unreadableDirs`，然后继续遍历。

#### 格式白名单
- 允许的扩展名：`mp3, m4a, m4b, aac, alac, wav, aif, aiff, caf, flac`。这些格式 AVPlayer 能原生播放；FLAC 需要 iOS 11 及以上。
- 其他音频扩展名记入 `unsupported`：`ogg, opus, oga, ape, wma, dsf, dff, wv, mka`。
- `.lrc` 文件记入同目录的 sidecar 映射表，键为去掉扩展名的小写文件名。

#### iCloud 未下载的文件
- `ubiquitousItemDownloadingStatus` 不是 `current`，或者文件名形如 `.*.icloud` 的占位文件：记入 `notDownloaded`，不入库，也不触发下载。
- 报告中提供「在文件 App 中下载后重新扫描」的说明。

#### 增量扫描
- 已入库的曲目，`size` 和 `mtime` 都没变时跳过元数据读取，直接计入 seen。
- 其余文件读取元数据，每 200 条 upsert 一次。

#### 并发与取消
- 元数据读取并发数为 4。
- `cancelScan(sourceId)` 会在下一个文件边界停止。被取消的扫描不执行 `finishSync`，避免误删。

#### 事件
- `library_scan_progress {sourceId, phase, scanned, total?, imported}`：节流到每 300ms 一次。
- `library_scan_done {sourceId, report}`：
  - 内容：`report = {imported, updated, removed, unsupported[], notDownloaded[], failed[{path, reason}], unreadableDirs[]}`
  - 各明细列表最多保留 200 条，另附总数。

#### 删除保护
- 位于 `unreadableDirs` 之下的已入库曲目不删除。
- 本次扫描没有发现任何受支持文件，但库里原有曲目数大于 0 时，判定为疑似授权或挂载异常：不清理，同时给出警告。

### 5.4 LxMediaProbe（元数据）

#### 读取方式
- 使用 `AVURLAsset`，选项 `AVURLAssetPreferPreciseDurationAndTimingKey = NO`。
- iOS 15 及以上用 `loadMetadataForFormat` 等异步 API；以下用 `loadValuesAsynchronouslyForKeys:@[@"commonMetadata",@"metadata",@"duration"]`。
- 单文件读取超时 8 秒。超时计入 failed，这首仍然入库，元数据用文件名降级。

#### 映射规则
按 `AVMetadataIdentifier` 常量精确匹配，优先级从左到右：

| 字段 | 标识符 |
|---|---|
| 标题 | `commonIdentifierTitle` → `id3MetadataTitleDescription` → `iTunesMetadataSongName` |
| 艺人 | `commonIdentifierArtist` → `id3MetadataLeadPerformer` → `iTunesMetadataArtist` |
| 专辑 | `commonIdentifierAlbumName` → `id3MetadataAlbumTitle` → `iTunesMetadataAlbum` |
| 专辑艺人 | `id3MetadataBand` → `iTunesMetadataAlbumArtist` |
| 音轨号与碟号 | `id3MetadataTrackNumber` / `id3MetadataPartOfASet` 解析 `n/m`；`iTunesMetadataTrackNumber` / `iTunesMetadataDiscNumber` 按 8 字节结构的第 3、4 字节大端解析 |
| 年份 | `id3MetadataRecordingTime` / `id3MetadataYear` / `iTunesMetadataReleaseDate` / `commonIdentifierCreationDate`，取前 4 位数字 |
| 流派 | `commonIdentifierType` / `id3MetadataContentType` / `iTunesMetadataUserGenre` |
| 封面 | `commonIdentifierArtwork` |
| 内嵌歌词 | `id3MetadataUnsynchronizedLyric` / `iTunesMetadataLyrics` |

#### FLAC
- FLAC 的 Vorbis Comment 通过 AVFoundation 暴露的覆盖面因系统版本而异，需要实证。
- 实证不足时，P1 内补一个最小的 Vorbis Comment 解析器：只读 METADATA_BLOCK 中的 VORBIS_COMMENT 和 PICTURE，按 FLAC 格式规范独立实现。

#### 其他字段
- 文本统一 `trim`，并去掉 NUL。
- 码率取 `AVAssetTrack.estimatedDataRate`。
- 时长取 `CMTimeGetSeconds(duration)`，异常值记为 0。

### 5.5 LxArtworkCache
- 目录：`Library/Caches/lx-library/artwork/`。系统可以清理该目录，丢失后按需重建。
- 文件名：取原始字节的 SHA-1。
- 处理：用 ImageIO 缩放到最长边 600px，输出质量 0.85 的 JPEG。同一专辑多首歌的封面相同，自然去重。
- `artworkPath(locator)`：缓存缺失时重新探测并生成。

### 5.6 歌词读取 `readLyric(locator)`
1. 优先读内嵌歌词。
2. 其次读同名 .lrc：同目录、同名，扩展名不区分大小写，上限 512 KB。
3. 编码探测顺序：
   1. BOM（UTF-8 或 UTF-16 LE/BE）
   2. 严格 UTF-8 解码成功
   3. GB18030
   4. Big5
   5. 以上都失败时返回空

已知局限：GB18030 对字节流容错极高，Big5 分支实际接近死代码，Big5
文件会被当 GB18030 解出乱码。当前接受，有实际反馈再考虑双解码打分。
4. 返回 `{lyric, source:'embedded'|'sidecar'}`，由 JS 侧交给 LX 的 `buildLyricInfo`。

### 5.7 LxCredentialStore
- `setSecret(sourceId, secret)`、`getSecret`、`deleteSecret`。
- 存储参数：`kSecClassGenericPassword`，service 为 `cn.toside.music.mobile.library`，account 为 sourceId，`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`。
- 用 AfterFirstUnlock 而不用 WhenUnlocked，是为了锁屏后台连播时能取到 token。

### 5.8 iOS 13.4 兼容
UTType 和异步加载类 API 都要用 `@available` 分支。部署目标维持 13.4，不提升。

## 6. JS 核心层 `src/core/library/`

| 文件 | 职责 |
|---|---|
| `native.ios.ts` / `native.ts` | 原生方法薄封装；非 iOS 一律 reject `not supported` |
| `locator.ts` | 定位符的构造、解析、校验（纯函数，vitest 覆盖） |
| `sources/local.ts` | 本地来源：pickFolder、relink、scan、cancel |
| `sources/subsonic.ts` | Subsonic 客户端（第 7.1 节） |
| `sources/jellyfin.ts` | Jellyfin 与 Emby 客户端（第 7.2 节），用 `flavor` 区分 |
| `sync.ts` | 来源同步编排：单来源单飞、进度入 store、报告持久化、冷启动后不自动扫描（只有用户触发，或开启「启动时增量扫描」后才扫） |
| `query.ts` | 列表查询，分页游标，带搜索防抖 |
| `toMusicInfo.ts` | 数据库行转 `MusicInfoLocal` |
| `resolver.ts` | 播放、封面、歌词的解析（第 8 节） |
| `scrobble.ts` | 播放上报（第 7.3 节） |
| `associate.ios.ts` / `associate.ts` | 已下载曲目自动关联（第 11 节）；基础文件为空实现，非 iOS 无此行为 |
| `textImport.ts` | 文本导入（第 12 节） |

`src/store/library/`：维护来源列表、扫描进度、当前 Tab、筛选和搜索条件；hook 与 LX 现有 store 的写法一致。

## 7. 远程协议

所有网络请求走 LX 现有的 `request` 封装，以继承代理设置和超时。另外有三条约束：
- 日志中对 `t=`、`s=`、`api_key=`、`X-Emby-Token` 打码。
- 默认超时 15 秒，同步接口 30 秒。
- 自签证书：P2 不支持，在文档中说明。（ATS 当前已开启 `NSAllowsArbitraryLoads`，局域网 http 可用。）

### 7.1 Subsonic 与 Navidrome（API ≥ 1.13）

#### 认证
- 每次请求生成新 salt（12 位随机字母数字），`t = md5(password + salt)`。
- 公共参数：`u, t, s, v=1.16.1, c=lx-music-mobile, f=json`。
- 密码保存在 Keychain。
- 服务端声明 OpenSubsonic 且支持 `apiKeyAuthentication` 时，可以改用 API key，属于 P3。

#### 连接测试
`ping`，必要时再调用 `getOpenSubsonicExtensions`。

#### 全量同步
- 用 `search3?query=""&songCount=500&songOffset=n&artistCount=0&albumCount=0` 分页拉取全部歌曲。Navidrome 和大多数实现都支持空查询。
- 不支持空查询时，回落到 `getAlbumList2?type=alphabeticalByName&size=500&offset=n` 再逐张 `getAlbum`。
- 可选限定 `musicFolderId`，在来源配置里选择。

#### 增量同步
- Subsonic 没有通用的增量接口，每次都做全量拉取，然后对比 `itemKey` 集合。
- 网络中断时不执行 `finishSync`。

#### 字段映射
| Subsonic 字段 | 曲库字段 |
|---|---|
| `id` | itemKey |
| `title` | title |
| `artist` | artist |
| `album` | album |
| `albumArtist` / `displayAlbumArtist`（OpenSubsonic） | album_artist |
| `track` | track_no |
| `discNumber` | disc_no |
| `year` | year |
| `genre` | genre |
| `duration × 1000` | duration_ms |
| `bitRate` | bitrate |
| `suffix` | ext |
| `size` | size |
| `coverArt` | artwork |
| `starred` 是否存在 | remote_starred |

#### 其他接口
- 串流：`stream?id=&maxBitRate=<设置>&format=<raw|mp3>`，`maxBitRate=0` 表示原始码率。
- 封面：`getCoverArt?id=&size=600`。
- 歌词：
  - 优先 OpenSubsonic 的 `getLyricsBySongId`，结构化同步歌词转 LRC 文本
  - 其次 `getLyrics?artist=&title=`
  - 都没有时回落 LX 在线匹配
- 收藏回写：设置项开启时，加入或移出 LX「我的收藏」会调用 `star` / `unstar`。默认关闭。

### 7.2 Jellyfin 与 Emby

#### 认证
- 接口：`POST /Users/AuthenticateByName {Username, Pw}`。Emby 走 `/emby` 前缀，Jellyfin 视服务端配置。
- 请求头：`X-Emby-Authorization: MediaBrowser Client="LX Music", Device="iOS", DeviceId="<安装级 UUID>", Version="<app 版本>"`。
- 返回的 `AccessToken` 和 `User.Id` 保存在 Keychain，不保存密码明文。token 失效（401）时，提示重新登录。

#### 同步
- 接口：`GET /Users/{userId}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,Path,DateCreated,Genres&StartIndex=n&Limit=500&SortBy=SortName`。
- 增量同步：
  - Jellyfin 可以用 `MinDateLastSaved`，但服务端删除的曲目仍需靠全量比对发现。
  - 策略：每次同步都做全量 ID 比对，详细字段只拉取新增和变更的曲目。

#### 字段映射
| Jellyfin 字段 | 曲库字段 |
|---|---|
| `Id` | itemKey |
| `Name` | title |
| `Artists` | artist，用 `、` 连接 |
| `Album` | album |
| `AlbumArtist` | album_artist |
| `IndexNumber` | track_no |
| `ParentIndexNumber` | disc_no |
| `ProductionYear` | year |
| `RunTimeTicks / 10000` | duration_ms |
| `MediaSources[0].Container` | ext |
| `MediaSources[0].Size` | size |
| `MediaSources[0].Bitrate` | bitrate |
| `AlbumId` 或 `Id` 的 Primary 图片 | artwork |

#### 其他接口
- 串流：`/Audio/{id}/universal?UserId=&DeviceId=&api_key=<token>&Container=mp3,aac,m4a,flac,alac,wav&TranscodingContainer=mp3&AudioCodec=mp3&MaxStreamingBitrate=<设置>`。
- 封面：`/Items/{id}/Images/Primary?maxWidth=600`。
- 歌词：`/Audio/{id}/Lyrics`（Jellyfin 10.9 及以上），失败时回落。
- 播放上报：`POST /Sessions/Playing`、`/Sessions/Playing/Progress`（每 30 秒一次）、`/Sessions/Playing/Stopped`。

### 7.3 播放上报（scrobble.ts）
- 监听 LX 播放器事件，只处理定位符为远程来源的曲目。
- Subsonic：
  - 开始播放时调用 `scrobble?submission=false`
  - 播放超过 50% 或 4 分钟时调用 `submission=true`，每首只报一次
- Jellyfin 与 Emby：按第 7.2 节的三个接口上报。
- 本地曲目：只调用 `bumpPlay` 更新本地播放次数。
- 设置项 `library.scrobble` 默认开启。

## 8. 播放、封面、歌词的接入

### 8.1 解析入口
- 现状：`core/music/local.ts` 的 `getMusicUrl` 先调用 `getLocalFilePath(musicInfo)`，取不到时回落在线换源。
- 改动：拆出 `src/utils/music.ios.ts` 平台扩展。Android 继续使用原 `music.ts`，行为不变。
- iOS 版 `getLocalFilePath` 的分支：
  - `filePath` 以 `lxlib://` 开头：交给 `library/resolver.resolvePlayUrl(locator)`。
  - 绝对路径中含有 `/Documents/`（旧数据）：按当前容器重新拼接（rebase）后检查文件是否存在，以修复重签后本地歌曲全部失效的问题。
  - 其余情况：保持原逻辑。
- 在线回落匹配的兼容处理：`getOtherSourceByLocal` 会对 `filePath`
  取最后一段当文件名，定位符的最后一段是 percent 编码，解析处需先
  `decodeURIComponent`。
- 错误呈现：`getMusicUrl` 对 `getLocalFilePath` 没有 try/catch，
  resolver 抛错会直接向上传播。`E_CELLULAR` 等带用户提示的错误码，
  其本地化 toast 接线写进实现规格，不能只停留在错误码层。

### 8.2 `resolvePlayUrl` 的规则
| 来源 | 结果 |
|---|---|
| 本地来源 | acquire 来源授权，拼出文件 URL；文件存在时返回 `file://…`，不存在时返回 `''`，交由 LX 回落在线换源（与现有本地歌曲行为一致） |
| 远程来源，`offline_path` 存在且文件存在 | 返回本地 `file://` 路径（离线优先） |
| 远程来源，没有离线文件 | 来源已启用且可达时，按设置的串流码率拼出带认证参数的 URL |
| 远程来源，处于蜂窝网络且 `library.allowCellularStream=false` | 抛出 `E_CELLULAR`，提示「蜂窝网络下已禁止串流」，不回落在线 |

### 8.3 回落在线换源
- 设置项 `library.onlineFallback`（默认开启）：远程来源不可达时，是否允许 LX 按歌名回落到在线源。默认值沿用 LX 本地歌曲的现有行为。
- 与参照基线的语义差异：LynMusic 公开描述里的「在线结果回填」指用
  在线源补本地曲目的元数据与歌词；本设计只做播放地址回落，元数据
  与歌词回填由现有 `getOtherSourceByLocal` 链路部分覆盖，不另做。

### 8.4 封面
`getPicUrl` 的本地分支：
- 对 `lxlib://` 定位符：
  - 本地来源：`artworkPath`
  - 远程来源：封面 URL 加认证参数
- 失败时回落在线，逻辑不变。

### 8.5 歌词
`getLyricInfo` 的 `getMusicFileLyric` 分支：
- 本地来源：调用原生 `readLyric`。
- 远程来源：走服务端歌词接口。
- 其后的缓存和在线匹配逻辑保持不变。

### 8.6 缓存与预载
- `utils/data` 中的 URL 缓存不缓存 `lxlib` 解析出的串流 URL，因为里面带 token 和临时 salt。每次播放都重新解析。
- 下一首预载（`preloadNextMusic`）沿用「不探测本地文件」的规范：
  - 远程串流照常预载 URL
  - 本地来源只做 acquire，不读取文件

### 8.7 标签查看与编辑
- 标签编辑弹窗（MetadataEditModal）：iOS 上对 `lxlib` 曲目改为只读的「标签信息」视图，数据来自数据库行。
- 写入入口隐藏。

## 9. 收藏、歌单、播放队列（映射 LX）

- 「喜欢」直接写入 LX 的 `LIST_IDS.LOVE`。曲库页对 `lxlib` 曲目显示爱心状态：建一个 `Set<locator>` 内存索引，监听列表变更事件维护。
- 「添加到歌单」复用 LX 的 `ListAddModal`，歌单就是 LX 自建列表。
- 「播放」：按当前视图生成 `MusicInfoLocal[]`，写入 LX 的临时列表 `LIST_IDS.TEMP` 后开始播放。
  - 专辑：按碟号、音轨号排序
  - 艺人：按专辑和音轨排序
  - 歌曲 Tab：保持当前排序
  - 超过 5000 首时只放入当前页之后的 5000 首，避免临时列表过大
- 「下一首播放」复用 LX 的 `PLAY_LATER` 逻辑。
- 删除来源时提示「LX 列表中仍有 N 首该来源歌曲，将无法播放」，提供两个选项：一并从列表移除，或者保留。

## 10. 离线下载（扩展 LX 下载引擎）

### 10.1 数据结构
- `LX.Download.ListItem.metadata` 新增 `kind?: 'online' | 'library'`，缺省为 `online`，兼容已有持久化数据。
- 新增 `libraryLocator?: string`。
- 与自动关联的互斥：`kind: 'library'` 任务由 `offline_path` 表示，
  不进第 11 节的自动关联；自动关联只消费 `kind: 'online'` 任务。
- library 任务的 `musicInfo` 字段存放 `MusicInfoLocal`。类型改为联合类型，所有使用点按 kind 收窄。
- `LX.Download.FileExt` 当前只有 `mp3 | flac | wav | ape`，library
  任务按服务端原始扩展名保存会出 m4a、aac，类型联合必须扩。

### 10.2 关键模块改动
| 模块 | 改动 |
|---|---|
| `urlResolver.ts` | library 任务按设置项 `library.downloadQuality`（`raw/320/192/128`）生成串流 URL；刷新时重新签名，不走在线换源 |
| `utils.createDownloadInfo` | 新增 `createLibraryDownloadInfo(musicInfo, quality)`，任务键为 `${locator}_${quality}` |
| `buildSavePath` | `Download/Library/<艺人>/<专辑>/<音轨号>. <标题>.<ext>`，沿用 LX 的文件名清洗与截断函数 |
| 完成回调 | 调用 `LxLibraryStore.setOffline(locator, relPath)`；同时写 `downloadIndex`，键为定位符 |
| 对账 | 离线文件缺失时清除 `offline_path` |
| `lrc.ts` | library 任务的歌词来自 `readLyric` 或服务端歌词 |

### 10.3 入口
- 曲库歌曲菜单中的「下载」。
- 专辑或艺人详情中的「全部下载」，下载前给出数量和预估大小确认。
- 只对远程来源显示。本地来源不需要下载。

### 10.4 规范影响
修改已有的 `ios-download` 规范，见 specs。

## 11. 已下载曲目自动关联（F17）

LX 下载完成的曲目自动进入曲库，可浏览、搜索、入列，不需要手动导入。
LX 已有 `downloadIndex` 的本地优先播放机制，但那只解决播放寻址；
自动关联补的是可见性与组织：下载完成的曲目以曲库曲目身份出现。

### 11.1 身份模型
- 新增虚拟来源「下载」，`source.type = 'download'`，全库只允许一个，
  首次关联时创建，不在来源管理里走「添加」流程。
- 来源根目录是沙箱内 Documents，按第 5.2 节的沙箱分支记录，不需要
  bookmark。
- `itemKey` 取下载任务的 `metadata.filePath`（相对 Documents 的路径）。
  下载模块本就按这个模式存储，读取时经 `resolveDownloadPath` 拼接，
  重签后定位符不变。
- 定位符仍是 `lxlib://<sourceId>/<itemKey>`。

### 11.2 挂钩方式：订阅事件做差量，不改下载调度
下载完成有三个入口，且都触发同一个事件：
- `scheduler.ts` 的 `handleComplete`（引擎 complete 事件）
- `handleStartTask` 的 `skipExistFile` 快路径（文件已存在直接置完成）
- `claimOrphanTasks` 的孤儿认领

三处都经 `store/download/action.ts` 落盘并触发
`global.app_event.downloadListUpdate`。因此关联模块不侵入调度器，
只订阅这一个事件做差量对账：
- 内存维护「已关联任务」集合，冷启动时用曲库中该来源的现有曲目
  重建：映射键是 `item_key == task.metadata.filePath`，不需要额外
  schema 字段。
- 每次事件到达（节流约 1 秒）：扫任务列表，`status === 'completed'`
  且 `isComplate` 且未关联的任务进入待入库集合；已关联但任务已不在
  列表（删除、清空已完成）的记录进入待移除集合。
- `reconcile` 标出的 `FILE_MISSING` 任务不进待入库；已关联的任务变成
  `FILE_MISSING` 时按文件缺失移除关联。`reconcile` 自身只改内存状态，
  不发事件也不落盘，状态变化随后续任意一次 `updateDownloadTask`
  落盘并触发事件，差量在下一个事件周期感知。

不修改双端共享的 `scheduler.ts` 与 `index.ts`，Android 隔离上干净。

### 11.3 只关联 `kind: 'online'` 任务
`kind: 'library'` 任务（远程曲库曲目的离线下载）已由第 10 节的
`offline_path` 表示。自动关联跳过这类任务，避免同一文件出现两条曲目。

### 11.4 同歌多音质去重
任务键是 `${歌曲id}_${音质}_${扩展名}`，同一首歌换音质重下会产生第二
个任务。关联按歌曲 id 去重，比较规则与 `downloadIndex` 的
`qualityRank` 一致（该表是模块私有、不导出，在关联模块内复刻）：
新任务音质更高时替换关联（旧行删除，新行入库），音质更低时忽略。
被替换任务的文件留在磁盘，归下载页管理。

实现契约：歌曲 id 只存在于任务元数据（`metadata.musicInfo.id`），
曲库表没有也不加这个字段。去重在差量计算时对全部 `completed` 任务
按歌曲 id 分组、每组只选最高音质的任务入库，冷启动首次差量同样执行，
不依赖数据库状态。

### 11.5 元数据与封面
- 任务里的 `musicInfo` 是在线曲目，字段不全（没有时长毫秒、码率、
  专辑艺人）。关联时用 `LxMediaProbe` 读已下载文件拿真实元数据，
  `musicInfo` 的 name、singer、albumName 作降级值。
- 内嵌封面走 `LxArtworkCache`，与其他本地曲目同路径。
- 歌词：`download.isDownloadLrc` 开启时，`handleComplete` 路径会写
  同名 `.lrc`（`lrc.ts`），`readLyric` 的 sidecar 分支直接命中。注意
  `skipExistFile` 快路径不调 `saveLrc`，这类任务即使开了开关也没有
  `.lrc`，歌词走 LX 缓存与在线回落。

### 11.6 删除与解绑语义
- 下载页删任务且删文件：差量移除关联，曲库曲目消失。
- 下载页删任务留文件：关联跟着任务走，一并移除。文件仍在
  `Download/` 下，想保留进曲库可以自行把该目录加为本地来源。
  「清空已完成」是批量版本，会一次清掉大量曲库曲目而文件都还在；
  清空前提示「将从曲库移除 N 首」。
- 曲库侧删除「下载」来源的曲目：只解绑（删曲库行），不动下载任务与
  文件。曲库对沙箱内文件不提供删除操作，与第 16 节的安全边界一致。
- 「下载」虚拟来源可停用不可删除；提供「清空关联」操作（解绑全部，
  文件不动）。
- 用户若把 `Download/` 目录手动加为本地来源，同一文件会同时以两个
  来源的曲目出现（定位符不同，去重不覆盖跨来源）。来源添加页对选中
  `Download/` 给一行提示，不做硬拦截。

### 11.7 设置与初始化
- 设置项 `library.autoAssociateDownloads`（默认开启，第 14.6 节），
  受 `library.enable` 门控。
- 关闭开关只停止新的关联，已关联曲目保留；重新开启时差量对账会
  补齐关闭期间新完成的任务。
- 首次启用该功能时（升级安装或从未开过）对全部存量完成任务做一次
  批量导入，UI 上按扫描进度呈现。
- 初始化依赖两个前置：`initDownload` 完成（下载列表已加载）和曲库
  store 初始化完成（能查「下载」来源的现有曲目重建关联集合），
  两者都就绪后才订阅事件并执行首次差量。挂在
  `core/library/associate.ios.ts` 平台扩展，基础文件 `associate.ts`
  为空实现，Android 上不存在此行为。

## 12. 文本导入歌单（F13）

### 12.1 输入格式
- 每行一首歌，分隔符依次尝试：` - `、`-`、`—`、`－`、制表符。
- 按最后一个分隔符拆分成「歌名」和「歌手」。
- 不含分隔符的行只按歌名匹配。

### 12.2 归一化
NFKC，转小写，去掉括号内容（`()`、`（）`、`[]`、`【】`），去掉 `feat.` 之后的部分，合并空白。

### 12.3 匹配策略
1. 先找歌名与歌手都完全相等的曲目。
2. 其次找歌名相等、歌手互相包含的曲目。
3. 再次只按歌名匹配，且全库唯一时才采用。
4. 结果预览分为「已匹配」「多候选」（让用户选）和「未匹配」三类。

### 12.4 输出
- 用户确认后新建一个 LX 自建列表，列表名由用户输入。
- 未匹配的行可以复制出来。

## 13. 歌词手动搜索与分享图（F14 手动搜索为 P1，F14b 分享图为 P3）

### 13.1 手动搜索（P1）
- 用 LX 现有的在线搜索（各源 `musicSearch`）按「歌名 + 歌手」检索。
- 候选列表展示「歌名、歌手、专辑、时长差」，用户选中后获取该在线歌曲的歌词。
- 结果用 `saveLyric(musicInfo, lyricInfo)` 写入 LX 歌词缓存。现有的 `getCachedLyricInfo` 会命中这份缓存。

### 13.2 歌词分享图（F14b，P3）
- 截图方案在进入 P3 前单独决策，评审记录倾向 `react-native-view-shot`：
  `UIGraphicsImageRenderer` 只能渲染 UIKit 视图，RN 视图树无法离屏
  原生截图，自研等于用 CoreGraphics 重画整张卡片，工作量并不小。
- 在播放详情页的歌词上长按，选择 1 到 8 行。
- 生成卡片，内容为封面取色背景、歌词、歌名和歌手，以及 LX 的 logo。
- 保存到相册，需要新增 `NSPhotoLibraryAddUsageDescription`；也可以调起系统分享。
- 截图依赖待评估：
  - `react-native-view-shot`
  - 或者原生 `UIGraphicsImageRenderer` 渲染一个离屏 RN 视图
- 进入 P3 前单独决策。

## 14. UI（统一 LX 样式）

### 14.1 导航
- `NAV_MENUS_IOS` 在 `nav_download` 之前插入 `{ id: 'nav_library', icon: 'sd-card' }`，使用 LX 现有的 iconfont，不新增图标。
- 竖屏 Main 和横屏 Main 的 `viewMap` 注册 `nav_library`。
- 设置项 `library.enable` 为 false 时隐藏入口，默认开启。

### 14.2 页面 `screens/Home/Views/Library/`
- 顶栏：
  - 标题「本地曲库」
  - 来源筛选下拉，复用 LX 的 `DorpDownMenu` 组件
  - 搜索输入，复用 LX 的 `Input`
  - 右侧「⋮」菜单：来源管理、扫描全部、设置
- Tab 共三个：歌曲、专辑、艺人，样式与 LX「排行榜」「歌单」页的 Tab 一致。
- 歌曲行：
  - 复用 LX 的 `OnlineList` 行布局：序号、歌名、歌手 · 专辑、时长，远程来源有离线标记
  - 支持多选模式（复用现有多选组件）
- 专辑网格：复用 LX 歌单广场的网格卡片，显示封面、专辑名、艺人。
- 艺人列表：首字母分组，取不到首字母时归入 `#`。
- 空状态：「还没有曲库来源」，配「添加文件夹」「连接服务器」两个按钮。

### 14.3 详情页
- 新增 `LIBRARY_DETAIL_SCREEN`，注册方式同 `SONGLIST_DETAIL_SCREEN`。
- 头部样式复用歌单详情页：封面、标题、副标题、「播放全部」、「全部下载」（仅远程来源）、「添加到列表」。

### 14.4 来源管理
来源管理弹窗用 LX `Dialog` 和表单组件实现。

列表页：
- 每个来源显示类型图标（文字徽标：本地、Subsonic、Jellyfin、Emby）、名称、曲目数、最后扫描时间、状态，状态包括需重新授权、不可达和扫描中。
- 可执行的操作：扫描、编辑、重新授权、停用、删除。

添加来源：
- 本地：选择文件夹；可设置包含子文件夹（默认开启）、显示名称。
- 服务器：类型、地址、用户名、密码；可设置音乐库（Subsonic musicFolder，或 Jellyfin library 多选）；提供「测试连接」。

扫描报告页：显示导入、更新、移除的数量，以及不支持、未下载、失败三个可展开清单。

### 14.5 歌曲菜单（复用 `ListMenu` 体系）
- 播放
- 下一首播放
- 添加到列表
- 喜欢或取消喜欢
- 下载：远程来源，且未离线
- 删除离线文件：已离线
- 标签信息
- 搜索歌词：P1
- 查看专辑
- 查看艺人

### 14.6 设置分组「本地曲库」
| 键 | 默认值 | 说明 |
|---|---|---|
| `library.enable` | true | 显示入口 |
| `library.scanOnLaunch` | false | 冷启动后延迟 10 秒，对本地来源做增量扫描 |
| `library.streamQuality` | `raw` | `raw/320/192/128` |
| `library.allowCellularStream` | true | 蜂窝网络下是否允许串流 |
| `library.downloadQuality` | `raw` | 同上 |
| `library.onlineFallback` | true | 远程或本地失效时按歌名回落在线源 |
| `library.scrobble` | true | 播放上报 |
| `library.syncStar` | false | 「喜欢」回写服务端 |
| `library.autoAssociateDownloads` | true | 已下载曲目自动关联进曲库（第 11 节） |

- 「清理封面缓存」按钮显示缓存大小。
- 三语文案写入 `src/lang/{zh-cn,zh-tw,en-us}.json`，键前缀 `library_`。

## 15. 性能指标（真机实证门禁）
| 场景 | 目标 |
|---|---|
| 1 万首本地扫描（全新） | 不超过 6 分钟（以 iPhone 12 为基准），UI 不卡顿，内存峰值增量不超过 150 MB |
| 1 万首增量扫描（无变化） | 不超过 20 秒 |
| 歌曲 Tab 首屏 | 不超过 300 ms；滚动 60fps（FlatList，`getItemLayout` 固定行高） |
| 搜索 | 输入防抖 250 ms，查询不超过 100 ms |
| Subsonic 同步 2 万首 | 不超过 3 分钟（局域网） |

## 16. 安全
- 定位符解码后统一校验，禁止 `..`；拼接结果必须仍在来源根目录之下（比较标准化后的路径前缀）。
- 密码和 token 只存 Keychain；`source.config` 和日志中都不出现。
- `query` 只接受结构化参数。
- 外部目录只读访问，原生侧不提供任何写入或删除外部文件的方法。删除离线文件只针对 `Documents/Download/Library/` 之下的文件，并复用下载模块的路径安全校验。

## 17. 错误码
| 错误码 | 含义 | 用户提示 |
|---|---|---|
| `E_REAUTH` | bookmark 失效 | 文件夹授权已失效，请重新选择该文件夹 |
| `E_NOT_FOUND` | 文件不存在 | 文件已被移动或删除 |
| `E_NOT_DOWNLOADED` | iCloud 未下载 | 请先在「文件」App 中下载 |
| `E_UNREACHABLE` | 服务器不可达 | 无法连接到服务器 |
| `E_AUTH` | 401/403 | 登录已失效，请重新登录 |
| `E_CELLULAR` | 蜂窝网络下禁止串流 | 已在设置中禁止蜂窝网络串流 |
| `E_UNSUPPORTED` | 格式不支持 | iOS 无法播放该格式 |
| `E_SCAN_BUSY` | 来源正在扫描 | 正在扫描中 |

## 18. Android 隔离
- 原生模块只在 iOS 上存在。
- JS 层使用 `native.ios.ts` 加基础文件 `native.ts`（reject）。
- `music.ios.ts` 是平台扩展。
- 导航项只在 `NAV_MENUS_IOS` 中出现。
- 设置分组用 `Platform.OS === 'ios'` 门控。
- Android 构建产物不应出现任何行为差异：人工比对，并在 CI 的 build-test 中回归。

## 19. 测试
- vitest 覆盖：
  - locator：构造、解析、非法输入
  - toMusicInfo
  - Subsonic 认证与分页：mock fetch
  - Jellyfin 字段映射
  - textImport：拆分、归一化、三级匹配
  - 歌词手动搜索：候选匹配与缓存写入
  - associate：差量计算、多音质去重、`FILE_MISSING` 移除
  - resolver：分支矩阵
  - 下载 library 任务：键、路径、完成回调
  - 设置默认值
- 原生：XCTest 不在现有 CI 范围内；关键行为列入真机实证清单。
- 真机实证（未实证的不得标为通过，沿用 verification-gates 规范）：
  1. 外部文件夹授权在重启、冷启动、重签之后的有效性，以及重新关联后歌曲能否恢复
  2. iCloud Drive 目录扫描（含未下载项）
  3. 第三方 Provider（任选一个网盘）扫描与播放
  4. 外部文件夹歌曲锁屏后台连播 30 分钟
  5. FLAC、ALAC、M4A、MP3 元数据覆盖率，FLAC 的 Vorbis Comment 是否需要自研解析
  6. 1 万首规模的性能指标
  7. Navidrome 与 Jellyfin 的串流、转码、上报、离线下载

## 20. 分期与里程碑
| 期 | 内容 | 估时 | 出口 |
|---|---|---|---|
| P1 | 原生模块（Store、Access、Scanner、Probe、Artwork、歌词）、本地来源、三 Tab（歌曲、专辑、艺人）、详情页、播放接入、喜欢与歌单映射、标签查看、歌词手动搜索（F14）、旧路径 rebase、设置分组 | 3 到 4 周（歌词搜索与标签查看进 P1 是主动扩容决策，已入档） | 真机实证 1、4、6 必过；2、3、5 允许带观察项 |
| P2 | Subsonic 与 Navidrome、Keychain、串流设置、服务端歌词、上报、离线下载扩展、已下载曲目自动关联（第 11 节） | 2 周 | 真机实证第 7 项（Navidrome） |
| P3 | Jellyfin 与 Emby、文本导入、歌词分享图（决策前置，第 13.2 节） | 2 周 | 真机实证第 7 项（Jellyfin） |
| P4 | WebDAV、飞牛、Samba | 另立 change | — |

## 21. 待决事项
2026-10-12 评审后全部关闭，结论如下：

1. 已关闭：每日推荐（F12）整体砍掉，曲库页为三 Tab，不做占位。
2. 保留至 P3：歌词分享图的截图方案（第 13.2 节），进入 P3 前单独
   决策；评审记录倾向 `react-native-view-shot`，理由见第 13.2 节。
3. 已关闭：`library.onlineFallback` 默认开启，与 LX 本地歌曲一致。
4. 已关闭：「隐藏」文件夹或曲目不做，不进后续各期既定范围。
5. 已关闭：净室复核按第 0.5 节的开工硬门禁执行，含降级路径。
