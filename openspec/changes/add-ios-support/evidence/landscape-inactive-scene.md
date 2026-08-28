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

## 第二轮：唤回 launch 不切前台（run 33157696254）

单位修复后后台阶段跑完全程（`bg-ready` READY、`bg-done` DONE），末尾的
唤回 launch 也执行了，但应用没回前台：

```
appStates:  -25.1s inactive → -25.1s active → +53.5s inactive → +79.7s background
background_play: host never returned app to foreground
landscape:  window size did not flip (402x874) appState=background
```

`bg-phase.log` 两次 launch 都返回同一 pid 63664。`landscape.png` 显示前台
是 iOS 设置页。

根因：`simctl launch` 对已在运行的挂起进程只返回原 pid，不做前台切换。
占着前台的 `com.apple.Preferences` 没被终掉，应用就一直留在 background。

修法：两处唤回前都先 `simctl terminate com.apple.Preferences`，再 launch。
横屏阶段保留这一步作兜底——后台阶段若在 TIMEOUT 处早退，设置页会一路占着
前台带进横屏阶段。`terminate` 对未运行的 bundle 报错无害。

## 第三轮：terminate 生效但应用仍不回前台（run 33160865120）

`terminate com.apple.Preferences` 确实执行了——横屏阶段的兜底 terminate 报
`found nothing to terminate`，证明后台阶段那次已把设置页终掉。但应用还是
没回前台：

```
appStates:  -25.0s inactive → -25.0s active → +77.7s inactive → +107.8s background
background_play: host never returned app to foreground
             (states=inactive,active,inactive,background current=background)
```

`bg-phase.log` 中 launch 返回 pid 51308，与首次启动同一进程。

所以「Preferences 占前台」只是表层：终掉它之后，`simctl launch` 对已挂起的
进程依旧不做前台切换。前台推进需要另找通道，尚未定位。

同轮套件未跑完：`finished: false`，21 个用例（应为 25），`durationMs`
809.6s 对用例耗时之和 393.2s。停在 `background_play` 之后，`landscape` 及
其后 4 个用例（`user_api_import` / `mainflow_local` / `user_api_regression`）
未执行。`background_play` 本身耗时 296.8s，含 180s 的唤回空等。

横屏用例本轮没有取到新数据，前一轮的 inactive 结论未被推进也未被推翻。

## 判读边界

`landscape` 在 run 33160865120 中未执行，7.4 无 CI 取证。宿主前台切换通道
待查。iPad 布局与真机横屏行为不在模拟器单机型可验范围，仍留手测。
