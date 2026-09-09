## Purpose

在 iOS 沙箱模型上复刻 `src/utils/fs.ts` 的全部存储能力，保证备份与同步数据在 Android/iOS 之间互通。

## ADDED Requirements

### Requirement: 适配层行为等价

`fs.ios.ts` SHALL 等价实现 `fs.ts` 的导出面（当前 29 个，含 `importOpenedFile`、`exportFile`）；`stat`/`readDir` 的结果 SHALL 合成 `name`、`mimeType`、`canRead` 字段。

#### Scenario: 全导出可用

- **WHEN** 逐个调用导出面清单（`ciSelfTest` `fs_exports` 断言清单为准）
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

### Requirement: 导出保存位置可选

iOS 上歌单与备份数据的导出 SHALL 经系统另存为面板（`UIDocumentPickerViewController` export 模式），用户 SHALL 能把 `.lxmc` 导出保存到「文件」App 的任意位置（含 iCloud 与第三方存储提供者），不得限于应用自身沙箱目录。导出内容格式（gzip + `playList_v2`/`playListPart_v2`）与 Android 侧逐字节一致。

#### Scenario: 导出备份到任意位置

- **WHEN** 用户在 iOS 上触发歌单或备份导出（设置页全量导出、歌单列表单表导出）
- **THEN** 系统另存为面板呈现，建议文件名为目标文件名（`lx_list.lxmc` / `lx_list_part_<歌单名>.lxmc`）；用户选定位置后文件拷贝完成并提示成功

#### Scenario: 另存面板嵌套弹窗竞态不被吞

- **WHEN** 导出在正在关闭的 RN Modal 内被触发（歌单列表菜单同拍退场）
- **THEN** 另存面板 SHALL 走与导入选择器同一竞态安全呈现管线（任务 9.4），最终呈现在稳定视图控制器上；预算耗尽显式报错

#### Scenario: 取消不构成失败

- **WHEN** 用户在另存为面板点取消
- **THEN** 应用不得弹失败提示，暂存打包产物（临时 JSON 与 `.lxmc`）SHALL 清理
