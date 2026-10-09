# P1b 启动前的实证记录

> 四项实证全部通过是启动 P1b 的硬性条件（设计文档 §17）。
> 任一项证伪即停下重估，不并行开工。
> 环境要求：侧载签名的真机（AltStore / SideStore 重签未签名 IPA）。
> 每项按「操作 → 观察 → 结论」记录，附时间、设备型号、系统版本。

## 实证 1：杀进程后后台会话重挂接

- 操作：
- 观察：
- 结论：**待实证**

要点：开始下载后立即上划杀进程，等待 1~2 分钟后重新打开，
确认 `handleEventsForBackgroundURLSession:` 被调用、
`getAllTasksWithCompletionHandler:` 能取回存活任务、
完成的任务经 `drainEvents` 对账后标记完成。

## 实证 2：后台唤醒时 manager 独立完成与记账

- 操作：
- 观察：
- 结论：**待实证**

要点：锁屏退后台（不放歌，App 被挂起），下载应由系统后台会话继续；
回到前台后事件日志含挂起期间的 `complete`/`error` 记录，
`drainEvents` 能取到且幂等处理正确。

## 实证 3：强退取消分类与 resumeData

- 操作：
- 观察：
- 结论：**待实证**

要点：下载中用户强退，重新打开后任务应为「已暂停」且文案为
「应用退出，下载已暂停」。同时逐项核对原生代码用字面量占位的键名：
`error.userInfo` 中取消原因键的真实名称、`NSURLSessionDownloadTaskResumeDataKey`
的真实名称、`UserForceQuitApplication` 的枚举值是否为 2。
若与占位不符，修正 `LxDownloadManager.m` 后重测。

## 实证 4：备份排除读回校验

- 操作：
- 观察：
- 结论：**待实证**

要点：下载完成后经 Xcode Devices 或 `ls -l@` 检查
`Documents/Download/` 音频文件与 `Library/Application Support/lx-download/`
目录的 `NSURLIsExcludedFromBackupKey` 为 YES；
iCloud 备份体积不随下载量增长。

## 附带实证（§4.2 蜂窝开关）

- 操作：
- 观察：
- 结论：**待实证**

要点：请求级 `allowsCellularAccess` 在后台会话下是否生效。
证伪则回退「下次冷启动生效」并在设置页标注。

---

- 设备 / 系统版本：
- 侧载方式：
- 实证人：
- 日期：
