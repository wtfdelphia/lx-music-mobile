## Purpose

在 iOS 上执行自定义源脚本，复刻 Android 侧注入契约，并以脚本回归闸门控制引擎差异风险。

## ADDED Requirements

### Requirement: 沙箱执行契约

iOS 沙箱 SHALL 原样加载 `user-api-preload.js`，注入 7 个 `__lx_native_call__*` 函数与 console，支持 `lx_setup`、`__lx_native__` 反向通道与 `set_timeout`。

#### Scenario: 脚本加载完成

- **WHEN** 加载一个自定义源脚本
- **THEN** preload 完成（日志可见 `Preload finished.`），收到 `inited` 事件

### Requirement: 注入函数行为一致

每个注入函数的返回值 SHALL 与 Android 侧逐字节一致。

#### Scenario: 逐函数对照

- **WHEN** 以相同输入逐个调用 7 个注入函数
- **THEN** 返回值与 Android 对照结果字节级一致

### Requirement: 脚本兼容性闸门

沙箱验收前 SHALL 运行覆盖 6 大音源、不少于 10 个社区脚本的回归集，并留通过率报告；核心音源系统性失败时 SHALL 触发引擎方案复评而非带病放行。

#### Scenario: 闸门通过

- **WHEN** 回归集中核心音源脚本全部可用
- **THEN** 沙箱验收通过，个别失败脚本记录并按脚本级 shim 处理

#### Scenario: 闸门失败

- **WHEN** 某核心音源在回归中系统性失败且 shim 不可行
- **THEN** 记录判读结论，触发后续引擎统一评估（另立变更）
