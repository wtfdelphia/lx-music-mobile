# ios-distribution Specification

## Purpose
保证 iOS 侧代码不因无人维护而再次腐化：构建回归持续覆盖编译面，分发路径严格限定在源码自编译、TestFlight 内部测试与自签三条合规通道内，明文请求与本地网络权限的平台约束显式声明并持续断言。
## Requirements
### Requirement: 构建回归

CI SHALL 包含 iOS unsigned 编译回归 job，代码合入即验证可编译。

#### Scenario: 编译门禁

- **WHEN** 代码推送触发 CI
- **THEN** iOS job 完成 unsigned build，失败即阻断

### Requirement: 内部分发合规

分发 SHALL 仅限源码自编译、TestFlight 内部测试（≤100 人）与自签三种路径；不得使用 TestFlight 外部测试或提交 App Store。

#### Scenario: 发布检查

- **WHEN** 准备分发一个 iOS 构建
- **THEN** 分发方式属于上述三种之一，构建不携带任何上架意图的配置

### Requirement: ATS 明文请求放行

内置音源的搜索、榜单、取链与大量音频直链为明文 `http`，App Transport Security 的 `NSAllowsArbitraryLoads` SHALL 在最终构建中实际生效。`Info.plist` 的 `NSAppTransportSecurity` 中不得出现使 `NSAllowsArbitraryLoads` 被系统忽略的并存键（`NSAllowsLocalNetworking`、`NSAllowsArbitraryLoadsForMedia`、`NSAllowsArbitraryLoadsInWebContent` 及任何例外字典）。

#### Scenario: 明文请求不被本地策略拦截

- **WHEN** 应用发起明文 `http` 请求（原生 `NSURLSession` 或 RN fetch 任一通道）
- **THEN** 失败原因不得是 `NSURLErrorDomain` code `-1022`（App Transport Security 拦截）；冒烟自测的 `network_probe` SHALL 对 `http` 探针的原生侧错误码做 `-1022` 硬断言

### Requirement: 本地网络权限声明

数据同步经同一局域网内对桌面端同步服务的 TCP 连接（WebSocket）实现。iOS 14+ 对本地网络出站连接强制要求 `NSLocalNetworkUsageDescription`；缺失时系统不弹权限授权、连接静默失败且无错误文本可归因。`Info.plist` SHALL 声明 `NSLocalNetworkUsageDescription` 且文案说明用途为局域网内同步服务连接。

#### Scenario: 同步连接不被权限策略静默拦截

- **WHEN** 应用对局域网内主机地址（`http://<内网IP>:<端口>`）发起同步鉴权或 WebSocket 连接
- **THEN** 首次连接时系统弹出本地网络权限授权提示；授权后连接可达，失败原因不得是权限缺失导致的静默断连
