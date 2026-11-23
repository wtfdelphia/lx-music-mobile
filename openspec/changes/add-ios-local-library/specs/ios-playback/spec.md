## ADDED Requirements

### Requirement: 本地歌曲定位符解析

iOS 上本地歌曲播放地址 SHALL 经平台扩展 `music.ios.ts` 解析：`lxlib://` 定位符交由曲库解析器；含 `/Documents/` 的旧绝对路径 SHALL 按当前容器 rebase 后再判定存在性。

#### Scenario: 重签后旧本地歌曲
- **WHEN** 侧载重签导致容器路径变化，播放此前导入的 Documents 内本地歌曲
- **THEN** 经 rebase 找到文件并正常播放

#### Scenario: 外部文件夹歌曲后台连播
- **WHEN** 播放外部文件夹来源的歌曲并锁屏
- **THEN** 来源授权在播放期间保持，连续播放不因访问权限中断

#### Scenario: 远程曲目离线优先
- **WHEN** 远程曲目存在离线文件
- **THEN** 直接播放本地文件，不发起串流

### Requirement: 曲库串流地址不缓存

含认证参数的曲库串流 URL SHALL 不写入播放地址缓存，每次播放重新生成。

#### Scenario: 再次播放
- **WHEN** 再次播放同一远程曲目
- **THEN** 重新生成带新 salt 的地址
