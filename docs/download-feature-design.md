> 版本：定稿 · 2026-10-09
> 目标分支 `dev-ios` @ `7da8026` · 建议变更名 `add-ios-download`
> 行为基准：lx-music-desktop @ `ad95d50`，下载模块位于 `src/renderer/store/download`、`src/renderer/worker/download`、`src/common/utils/download`
> 核实范围：
>
> - 本仓库行号均对照 `dev-ios` @ `7da8026` 源码
> - RNFS 结论对照上游 `react-native-fs`（`^2.20.0`）的 `Downloader.m` / `RNFSManager.m` 源码（已逐行核对本机安装副本）
> - Apple 系统行为依据官方文档，凡未经真机实测的项均标注「需实证」
>   性质：本文是 `openspec/changes/add-ios-download/` 的 design 底稿。实施前须按 `AGENTS.md` 门禁建齐四个工件
>   r2 相对上一版定稿修正 13 处，见附录 A

---

## 0. 结论

**iOS 专属；JS 负责调度，原生负责传输。**

- 队列、状态机、取链接、重试、持久化和 UI 按桌面版移植到 JS 层
- 字节传输交给新增的原生下载层：固定 identifier 的 `NSURLSession` 后台会话
- Android 行为零变化。Android 下载另立 change，在 `dev` / `master` 上评估。依据 `AGENTS.md:158`：`dev-ios` 的非目标是任何 Android 行为变更

不用 RNFS 作为 iOS 引擎，依据如下：

| 问题                    | 上游源码事实                                                                                                  | 后果                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 网络中断时 Promise 悬空 | `didCompleteWithError` 拿到 resumeData 后只调 `resumableCallback`，不调 `errorCallback`                 | Promise 永不 settle，任务卡在`run` |
| 暂停时 Promise 悬空     | `stopDownload` 走 `cancelByProducingResumeData`，有数据时只发 `DownloadResumable`                       | 同上                                 |
| 非 2xx 被当作完成       | `didFinishDownloadingToURL` 不论状态码都调 `completeCallback`，非 2xx 只是不 move                         | 403 被报告为「完成」                 |
| 杀进程后无法续传        | 后台模式每次用随机 UUID 作 identifier；resumeData 只存在内存                                                  | 系统无法把会话交还给新进程           |
| iOS 上从未调用          | `src/utils/version.ios.js:69` 走 `Linking.openURL`；`version.js:94` 的 `downloadFile` 只有 Android 用 | 「已在产验证」对 iOS 不成立          |

前台下载的现实条件：`Info.plist:47` 声明了 `UIBackgroundModes = audio`，所以放歌期间 App 不会挂起，下载可以继续。不放歌时一退后台下载就停，杀进程后只能从 0 开始；而上表前两条在网络抖动时必然会碰到。因此引擎必须自研，调度逻辑则没有理由偏离桌面版。

---

## 1. 现状：接线点

| 接线点         | 位置                                                                                                                          | 现状 → 动作                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 下载类型       | `src/types/download_list.d.ts`                                                                                              | 已有五态和`ListItem`，缺 `listId` → 补上                                |
| 列表常量       | `src/config/constant.ts:14` `LIST_IDS.DOWNLOAD`                                                                           | 已有                                                                         |
| 统一取流       | `src/core/music/index.ts:21` 按 `'progress' in musicInfo` / `source == 'local'` 分流                                    | 不改                                                                         |
| 播放取链接入口 | `src/core/player/player.ts:96` `getMusicPlayUrl`；`:102` 先用 `toggleMusicInfo` 取链接，失败后再用原歌曲              | **本地优先挂在这里**（§9）                                            |
| 在线取链接     | `src/core/music/online.ts:42` `getMusicUrl`                                                                               | **不改**：下载器也调它（§9 说明原因）                                 |
| 下载源取流     | `src/core/music/download.ts`                                                                                                | 解开本地分支的注释                                                           |
| 播放列表查询   | `src/core/player/playInfo.ts:141`                                                                                           | DOWNLOAD 分支改为返回下载列表                                                |
| 播放栏         | `PlayerBar/components/Title.tsx:30`                                                                                         | 已处理，不动                                                                 |
| 预加载         | `src/core/init/player/preloadNextMusic.ts:39-48`：对取到的 url 调 `isCached` 和 `checkUrl`，失败后用 `isRefresh` 重取 | `file://` 跳过检查（§9）                                                  |
| 列表事件       | `src/event/appEvent.ts:152` `downloadListUpdate()`                                                                        | 已有                                                                         |
| 导航           | `constant.ts:101-108` `NAV_MENUS`（`as const`），下载项被注释，id 为 `'download'`；`:110` 由它派生 `NAV_ID_Type`  | §10.1                                                                       |
| 导航持久化     | `storageDataPrefix.viewPrevState`（`constant.ts:43`）；`core/init/dataInit.ts:34` 冷启动恢复 `navActiveId`            | 恢复时需要回退（§10.1）                                                     |
| 导航文案       | `src/lang/zh-cn.json:163-168` 只有 `nav_search/songlist/top/love/setting/exit`                                            | 三种语言补`nav_download`                                                   |
| 歌曲菜单       | `OnlineList/ListMenu.tsx:55`、`Mylist/MusicList/ListMenu.tsx:67`                                                          | 加显示条件后启用                                                             |
| 多选全选       | 两处`MultipleModeBar.tsx`                                                                                                   | 直接复用                                                                     |
| 设置分组       | `Setting/Main.tsx:15` `ALL_SETTING_SCREENS`；`:31` 按 `Platform.OS` 生成 `SETTING_SCREENS`                          | 加`download`，只在 iOS 出现                                                |
| 歌词           | `src/utils/lrcTools.ts:81` `buildLyrics`                                                                                  | 与桌面版同源                                                                 |
| 切源记录       | `src/types/music.d.ts:25` `meta.toggleMusicInfo`                                                                          | 取链接的第一优先级                                                           |
| 音质降级       | `src/core/music/utils.ts:216` `TRY_QUALITYS_LIST`，只有 3 档                                                              | 另建 7 档`QUALITYS`，现有常量不动                                          |
| 音质类型       | `src/types/common.d.ts:6` 已包含 `wav`/`ape`/`192k`                                                                   | 不用扩展                                                                     |
| 文件名过滤     | `src/utils/common.ts:126` `filterFileName`，过滤集含 `#`，与桌面版 `common.ts:127` 一致                               | 直接复用                                                                     |
| 名称截断       | 移动端没有                                                                                                                    | 移植桌面版`clipNameLength`（80 字符）和 `clipFileNameLength`（150 字符） |
| 设置           | `defaultSetting.ts:70` 只有 `download.fileName`；`app_setting.d.ts:347`                                                 | 补 11 项                                                                     |
| 存储前缀       | `constant.ts:40` `storageDataPrefix`                                                                                      | 加`downloadList`                                                           |
| 文件可见性     | `Info.plist:80` `LSSupportsOpeningDocumentsInPlace`、`:89` `UIFileSharingEnabled` 均为 true                           | `Documents` 整个目录在「文件」App 里可见                                   |
| iOS 元数据     | `localMediaMetadata.ios.ts`：读取降级，写入 reject                                                                          | P1 不嵌入                                                                    |
| AppDelegate    | `AppDelegate.mm:37` `didFinishLaunching`；`:43` 手动 `new RCTBridge`，`:44` `bootstrapWithBridge`                 | §4.1                                                                        |
| 最低系统       | `IPHONEOS_DEPLOYMENT_TARGET = 13.4`                                                                                         | 可以用`allowsConstrainedNetworkAccess`（iOS 13+）                          |
| 合规条款       | `spec/requirements.md:57`：协议要求使用者 24 小时内清除；`:73`：不提供、不代理、不缓存分发                                | §12                                                                         |
| CI             | `.github/workflows/ios-verify.yml` 在 `dev-ios` 上跑 `npm test`、Metro 双端，不跑 lint                                  | 本地自跑 lint                                                                |

---

## 2. 目标与非目标

### 目标

1. 在线歌曲可按音质下载到本机。单曲用音质弹窗，多选和全选用批量弹窗
2. 队列行为与桌面版一致：并发上限、五种状态、暂停、继续、删除、失败重试，以及链接失效后刷新或换源
3. 不同终止方式下的恢复能力：
   - App 被挂起，或被系统回收：下载由系统继续，完成后 App 被唤醒并记账
   - 用户在多任务界面上划强退：系统会取消传输。下次启动时任务回到「已暂停」，URL 未变就用 resumeData 续传
4. **任何列表**里已下载的歌曲都优先播放本地文件，可以离线播放
5. 音频文件在「文件」App 的「我的 iPhone › LX Music › Download」里可见；内部文件不可见
6. Android 无任何行为变化

### 非目标

按性质分三类。「永不」项由平台、库能力或合规决定，不再重开；「缓做」项有明确的重开路径；「另立」项受治理门禁约束。

**永不（平台 / 库能力 / 合规）**

| 项                                          | 原因                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| APE 永不嵌入元数据                          | 元数据库不支持该格式，与桌面版一致                             |
| 不能自选保存目录                            | iOS 沙箱决定，`Documents/Download/` 固定；这不是范围取舍     |
| 不在 App 内强制执行 24 小时自动清除（§12） | 与离线播放目标直接互斥；`:57` 的清除要求是协议对使用者的约束 |
| 不提供分享或分发入口                        | 合规红线，与`spec/requirements.md:73` 冲突                   |

**缓做（分期取舍，技术可行，有重开路径）**

| 项                    | 重开路径                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| P1 不写 ID3/FLAC 标签 | P2 已排期（TagLib + 嵌入类设置），无需重开讨论                                                         |
| 跨设备同步下载任务    | 属同步协议变更，高风险项；需要时另立 change，当前无计划                                                |
| 导入导出下载列表      | 依赖在、通道可复用`.lxmc`/Backup；与「下载完成后加入指定列表」一并放 P3                              |
| `.lrc` 只输出 UTF-8 | `iconv-lite` 依赖已在（`package.json:55`），改动成本极低；移动端没有车载读盘场景，出现该需求再重开 |

**另立（治理门禁）**

| 项           | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android 下载 | `AGENTS.md:158`：`dev-ios` 的非目标是任何 Android 行为变更，触碰即停下确认，本变更不做。P1 完成后建议立即立 `add-android-download`：`engine.ts` 空实现就是为它留的，`store/download`、调度、持久化、索引、对账、全部 UI 可复用，需要重做的是引擎与保存路径策略（SAF / `targetSdkVersion 29` 与 iOS 完全不同）。注意 §0 对 RNFS 的指控都针对 iOS 实现，Android 侧没有后台会话和 Promise 悬空问题，但完成回调自查 `statusCode` 的要求同样适用 |

---

## 3. 架构

```
JS（React Native）
  UI：DownloadModal / DownloadMultipleModal / 列表菜单 / 下载页 / 设置 → 下载
  store/download            state / action / hook
  core/download
    index.ts                create / start / pause / remove / startAll / pauseAll、isDownloadSupported
    scheduler.ts            checkStartTask、并发、补位、tryNum
    urlResolver.ts          getUrl / refreshUrl（桌面版两段式）
    engine.ios.ts           原生调用、事件订阅、drain + ack
    engine.ts               空实现（非 iOS，调用即 reject）
    utils.ts                QUALITYS、getMusicType、getExt、createDownloadInfo、buildSavePath、
                            clipNameLength、clipFileNameLength
    lrc.ts                  saveLrc（UTF-8）
    downloadIndex.ts        全局已下载索引 + lookupLocal(musicInfo)
    persist.ts              AsyncStorage 分片 + 100ms 节流 + flush()
    reconcile.ts            文件对账
        │ NativeModules / NativeEventEmitter（LxDownloadEvent）
iOS 原生
  Modules/LxDownloadManager.{h,m}   纯 ObjC 单例：持有会话、做 delegate、move 文件、写事件日志；不依赖 RN
  Modules/DownloadModule.{h,m}      RCTEventEmitter 外壳：转发调用、订阅 manager
  AppDelegate.mm                    启动时创建 manager；handleEventsForBackgroundURLSession 交给 manager
```

**JS 决定下什么、用哪个链接、失败后怎么办；原生只负责把字节可靠落盘，并如实报告结果。** 原生不重试，不取链接，不排队。

---

## 4. 原生层

### 4.1 拆成 Manager 与 Module

- 后台会话的 delegate 必须在 App 一启动就存在。系统后台唤醒时，先调 `didFinishLaunching`，再调 `handleEventsForBackgroundURLSession:`。这时 JS 可能还没加载，RN 的桥接模块又是懒加载的，实例可能还不存在。本工程在 `AppDelegate.mm:43` 手动创建 bridge，这个窗口期是确实存在的
- `LxDownloadManager` 是纯 ObjC 单例，在 `didFinishLaunching` 的开头、创建 bridge 之前，调用 `[LxDownloadManager shared]`
- `DownloadModule` 只做转发：`startObserving` 时订阅 manager，`stopObserving` 时取消订阅
- `handleEventsForBackgroundURLSession:` 把 completionHandler 交给 manager。在 `URLSessionDidFinishEventsForBackgroundURLSession:` 里，等事件日志落盘后，回到主线程调用 completionHandler

### 4.2 会话与网络策略

- `backgroundSessionConfigurationWithIdentifier:@"cn.toside.music.mobile.download"`
- `sessionSendsLaunchEvents = YES`，`discretionary = NO`，`HTTPMaximumConnectionsPerHost = 3`。这只是兜底上限，实际并发由 JS 控制
- **蜂窝和低数据模式按单个请求控制**：
  - 会话级设 `allowsCellularAccess = YES`、`allowsConstrainedNetworkAccess = YES`，相当于全部放行
  - 每个任务的 `NSMutableURLRequest` 再设 `allowsCellularAccess = setting`、`allowsConstrainedNetworkAccess = setting`
  - 依据：任务由 `NSURLRequest` 创建时，请求自身的属性覆盖会话配置，会话放行后由请求收紧。所以设置一改，新任务就按新值走，已在跑的任务不受影响
  - **需实证**：后台会话是否遵守请求级设置。列为 P1a 验收项（§14）。如果证伪，就退回「下次冷启动生效」方案，设置页如实标注
- `NSURLSessionDownloadTask` 的 `taskDescription` 存 `taskId`；启动时用 `getAllTasksWithCompletionHandler:` 重新挂接
- manager 在内存中维护 `jsCancelled: Set<taskId>`，记下 JS 主动发起 cancel 或 pause 的任务，用来区分系统取消（§4.4）

### 4.3 开始与完成判定

- 后台会话的下载任务**不会**回调 `didReceiveResponse`。`start` 事件只能在**首个** `didWriteData` 时发出，而且发之前必须检查 `task.response.statusCode`：
  - 2xx：发 `start`，之后每 500ms 节流发一次 `progress`
  - 非 2xx：不发 `start` 和 `progress`，只在内存中标记该任务。否则 JS 会在 403 错误页上把 `tryNum` 清零，刷新链接就会无限循环
- `didFinishDownloadingToURL:`：
  - 再检查一次 `statusCode`。**只有 2xx 才 move**，并记录 `complete`
  - 其他状态码不 move，记录 `error`，code 为 `HTTP_<status>`
  - move 同步执行；目标已存在时先删除再 move
  - move 后设置 `NSURLIsExcludedFromBackupKey = YES`，并用 `getResourceValue:` 读回校验

### 4.4 `didCompleteWithError:` 分类

| 条件                                                                                                  | 记录                 | 说明                                                                                  |
| ----------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `error == nil`                                                                                      | 不处理               | 已在 §4.3 处理                                                                       |
| `NSURLErrorCancelled` 且 `taskId ∈ jsCancelled`                                                  | `CANCELLED`        | JS 主动 cancel 或 pause。pause 时 resumeData 已由`cancelByProducingResumeData` 交回 |
| `NSURLErrorCancelled` 且 `NSURLErrorBackgroundTaskCancelledReasonKey == UserForceQuitApplication` | `FORCE_QUIT`       | 用户强退。若 userInfo 带`NSURLSessionDownloadTaskResumeDataKey` 就写盘              |
| `NSURLErrorCancelled` 且 reason 为 `BackgroundUpdatesDisabled` / `InsufficientSystemResources`  | `SYSTEM_CANCELLED` | 系统取消，同样保存 resumeData                                                         |
| 其他错误                                                                                              | 映射为 §8 错误码    | 有 resumeData 就写盘，**一定记录 `error`** 并带 `hasResumeData`             |

resumeData 写到 `Library/Application Support/lx-download/resume/<taskId>.data`。

### 4.5 内部文件位置

| 候选                                                   | 问题                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `Caches/`                                            | 存储紧张时会被系统清理                                                                       |
| `Documents/`                                         | 在「文件」App 中可见，用户可能误删；还会进 iCloud 备份                                       |
| **`Library/Application Support/lx-download/`** | 不会被清理，「文件」App 看不到。首次使用时创建，整个目录设置`NSURLIsExcludedFromBackupKey` |

### 4.6 事件日志与 ack

- manager 无法判断 JS 是否已经注册了监听。`RCTEventEmitter` 在没有监听者时会直接丢弃事件，所以不能只在「JS 不在」时才写缓冲
- `complete` 和 `error` **一律**追加写入 `lx-download/events.jsonl`，每条带递增的 `seq`，同时实时 emit
- JS 处理事件的顺序：

  1. 更新内存状态
  2. 等 `await persist.flush()` 写入成功
  3. 再调 `ack(seq)`

  - 不能在 100ms 节流窗口内提前 ack。否则进程一旦被杀，事件和状态会同时丢失
- `ack(lastSeq)` 截掉日志中 `seq <= lastSeq` 的条目。JS 按 seq 升序处理，ack 单调递增
- `drainEvents()` 返回所有未 ack 的事件。JS 按 `taskId + type + seq` 幂等处理：已是 `completed` 的任务再收到 `complete`，或者 seq 已处理过，就跳过，但仍然 ack
- `start` 和 `progress` 只实时 emit，不写日志

### 4.7 续传边界

- resumeData 绑定原始 URL，只在 URL 不变时续传
- 刷新链接后删除 resumeData，用新 URL 从 0 开始（单曲 3~40MB，可以接受）
- 416：删除 resumeData 和目标文件，从 0 开始
- resumeData 依赖系统 `tmp/` 里的临时文件，可能已被清理。`downloadTaskWithResumeData:` 失败或很快报错时，自动改用 `start` 从 0 开始
- 跨 URL 的 Range 续传放到 P3

### 4.8 JS 接口

```ts
interface DownloadModule {
  configure(opts: { maxConcurrent: number }): Promise<void>
  start(task: {
    taskId: string, url: string, targetPath: string,
    allowsCellular: boolean, headers?: Record<string, string>,
  }): Promise<void>
  pause(taskId: string): Promise<{ hasResumeData: boolean }>
  resume(taskId: string, allowsCellular: boolean): Promise<boolean>  // 无 resumeData 返回 false
  cancel(taskId: string, removeResumeData: boolean): Promise<void>
  removeResumeData(taskId: string): Promise<void>
  getActiveTasks(): Promise<Array<{ taskId: string, state: 'running' | 'suspended', downloaded: number, total: number }>>
  drainEvents(): Promise<Array<{ seq: number, type: 'complete' | 'error', data: object }>>
  ack(lastSeq: number): Promise<void>
}
```

注意：用 resumeData 恢复时无法换 request。只要 `allowsCellular` 和原任务不同，就改为从 0 开始 `start`。

### 4.9 事件定义 `LxDownloadEvent`

| type           | data                                                           | 写日志 |
| -------------- | -------------------------------------------------------------- | ------ |
| `start`      | `{ taskId, total }`：首个 `didWriteData` 且状态为 2xx      | 否     |
| `progress`   | `{ taskId, downloaded, total }`：节流 500ms，仅 2xx          | 否     |
| `complete`   | `{ seq, taskId, path, size }`：已 move，已排除备份           | 是     |
| `error`      | `{ seq, taskId, code, httpStatus?, message, hasResumeData }` | 是     |
| `bgFinished` | `{}`                                                         | 否     |

---

## 5. 数据模型

### 5.1 `LX.Download.ListItem`

```ts
interface ListItem {
  id: string                 // `${musicInfo.id}_${quality}_${ext}`，与桌面版 utils.ts:75 一致
  isComplate: boolean
  status: 'run' | 'waiting' | 'pause' | 'error' | 'completed'
  statusText: string
  downloaded: number         // 仅内存
  total: number              // 仅内存
  progress: number           // 仅内存
  speed: string              // 仅内存
  metadata: {
    musicInfo: LX.Music.MusicInfoOnline
    url: string | null
    quality: LX.Quality
    ext: FileExt
    fileName: string
    filePath: string         // 相对 Documents
    listId?: string          // 新增
  }
}
```

`errorCode` 和 `tryNum` 只存在内存中。

### 5.2 `downloadIndex`

- `Map<songId, { quality, relPath }>`，同一首歌有多份时保留最高音质
- 每个已完成任务**同时**用 `metadata.musicInfo.id` 和 `metadata.musicInfo.meta.toggleMusicInfo?.id` 建索引，这样不论播放器先用哪个 id 查，都能命中
- 只收录 `completed` 且对账通过的任务；由下载列表派生，不单独持久化
- `lookupLocal(musicInfo)`：依次查原 id 和 toggle id，命中后 `stat` 确认文件存在
- 这是**有意偏离桌面版**的地方：桌面版只在下载列表里播放才走本地；移动端离线是刚需

### 5.3 持久化

- `@download_list__meta` 存 `{ ids, version }`，`@download_list__<n>` 每 100 条一片
- 只写 `status`、`statusText`、`isComplate`、`metadata`
- 100ms 合并写入，与桌面版 `store/download/action.ts:26-30` 一致。`flush()` 立即写入并返回 Promise，供 ack 使用
- 冷启动：`run` / `waiting` 改为 `pause`，与桌面版一致

---

## 6. 存储布局

```
Documents/Download/[<列表名>/]歌名 - 歌手.flac                 ← 用户可见
Documents/Download/[<列表名>/]歌名 - 歌手.lrc
Library/Application Support/lx-download/resume/<taskId>.data   ← 用户不可见
Library/Application Support/lx-download/events.jsonl
```

- 只存相对路径，读取时再拼接，以应对重签后容器路径变化
- 文件名生成，与桌面版 `worker/download/utils.ts:94` 一致：
  - 歌手名先经 `clipNameLength`：超过 80 字符时，按 `、` 分隔保留前若干个
  - 按 `download.fileName` 模板拼出名字，再经 `clipFileNameLength`：超过 150 **字符**时截断
  - 加上扩展名，最后经 `filterFileName`
  - 不加重名后缀
- 列表子目录与桌面版 `store/download/utils.ts:10-24` 一致：默认列表和我的收藏用 i18n 名，自建列表从 `userList` 取名，经 `filterFileName` 和 `clipFileNameLength` 处理；取不到名字时归入默认列表名
- `skipExistFile`：
  - 开启时，启动前目标文件已存在且大于 100 字节（与桌面版 `download.ts:77` 一致），任务**置为 `completed`**
  - 这里有意偏离桌面版（桌面版置 `error` 并报 `download_status_error_check_path_exist`）：移动端重装后文件仍在，置错会逼用户手动处理
  - 关闭时，move 前先删已有文件，相当于覆盖

---

## 7. 核心流程

### 7.1 创建任务

1. 单曲用 `DownloadModal`，多选或全选用 `DownloadMultipleModal`
2. 过滤 `source == 'local'` → `getMusicType` → `createDownloadInfo` → 按 `id` 去重，重复的提示用户
   - `QUALITYS = ['flac24bit','flac','wav','ape','320k','192k','128k']`
   - 源不支持请求的音质时，改用该源 `qualityList` 的最后一项；然后沿 `QUALITYS` 往下找 `meta._qualitys` 里有的第一档；都没有就用 `128k`
3. 按 `list.addMusicLocationType` 插入 → 落盘 → `checkStartTask()`

### 7.2 调度

- `download.enable == false`，或运行中任务数不少于 `maxDownloadNum` 时返回；否则按顺序取 `waiting` 任务置为 `run`
- 没有链接时先 `getUrl()`，失败置为 `error`；拿到链接后状态已不是 `run` 就停止
- 然后 `buildSavePath` → `engine.start`
- App 在后台（放歌时 JS 仍在运行）创建的任务会被系统视为 discretionary，可能被大幅推迟（Apple 文档行为）。不做特殊处理；回到前台后 `getActiveTasks()` 会如实反映进度。列入风险和真机测试

### 7.3 取链接与刷新链接（桌面版 `store/download/action.ts:209-240`）

```
getUrl(info, isRefresh):
  meta.toggleMusicInfo 存在 → online.getMusicUrl({ musicInfo: toggleMusicInfo, quality, isRefresh, allowToggleSource: false })
  失败或不存在             → online.getMusicUrl({ musicInfo, quality, isRefresh, allowToggleSource: download.isUseOtherSource })

refreshUrl(info):
  statusText = 刷新链接中 → getUrl(info, true) → removeResumeData → engine.start(新 URL)
```

- 直接调用 `core/music/online.ts`，这里**不经过**本地优先，所以永远拿到网络链接
- 不预取，开始下载前才取链接

### 7.4 错误处理（与桌面版 `worker/download/download.ts` 对齐）

| 原生 code                             | 桌面版对应        | 处理                                                                                                       |
| ------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `WRITE_FAILED` / `NO_SPACE`       | `EPERM`         | 置`error`，不重试；`NO_SPACE` 时所有 `waiting` 改为 `pause`                                        |
| `HTTP_401/403/410`                  | 同                | `tryNum++`，超过 2 次置 `error`，否则 `refreshUrl`                                                   |
| `DNS`                               | `ENOTFOUND`     | 同上                                                                                                       |
| `HTTP_416`                          | `Resume failed` | 删除 resumeData 和文件后重下，`tryNum++`                                                                 |
| 其他 HTTP /`NETWORK` / `TIMEOUT`  | 其他              | `tryNum++`，超过 2 次置 `error`；否则 1 秒后重试（`download.ts:161`），有 resumeData 时先 `resume` |
| `FORCE_QUIT` / `SYSTEM_CANCELLED` | —                | 置`pause`，保留 resumeData，`statusText` 写明原因；不计入 `tryNum`                                   |
| `CANCELLED`                         | —                | 忽略（JS 自己发起的）                                                                                      |

`tryNum` 只在收到 `start` 事件时清零，而 `start` 只对 2xx 发出（§4.3）。

### 7.5 完成

1. 收到 `complete`，置 `completed`
2. 更新 `downloadIndex`
3. 开启了 `isDownloadLrc` 时 `saveLrc`
4. 从运行集移除
5. `await persist.flush()`，然后 `ack(seq)`
6. `checkStartTask()`

### 7.6 暂停、继续、删除

- 暂停：`engine.pause`。继续：改为 `waiting` 后进入 `checkStartTask()`，有 resumeData 时优先 `resume`
- 全部开始 / 全部暂停：只调用一次 `checkStartTask()`
- 删除任务：保留文件，从索引移除。删除任务和文件：同时删除音频、`.lrc` 和 resumeData

### 7.7 关闭下载功能

`download.enable` 改为 `false` 时：

- 调度器不再启动新任务，`run` 的任务全部 `pause`，已有任务保留，状态冻结
- 菜单和导航入口隐藏；本地优先播放照常生效
- 重新开启后不会自动恢复，需要手动「全部开始」，或由 `autoResume` 接管
- **这是有意偏离桌面版的地方**：桌面版关闭后只隐藏入口（`Menu.vue:6`、`NavBar.vue:73`），任务继续运行。移动端入口隐藏后，用户看不到还在消耗流量的任务，所以冻结它们

### 7.8 冷启动与回到前台

1. 读入持久化列表，`run` / `waiting` 改为 `pause`
2. `getActiveTasks()` 合并仍存活的原生任务，恢复为 `run`
3. `drainEvents()` 按 seq 幂等重放 → `flush` → `ack`。其中包括强退产生的 `FORCE_QUIT`
4. `reconcile()`：
   - `completed` 的任务逐个 `stat`，文件缺失就标 `FILE_MISSING` 并移出索引
   - `pause` 的任务若 resumeData 已丢失，不做处理，继续时会自动从 0 开始
5. 开启了 `download.autoResume` 时，把 `pause` 改回 `waiting`

---

## 8. 错误码

`URL_FAILED` · `HTTP_<status>` · `DNS` · `NETWORK` · `TIMEOUT` · `NO_SPACE` · `WRITE_FAILED` · `FILE_MISSING` · `FORCE_QUIT` · `SYSTEM_CANCELLED` · `CANCELLED`

文案沿用桌面版的 `download_status_error_*` key。三语新增：

- `download_status_error_no_space`
- `download_status_error_file_missing`
- `download_status_paused_force_quit`
- `download_status_paused_system`

---

## 9. 播放集成（本地优先）

**挂载点是 `src/core/player/player.ts:96` 的 `getMusicPlayUrl`，不是 `online.ts`。** 不放在 `online.ts` 的原因：

- 下载器的 `getUrl` 也调用 `online.getMusicUrl`。如果在那里返回本地路径，已下载的歌换音质重下时就会拿到 `file://`，而后台会话不支持 `file://`
- 播放器 `player.ts:102` 先用 `toggleMusicInfo` 取链接，失败后才用原歌曲；在 `online.ts` 里只能看到其中一个 id

做法：

- `getMusicPlayUrl` 开头判断：`!isRefresh`、不是下载列表项、也不是本地歌曲时，调用 `downloadIndex.lookupLocal(musicInfo)`。命中就直接返回 `file://` 绝对路径，不进入切源链路
- `isRefresh == true`（播放失败后重试）时跳过本地，回退在线，并触发一次对账，标记 `FILE_MISSING`
- 下载页内播放：走 `core/music/download.ts`，解开注释
- `playInfo.ts:141`：DOWNLOAD 分支返回下载列表
- 预加载：`preloadNextMusic.ts` 的 `doPreload` 拿到的 url 若是 `file://` 就直接返回，不做 `isCached` / `checkUrl`，也不 `isRefresh` 重取。前提是预加载走的取链接路径同样接入 `lookupLocal`：在 `doPreload` 开头先查一次
- 歌词优先读同名 `.lrc`；封面在 P1 走在线或缓存
- 列表不加「已下载」标记，与桌面版一致

---

## 10. UI

### 10.1 导航

现状：

- `NAV_MENUS` 被 `Vertical/DrawerNav.tsx:131`、`Horizontal/Aside.tsx:136` 共用
- `Vertical/Main.tsx:181-194` 的 `viewMap` / `indexMap` 和 PagerView 子页写死了 5 页
- `Horizontal/Main.tsx` 用 switch 切页

做法：

- `NAV_MENUS` 在 `constant.ts` 中按 `Platform.OS` 生成，iOS 在 `nav_love` 和 `nav_setting` 之间插入 `{ id: 'nav_download', icon: 'download-2' }`
  - 被注释的旧 id 是 `'download'`，改名为 `nav_download`，与其他项的命名一致
  - 声明成两个 `as const` 元组，取其并集，保证 `NAV_ID_Type` 包含 `'nav_download'`。Android 上该类型多一个值，但运行时永远不会出现
  - 依据先例 `Setting/Main.tsx:31`。不建 `navMenu.ios.ts`：按 `AGENTS.md:144` 的记录，只有 `.ios`/`.android` 而没有基础文件的模块会让 tsc 报 `Cannot find module`（如 `./toast`）。本地未实测
- `useNavMenus()` 按 `download.enable` 过滤
- `viewMap` / `indexMap` / PagerView 子页改为由该列表生成；`Horizontal/Main.tsx` 加 `nav_download` 分支
- **回退规则**，两处都要做：
  - 运行时关闭下载，而当前停在下载页 → 切到 `nav_search`
  - `dataInit.ts:34` 恢复 `viewPrevState` 时，id 不在当前可见菜单中（关闭了下载，或者是 Android）→ 用 `nav_search`
- 三语 json 补 `nav_download`
- 这是**无行为变化的重构**：必须过 `android-regression`，并手测双端两种布局，`homePageScroll` 开和关各测一遍

### 10.2 歌曲菜单

两个 ListMenu 加 `download` 项，显示条件为：

- `isDownloadSupported()`，即 `Platform.OS === 'ios'`
- `download.enable` 已开启
- 不是本地歌曲

有选中项时弹批量弹窗，否则弹单曲弹窗。

### 10.3 弹窗

- 单曲：列出 `meta.qualitys` 与 `qualityList[source]` 交集中的音质，附文件大小；不设默认，不记忆上次选择
- 批量：文案为「已选择 N 首歌曲，请选择要优先下载的音质」，选项 128K / 320K / FLAC / FLAC Hires；确认后逐首降级并退出多选

### 10.4 下载页

- Tab：全部 / 下载中（`run` + `waiting`）/ 已暂停 / 出错 / 已完成
- 每行显示歌名、歌手、音质、进度条，以及速度或状态；正在播放的任务高亮
- 长按菜单：播放、开始、暂停、删除、删除含文件；顶部：全部开始、全部暂停

### 10.5 设置 → 下载

| 设置                                   | 默认            | 说明                                                      |
| -------------------------------------- | --------------- | --------------------------------------------------------- |
| `download.enable`                    | `false`       | 首次开启时弹出合规提示（§12）；关闭的语义见 §7.7        |
| `download.maxDownloadNum`            | 3               | 可选 1~3                                                  |
| `download.fileName`                  | `歌名 - 歌手` | 已有                                                      |
| `download.isSavePathGroupByListName` | `false`       |                                                           |
| `download.skipExistFile`             | `true`        | 语义见 §6                                                |
| `download.isUseOtherSource`          | `false`       |                                                           |
| `download.isDownloadLrc`             | `false`       | 子项 LxLrc`true` / TLrc `false` / RLrc `false`      |
| `download.allowsCellular`            | `false`       | 同时管蜂窝和低数据模式；对新任务立即生效（§4.2，需实证） |
| `download.autoResume`                | `false`       |                                                           |
| 只读项                                 | —              | 保存位置说明、占用空间、清除全部下载                      |

前 8 项（`allowsCellular`、`autoResume` 除外）键名与桌面版 `defaultSetting.ts:112-129` 一致。不移植的桌面版项：`savePath`、`lrcFormat`、`isEmbedPic`、`isEmbedLyric*`（P2 再做）。

---

## 11. 平台隔离

- 新增的平台扩展文件只有 `core/download/engine.ios.ts`，配基础文件 `engine.ts`
- 导航和菜单开关用 `Platform.OS`
- Android 的导航、菜单、设置页与现状完全一致
- `AGENTS.md` 的平台扩展清单补 `engine.ios.ts`；`spec/structure.md` 登记 `core/download/`、`store/download/`

---

## 12. 规范、合规与门禁

- 新建 `openspec/changes/add-ios-download/`，包含：
  - `proposal.md`
  - `specs/`：新增 `ios-download`；修改 `ios-playback`、`ios-file-access`、`verification-gates`
  - `design.md`
  - `tasks.md`
- **合规条款**：
  - `spec/requirements.md:73` 原文保留，补一句：「下载功能把数据保存在用户本机、供其个人使用，不构成提供、代理或分发」
  - `:57` 的 24 小时清除是**协议对使用者的要求**，由用户自行遵守，App 不自动删除文件，因为这与离线播放的目标直接冲突
  - 首次开启下载时的合规提示原文写明这一要求，用户确认后才能开启。不要再写「24 小时清除约定仍然适用」之类会被理解为 App 会自动执行的表述
  - `:76` 不改
- 原生门禁：新增 `LxDownloadManager`、`DownloadModule`，修改 `AppDelegate.mm`
- 依赖门禁：P1 不新增依赖
- 提交纪律：`ios-verify.yml` 在 `dev-ios` 上不跑 lint，每轮改动后本地跑 `npm run lint`

---

## 13. 验证

| 层                            | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vitest                        | `QUALITYS` / `getMusicType`；去重；`clipNameLength` / `clipFileNameLength` / 子目录名；状态迁移；补位；§7.4 逐行，含 `FORCE_QUIT` 不计 tryNum；`tryNum` 只在 start 时清零；flush 之后才 ack；drain 幂等，含重复 seq；`enable = false` 时冻结；`lookupLocal` 原 id 和 toggle id 都能命中；导航回退规则                                                                                                                                                          |
| ciSelfTest`download_native` | 2xx 时文件存在，排除备份读回为 YES；403 时不发 start、不落文件、记`HTTP_403`；pause 后 resumeData 存在；cancel 记 `CANCELLED`；事件写入日志，ack 后截断                                                                                                                                                                                                                                                                                                                     |
| 真机                          | ① 20 首、并发 3 ② 不放歌锁屏 5 分钟 ③ 放歌时退后台并让队列补位，观察 discretionary 推迟 ④ 系统回收：用 Xcode 结束进程，模拟被系统终止，确认会被唤醒并记账 ⑤ 用户上划强退，再打开后任务为「已暂停」并能续传 ⑥ 链接过期后自动刷新 ⑦ 飞行模式下在「我的列表」播放已下载歌曲，包括切过源的歌 ⑧ 已下载 320k 后再下 FLAC，确认走网络 ⑨ 在「文件」App 删除文件后对账，并回退在线 ⑩ 「文件」App 看不到`lx-download` ⑪ 存储空间不足 ⑫ 蜂窝开关切换后，新任务立即遵守新设置 |
| 回归                          | `npm run lint` 退出码为 0；`npm test`；`npx tsc --noEmit` 不超过 21 个错误；Metro 双端打包；`android-regression`；35 项自测                                                                                                                                                                                                                                                                                                                                             |

未实际运行的项不得写成「通过」。

---

## 14. 分期

| 期  | 内容                                                                                                          | 估计        |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| P1a | openspec 四个工件；JS 全部；原生最小集：start / cancel / complete / error、2xx 校验、事件日志、请求级网络策略 | 约 2 周     |
| P1b | pause / resume、resumeData、后台唤醒、强退分类与恢复                                                          | 约 0.5~1 周 |
| P2  | TagLib 写元数据；补全 iOS 元数据读取；嵌入类设置                                                              | 约 1~1.5 周 |
| P3  | 跨 URL Range 续传；扫描去重；空间清理；下载完成后加入列表                                                     | 约 1 周     |

- P1a 验收包括：PagerView 动态子页（含 `homePageScroll` 关闭时的初始 index）、导航回退、请求级蜂窝设置实证（§4.2；证伪则退回冷启动生效）
- **§17 全部通过是启动 P1b 的硬性条件**，结论写入 openspec 的 design；任意一项被证伪就停下重估。P1b 不成时，P1a 的前台下载照样成立，`engine` 接口不变

---

## 15. 风险

| 风险                                      | 应对                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| 侧载包的后台会话被延迟或回收              | 不承诺完成时间；回前台时 drain 并对账                            |
| 后台补位的任务被系统推迟（discretionary） | 如实显示进度；回前台后自然推进；真机测试 ③                      |
| 用户强退导致传输被取消                    | 归为`FORCE_QUIT`，转为暂停并保留 resumeData；目标 3 已如实表述 |
| 链接寿命短                                | 不预取，失效就刷新，最多 2 次                                    |
| 错误页被当作进度                          | 2xx 校验之后才发 start / progress                                |
| 「文件」App 中的文件被改动                | 对账，并回退在线                                                 |
| 事件或状态丢失                            | 日志 + seq + 先 flush 再 ack + 幂等重放                          |
| 下载器拿到本地路径                        | 本地优先只挂在`getMusicPlayUrl`，下载器直接调 `online.ts`    |
| 导航重构影响 Android                      | 只做无行为变化的重构，加回归测试和手测                           |
| 请求级蜂窝设置不被后台会话遵守            | P1a 实证；证伪则退回冷启动生效                                   |
| 合规                                      | 默认关闭、首次开启有提示、无分享入口、条款写明责任归属           |

---

## 16. 已决问题

| 问题               | 结论                                             | 依据                     |
| ------------------ | ------------------------------------------------ | ------------------------ |
| 引擎               | 原生`NSURLSession`                             | §0                      |
| 原生结构           | Manager 单例 + RN 外壳                           | §4.1                    |
| 内部文件           | `Library/Application Support/`                 | §4.5                    |
| 事件可靠性         | 日志 + 先 flush 再 ack + 幂等                    | §4.6                    |
| start 判定         | 首个 2xx 的`didWriteData`                      | §4.3                    |
| 取消分类           | JS 发起 / 用户强退 / 系统取消，三类分开处理      | §4.4                    |
| 蜂窝开关           | 请求级，立即生效（需实证）                       | §4.2                    |
| 本地优先挂载点     | `player.ts` 的 `getMusicPlayUrl`，双 id 索引 | §9                      |
| 默认音质           | 不设默认；批量下载时降级                         | 桌面版                   |
| 已下载标记         | 不加                                             | 桌面版                   |
| 本地优先范围       | 全局                                             | 有意偏离桌面版，为了离线 |
| 整列表下载         | 多选 + 全选                                      | 桌面版                   |
| 刷新链接后续传     | 从 0 开始                                        | resumeData 绑定原 URL    |
| 预取               | 不做                                             | 桌面版                   |
| 导航平台差异       | `Platform.OS`，id 为 `nav_download`          | 先例 +`AGENTS.md:144`  |
| 文件名规则         | 字符截断 150 / 歌手 80，不加重名后缀             | 桌面版                   |
| `skipExistFile`  | 命中时置`completed`                            | §6，有意偏离            |
| 关闭功能           | 冻结任务                                         | §7.7，有意偏离          |
| 24 小时条款        | 由用户遵守，App 不自动删除                       | §12                     |
| `maxDownloadNum` | 3                                                | 桌面版                   |

---

## 17. P1b 启动前的实证（硬性门禁）

1. 侧载签名下，进程被系统终止后，后台会话能否重新挂接，`handleEventsForBackgroundURLSession:` 是否被调用
2. 后台唤醒时 JS 尚未加载，manager 能否独立完成 move 和写日志；回前台后 `drainEvents` 能否取到这些事件
3. 用户强退后再启动：是否收到 `NSURLErrorCancelled` 及 `UserForceQuitApplication` reason，userInfo 里有没有 resumeData，用它能否续传
4. resumeData 写盘后，冷启动用 `downloadTaskWithResumeData:` 能否续传；tmp 文件被清理后能否正确回退到从 0 开始
5. `Application Support/lx-download/` 目录和音频文件设置排除备份后，`getResourceValue:` 读回为 YES

---

## 附录 A：r2 修正清单

| #  | 上一版定稿                                | r2                                                                                                 |
| -- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1  | 本地优先放在`online.ts` `getMusicUrl` | 改挂`player.ts:96` `getMusicPlayUrl`，索引同时收原 id 和 toggle id；下载器直接调 `online.ts` |
| 2  | `CANCELLED` 一律忽略                    | 分成 JS 发起 / 用户强退 / 系统取消三类，后两类保存 resumeData 并置为 pause；改写目标 3             |
| 3  | 处理完事件就 ack                          | 先`await persist.flush()` 再 ack                                                                 |
| 4  | 「收到 2xx 响应头」时发 start             | 后台下载任务没有响应头回调，改为首个`didWriteData` 且状态为 2xx 时才发                           |
| 5  | 未考虑 discretionary                      | 写入 §7.2、风险表和真机测试 ③                                                                    |
| 6  | 蜂窝开关冷启动生效                        | 改为请求级控制、立即生效，同时覆盖低数据模式；需实证，失败可回退                                   |
| 7  | 「24 小时清除约定仍然适用」               | 明确由用户遵守，App 不自动删除，写进首次开启提示                                                   |
| 8  | 导航未处理持久化恢复                      | 补`viewPrevState` 回退和三语 `nav_download`                                                    |
| 9  | 预加载对`file://` 也做 `checkUrl`     | 跳过检查，不重取                                                                                   |
| 10 | 声称基于`node_modules` 核实             | 改为上游源码；本地没有`node_modules`                                                             |
| 11 | 按字节截断到 200，并加`(2)` 后缀        | 与桌面版一致：字符截断 150、歌手名 80，不加后缀；补列表子目录规则                                  |
| 12 | 关闭功能后冻结任务，但未标注偏离          | 标注为有意偏离并说明理由                                                                           |
| 13 | 把 tsc 规律称为「仓库实测」               | 改为依据`AGENTS.md:144` 的记录，本地未实测                                                       |

## 附录 B：桌面版代码索引

| 功能         | 位置                                                          |
| ------------ | ------------------------------------------------------------- |
| 类型         | `src/common/types/download_list.d.ts`                       |
| 引擎         | `src/common/utils/download/Downloader.ts`                   |
| 执行和重试   | `src/renderer/worker/download/download.ts`                  |
| 音质和文件名 | `src/renderer/worker/download/utils.ts`                     |
| 截断         | `src/common/utils/tools.ts:137-151`                         |
| 元数据和歌词 | `src/renderer/worker/download/common.ts`、`lrcTool.ts`    |
| 调度和取链接 | `src/renderer/store/download/action.ts`                     |
| 保存路径     | `src/renderer/store/download/utils.ts`                      |
| 持久化       | `src/main/worker/dbService/modules/download/`               |
| 播放联动     | `src/renderer/core/music/download.ts`                       |
| 下载页       | `src/renderer/views/Download/`                              |
| 弹窗         | `DownloadModal.vue`、`DownloadMultipleModal.vue`          |
| 设置页       | `src/renderer/views/Setting/components/SettingDownload.vue` |
| 默认设置     | `src/common/defaultSetting.ts:112-129`                      |
