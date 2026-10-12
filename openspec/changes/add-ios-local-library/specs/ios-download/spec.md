## ADDED Requirements

### Requirement: 曲库离线下载任务

下载引擎 SHALL 支持 `kind: 'library'` 任务：地址由曲库解析器按 `library.downloadQuality` 生成，刷新时重新签名且不走在线换源；保存至 `Documents/Download/Library/<艺人>/<专辑>/`；完成后回写曲库离线路径。已有持久化任务缺省 `kind` SHALL 视为 `online`。

#### Scenario: 旧任务兼容
- **WHEN** 读取升级前持久化的下载任务
- **THEN** 按 online 任务处理，行为不变

#### Scenario: 下载完成回写
- **WHEN** library 任务完成
- **THEN** 曲库记录离线路径，曲库列表显示离线标记，播放走本地文件

#### Scenario: 离线文件缺失
- **WHEN** 对账发现离线文件不存在
- **THEN** 清除曲库离线路径，播放回到串流
