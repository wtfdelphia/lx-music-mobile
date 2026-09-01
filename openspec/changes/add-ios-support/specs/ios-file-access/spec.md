## Purpose

在 iOS 沙箱模型上复刻 `src/utils/fs.ts` 的全部存储能力，保证备份与同步数据在 Android/iOS 之间互通。

## ADDED Requirements

### Requirement: 适配层行为等价

`fs.ios.ts` SHALL 等价实现 `fs.ts` 的 27 个导出；`stat`/`readDir` 的结果 SHALL 合成 `name`、`mimeType`、`canRead` 字段。

#### Scenario: 全导出可用

- **WHEN** 逐个调用 27 个导出
- **THEN** 无 undefined 返回，行为与 Android 侧语义一致

#### Scenario: 合成字段存在

- **WHEN** 调用 `stat` 或 `readDir`
- **THEN** 返回对象含 `name`、`mimeType`、`canRead` 且有值

### Requirement: gzip 跨端互通

iOS 产出的 gzip 数据 SHALL 为 gzip 格式（非 raw DEFLATE），与 Android 双向可读。

#### Scenario: 备份双向导入

- **WHEN** iOS 导出 `.lxmc` 备份并在 Android 导入，或反向
- **THEN** 导入成功，数据完整

### Requirement: 文件选择与导入

iOS 上 SHALL 通过 DocumentPicker 完成文件选择，替代 Android SAF； managed folder 相关 UI 隐藏。

#### Scenario: 选择文件导入歌单

- **WHEN** 在 iOS 上通过选择器选中一个歌单文件
- **THEN** 文件拷贝进沙箱并完成导入

#### Scenario: 嵌套弹窗关闭竞态不吞选择器

- **WHEN** 文件选择在正在关闭的 RN Modal 内被触发（自定义源导入下拉、歌单列表菜单等）
- **THEN** 选择器 SHALL 最终呈现在稳定的视图控制器上；无法呈现时 SHALL 显式报错，不得静默挂起
