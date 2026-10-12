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
