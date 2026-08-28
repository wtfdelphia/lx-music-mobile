# 横屏用例失败根因：非 active 场景不重排版（2026-08-28）

关联任务：7.4 横屏 / iPad 布局。

## 现象

run 33144095295 的 `landscape` 用例失败：

```
window size did not flip to landscape (402x874)
rot={"sceneStates":["UIWindowScene(inactive)"],"geoErrors":[],
     "interfaceOrientationAfter2s":"landscape",
     "applied":["attemptRotation","requestGeometryUpdate(scenes=1)"],
     "ok":1,"error":null}
```

旋转请求全部成功：`geoErrors` 为空，`interfaceOrientation` 已变为
landscape。但 `windowSizeTools.getSize()` 仍是 402x874，宿主截图
`landscape.png` 为 1206x2622（402x874 @3x）竖屏画面。

## 根因

场景停在 `inactive`，RN 不给非 active 的场景重排版：`Dimensions` 不发变更
事件，`SizeView.onLayout` 不触发，窗口尺寸不更新，画面也不转。

场景为何 inactive：`testDeeplink` 在 +79.55s 调
`Linking.openURL('lxmusic://player/pause')`（`openurl-native.log` 时间戳
1787895995123），走 SpringBoard 往返；`appStates` 在 +81.2s 转 inactive
后再未回 active。

原本应由后台阶段末尾的唤回 launch 恢复，但该阶段在 `bg-ready` TIMEOUT 时
`exit 0` 早退（`bg-phase.log` 仅一行 `bg-ready marker: TIMEOUT`），
第 314 行的 `simctl launch` 从未执行。而 `bg-ready` 之所以 TIMEOUT，是
`background_play` 被秒/毫秒单位错配卡在位置断言上（见
[playback-clock-units.md](playback-clock-units.md)）。

先前一度归因于「深链导入确认弹窗常驻把场景压成 inactive」，该判断已证伪：
本轮弹窗只记录未呈现，且弹窗时间（+87.0s）比 inactive（+81.2s）晚 5.8s。

## 修复

宿主侧横屏阶段开头无条件 `simctl launch` 唤回一次，再置 rotate-phase 标记。
launch 对已在前台的应用是幂等激活，不重启进程，自测状态与报告不丢。
应用侧等 `AppState` 回 active（上限 30s）再驱动旋转，并把旋转时的
`appState` 带进失败文本。

## 不采用的方案

改断言 `interfaceOrientation` 而非窗口尺寸：本轮数据正好证明该字段在画面
未转时也报 landscape，用它当判据会得到假通过。7.4 的门槛是布局不错位，
窗口尺寸翻转是其必要条件，断言口径不放宽。

## 判读边界

修复经 YAML 语法与 lint 校验，**横屏是否实际翻转尚待下一轮 CI 实测**。
iPad 布局与真机横屏行为不在模拟器单机型可验范围，仍留手测。
