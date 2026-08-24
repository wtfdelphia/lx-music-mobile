## Purpose

让 App 在 iOS 上从无到有：解除启动即崩，提供与 Android 行为对齐的原生模块面，并保证布局与降级入口在 iOS 上闭合。

## ADDED Requirements

### Requirement: iOS 启动稳定

App 在 iOS 上启动时，系统 SHALL 完成全部模块求值并进入首页，不因原生模块缺失产生求值期异常。

#### Scenario: 冷启动到首页

- **WHEN** 在 iOS 模拟器或真机上冷启动 App
- **THEN** 不出现白屏/红屏，首页四个 Tab 可切换

### Requirement: 原生模块面完整

UtilsModule、CacheModule 在 iOS 上 SHALL 提供与 Android 语义一致的导出；`exitApp` 桩化为空实现；桌面歌词相关模块桩化。

#### Scenario: 窗口尺寸与事件

- **WHEN** JS 侧调用 `getWindowSize` 并旋转设备
- **THEN** 返回正确尺寸，且收到窗口变化事件

#### Scenario: 退出桩化

- **WHEN** 初始化失败弹窗后调用 `exitApp`
- **THEN** 不抛异常（iOS 不允许主动退出，空实现即可）

### Requirement: 布局安全区

状态栏高度的三处消费点（`StatusBar.tsx`、`SizeView.tsx`、`windowSizeTools.ts`）在 iOS 上 SHALL 使用安全区高度，不得取 0。

#### Scenario: 刘海屏布局

- **WHEN** 在有刘海/灵动岛的机型上显示首页
- **THEN** 内容不被状态栏或灵动岛遮挡，全局布局无上移

### Requirement: 降级入口闭合

桌面歌词、应用内更新、本地音乐标签写入在 iOS 上 SHALL 隐藏或降级，且不留死链与未捕获的 reject。

#### Scenario: 设置页无死链

- **WHEN** 在 iOS 上遍历设置页全部入口
- **THEN** 桌面歌词入口不可见，更新入口跳转 Release 页，无未捕获警告
