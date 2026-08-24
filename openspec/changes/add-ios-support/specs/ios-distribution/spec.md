## Purpose

保证 iOS 侧代码不因无人维护而再次腐化，并将分发严格限定在合规的内部路径。

## ADDED Requirements

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
