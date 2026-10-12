## ADDED Requirements

### Requirement: 曲库来源管理

iOS 上 SHALL 提供「本地曲库」入口与来源管理，支持本地文件夹、Subsonic/Navidrome、Jellyfin、Emby 四类来源的添加、编辑、停用、删除与重新授权；来源凭据 SHALL 仅存于 Keychain。

#### Scenario: 添加外部文件夹来源
- **WHEN** 用户经系统文件夹选择器选中「文件」App 中沙箱外的目录
- **THEN** 保存该目录的 bookmark 与显示名，来源出现在列表且可立即扫描

#### Scenario: 选中沙箱内目录
- **WHEN** 选中的目录位于本 App 的 Documents 内
- **THEN** 以相对 Documents 路径记录，不生成 bookmark

#### Scenario: 删除来源
- **WHEN** 用户删除一个来源
- **THEN** 其曲目、封面缓存与凭据一并清除；LX 列表中引用该来源的歌曲按用户选择移除或保留

### Requirement: 文件夹授权失效与重新关联

bookmark 解析失败时来源 SHALL 标为需重新授权；重新关联 SHALL 仅替换授权，不改变曲目定位符。

#### Scenario: 重签后授权失效
- **WHEN** 冷启动解析 bookmark 失败
- **THEN** 来源状态为 `needs_reauth`，播放其曲目提示重新授权，不得删除曲目

#### Scenario: 重新关联恢复
- **WHEN** 用户对该来源重新选择同一目录
- **THEN** 已在 LX 列表中的该来源歌曲无需重新导入即可播放

### Requirement: 本地文件夹扫描

扫描 SHALL 默认递归、跳过隐藏文件与符号链接、在 NSFileCoordinator 下读取；仅导入 AVPlayer 可播放格式；SHALL 产出含导入、更新、移除、不支持、未下载、失败、不可读目录的报告。

#### Scenario: 不支持的格式
- **WHEN** 目录中存在 ogg/opus/ape/wma 等文件
- **THEN** 不入库，计入报告「不支持」并给出文件清单

#### Scenario: iCloud 未下载文件
- **WHEN** 文件处于 iCloud 未下载状态
- **THEN** 不入库、不触发下载，计入报告「未下载」

#### Scenario: 增量扫描
- **WHEN** 文件大小与修改时间均未变化
- **THEN** 跳过元数据读取，保留原记录

#### Scenario: 删除保护
- **WHEN** 某子目录读取失败，或本次未发现任何支持文件而库中原有曲目
- **THEN** 不删除受影响曲目，报告中给出警告

#### Scenario: 取消扫描
- **WHEN** 用户取消进行中的扫描
- **THEN** 已写入的曲目保留，不执行缺失清理

### Requirement: 媒体元数据

元数据 SHALL 通过 AVFoundation 按 `AVMetadataIdentifier` 精确映射读取标题、艺人、专辑、专辑艺人、音轨号、碟号、年份、流派、时长、码率、封面、内嵌歌词；缺失时标题 SHALL 降级为文件名。

#### Scenario: 无标签文件
- **WHEN** 文件不含任何标签
- **THEN** 以去扩展名的文件名为标题入库，时长仍取自媒体时长

#### Scenario: 封面缓存
- **WHEN** 曲目含内嵌封面
- **THEN** 缩放至最长边 600px 缓存于 Caches，同图去重；缓存被系统清理后按需重建

### Requirement: 浏览与搜索

曲库 SHALL 提供歌曲、专辑、艺人视图与来源筛选、关键词搜索、排序；列表 SHALL 分页加载。

#### Scenario: 中文搜索
- **WHEN** 关键词全部为 CJK 字符
- **THEN** 在标题、艺人、专辑中做子串匹配并返回结果

#### Scenario: 专辑播放顺序
- **WHEN** 在专辑详情点击「播放全部」
- **THEN** 按碟号、音轨号顺序进入播放队列

### Requirement: 曲库歌曲接入 LX

曲库歌曲 SHALL 以 `source: 'local'` 的 `MusicInfoLocal` 表示，`id` 与 `meta.filePath` 为定位符 `lxlib://<sourceId>/<itemKey>`；SHALL 可加入任意 LX 列表，「喜欢」SHALL 写入 LX「我的收藏」。

#### Scenario: 重复加入去重
- **WHEN** 同一曲目被再次加入同一列表
- **THEN** 列表中不出现重复项

#### Scenario: 非法定位符
- **WHEN** 定位符解码后含 `..` 或空段
- **THEN** 解析失败，不访问任何文件

### Requirement: 远程来源同步与串流

Subsonic/Navidrome 与 Jellyfin/Emby 来源 SHALL 支持连接测试、分页全量同步与缺失比对、按设置码率串流、封面与服务端歌词；网络中断的同步 SHALL 不执行缺失清理。

#### Scenario: Subsonic 认证
- **WHEN** 发起任一 Subsonic 请求
- **THEN** 使用每次新生成的 salt 与 `md5(password+salt)` token，日志中认证参数打码

#### Scenario: 蜂窝网络禁止串流
- **WHEN** 处于蜂窝网络且 `library.allowCellularStream` 关闭，播放无离线文件的远程曲目
- **THEN** 提示已禁止并不回落在线源

#### Scenario: 播放上报
- **WHEN** 远程曲目播放超过 50% 或 4 分钟且 `library.scrobble` 开启
- **THEN** 向服务端提交一次播放记录

### Requirement: 文本导入歌单

SHALL 支持粘贴「歌名 - 歌手」多行文本，与曲库匹配后预览「已匹配 / 多候选 / 未匹配」，确认后生成 LX 自建列表。

#### Scenario: 多候选
- **WHEN** 一行文本匹配到多首曲目
- **THEN** 由用户选择后再加入列表

### Requirement: 歌词手动搜索

曲库曲目在 iOS 上 SHALL 支持歌词手动搜索：用 LX 现有在线源按「歌名 + 歌手」检索，候选呈现歌名、歌手、专辑、时长差，用户选中后获取该在线曲目的歌词并写入 LX 歌词缓存；后续获取 SHALL 命中该缓存。

#### Scenario: 选中候选应用歌词
- **WHEN** 用户在搜索候选中选中一条结果
- **THEN** 获取其歌词并写入 LX 歌词缓存，当前曲目的歌词展示生效

### Requirement: 已下载曲目自动关联

LX 下载任务（`kind: 'online'`）完成后，曲目 SHALL 自动关联进曲库「下载」虚拟来源，可浏览、搜索、入列，无需手动导入；关联 SHALL 跟随任务生命周期；`kind: 'library'` 任务 SHALL 不进入自动关联。

#### Scenario: 完成即入库
- **WHEN** 下载任务变为完成态（含文件已存在的快路径与孤儿认领路径）
- **THEN** 对应曲目出现在曲库中，无需手动导入

#### Scenario: 同歌多音质去重
- **WHEN** 同一首歌存在多个不同音质的完成任务
- **THEN** 只关联最高音质的一首；更高音质任务完成后替换原关联

#### Scenario: 删任务移除关联
- **WHEN** 用户删除下载任务或清空已完成（无论是否删除文件）
- **THEN** 对应曲目的关联被移除；曲库 SHALL 不删除文件本身

#### Scenario: 跳过 library 任务
- **WHEN** 远程曲库曲目的离线下载任务（`kind: 'library'`）完成
- **THEN** 不触发自动关联；该曲目保持为带离线标记的远程曲目

### Requirement: 净室实现

本能力的实现 SHALL 不复制、不翻译 LynMusic 的源码、资源与文案；图标与样式 SHALL 仅使用 LX 现有资源。

#### Scenario: PR 声明
- **WHEN** 提交本能力相关 PR
- **THEN** PR 描述包含未参考 LynMusic 源码的声明
