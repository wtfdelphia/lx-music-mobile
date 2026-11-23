## ADDED Requirements

### Requirement: 外部文件夹只读访问

外部文件夹 SHALL 以 security-scoped bookmark 授权，仅做只读访问；原生层 SHALL 不提供写入或删除外部文件的方法；访问 SHALL 按来源引用计数持有，删除来源时释放。

#### Scenario: 路径越界
- **WHEN** 定位符拼接后的路径不在来源根目录之下
- **THEN** 拒绝访问并返回错误

### Requirement: 曲库内部数据目录

曲库索引 SHALL 存于 `Library/Application Support/lx-library/`（不可见、排除备份），封面缓存存于 `Library/Caches/lx-library/artwork/`（可被系统清理）。

#### Scenario: 封面缓存被清理
- **WHEN** 系统清理 Caches 后浏览曲库
- **THEN** 封面按需重新生成，曲库索引不受影响

### Requirement: 分范围的文件删除

曲库 SHALL 仅在用户确认后删除「下载」虚拟来源与沙箱内（Documents 子目录）本地来源的曲目文件；外部文件夹（bookmark 授权）SHALL 保持只读，SHALL NOT 提供删除。删除音频文件时 SHALL 同时删除同名 sidecar `.lrc`。

#### Scenario: 沙箱内文件删除
- **WHEN** 用户确认删除沙箱内本地来源曲目且文件存在
- **THEN** 音频与 sidecar `.lrc` 被删除，曲库行移除，排除表记录该相对路径，重扫不再入库

#### Scenario: 外部文件夹保持只读
- **WHEN** 用户请求删除外部文件夹来源的曲目文件
- **THEN** 请求被拒绝并提示不支持，文件不受影响
