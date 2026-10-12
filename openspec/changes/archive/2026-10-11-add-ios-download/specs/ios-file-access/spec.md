## ADDED Requirements

### Requirement: 下载文件目录约定

下载功能引入两类目录，语义与可见性 SHALL 区分：用户内容目录 `Documents/Download/` 存放音频与歌词文件，在「文件」App 中可见；内部状态目录 `Library/Application Support/lx-download/` 存放续传数据与事件日志，在「文件」App 中不可见，且整个目录与用户内容目录中的文件均设置 `NSURLIsExcludedFromBackupKey` 排除 iCloud 备份。

#### Scenario: 备份排除生效

- **WHEN** 下载完成后查询文件资源属性
- **THEN** `NSURLIsExcludedFromBackupKey` 读回为已排除

#### Scenario: 重签后路径仍有效

- **WHEN** 侧载包重签后沙箱容器路径变化，应用读取下载任务记录
- **THEN** 通过相对 `Documents` 的路径重新拼接，文件访问不失效
