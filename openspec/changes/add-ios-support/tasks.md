* [ ] 

## 1. Phase 0：能跑起来

- [ ] 1.1 `pod install` 通过（关 Flipper），`ios/Pods` 生成无 error
- [ ] 1.2 修 Bundle ID / 版本号 / Display Name / arm64，Xcode build 成功
- [ ] 1.3 UtilsModule iOS 骨架（`exitApp` 桩 + `getWindowSize`），`src/app.ts` 求值不再抛 TypeError（代码已写并经 CI 编译验证：`ios/LxMusicMobile/Modules/UtilsModule.{h,m}` 全 JS 面对齐；运行时待模拟器）
- [ ] 1.4 `fs.ios.ts` 适配层（除 gzip 外全部方法），27 个导出无 undefined，`stat`/`readDir` 合成 `mimeType`/`name`/`canRead`（代码已写并经 Metro 打包验证：RNFS 适配 27 导出；gzip 占位待 6.1、`selectFile` 占位待 6.5；运行时待模拟器）
- [ ] 1.5 字体入 bundle + `UIAppFonts`，首页图标无豆腐块（已挂载并经 CI 构建验证：`ios/LxMusicMobile/Fonts/icomoon.ttf` + `UIAppFonts`；图标渲染待模拟器）
- [ ] 1.6 门槛验证：模拟器启动到首页，四个 Tab 可切换，无红屏

## 2. Phase 1.0：验证基础设施

- [X] 2.1 给项目装测试框架（当前无任何测试载体），`npm test` 可执行
- [X] 2.2 Android 真机跑取证脚本，产出加密黄金基准 JSON（两种 AES mode + 非对齐明文 + 空 IV + 短 IV + RSA 双 padding 往返）（当前为 JDK 8 引导基准 `test/golden/gen.sh`，真机基准替换见桥计划停止条件 3）
- [ ] 2.3 收集社区脚本回归集（≥10 个，覆盖 6 大音源），写成可一键跑的加载→inited→搜索→取链接断言（骨架已建 `test/scripts-regression/`，脚本收集待执行环境）

## 3. Phase 1：加密核心（Rust V1）

- [ ] 3.1 `rust/lxcore` 工作区 + iOS staticlib 链接 + CI 编译步骤；`cargo build --target aarch64-apple-ios` 通过，哑函数经桥调通（不过则启用 design.md D2 退路）（交叉编译 + 链接均经 CI 通过，run 32714184216；经桥调通待交互式环境）
- [X] 3.2 `lxcore-crypto` 实现 9 个方法，逐条对齐 design.md 契约表
- [X] 3.3 黄金基准成为 `cargo test` 用例，100% 字节级通过
- [ ] 3.4 iOS `CryptoModule` 薄封装（含 4 个 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`），经桥复跑黄金基准逐条一致（代码已写并经 CI 编译+链接验证：`CryptoModule.{h,m}` 经 C ABI 调 `lx_*`；逐条一致待桥复跑）

## 4. Phase 1：沙箱（JSC）与 G1 闸门

- [ ] 4.1 UserApiModule：JSContext 创建 + console 注入，`preload.js:593` 的 `Preload finished.` 出现在 Xcode 日志（代码已写：`UserApiModule.{h,m}` 串行队列 + JSC；preload 以 bundle 资源入库，统一移动归 7.7；运行时验证待 Xcode 日志）
- [ ] 4.2 7 个 `__lx_native_call__*` 注入，逐个返回值与 Android 逐字节一致（代码已写：加密两注入复用 lxcore FFI；str2b64/b642buf/str2md5 按 Java 语义复刻，含符号字节与 `+`→空格；逐函数对照待 M）
- [ ] 4.3 `lx_setup` + `__lx_native__` 反向通道 + `set_timeout` 双向，社区脚本加载收到 `inited`（代码已写：callJS/sendAction/init 失败负载对齐 JsHandler；验证待 M）
- [ ] 4.4 门槛验证：导入社区自定义源显示"已加载"，搜索返回结果
- [ ] 4.5 G1：回归集在 iOS JSC 全量跑，产出通过率报告并按 design.md D6 判读；触发二期则另立 change

## 5. Phase 2：播放

- [ ] 5.1 track-player iOS 侧 build 通过，`setupPlayer` 不 reject
- [ ] 5.2 加 `iosCategory: 'playback'`，切后台仍出声（配置已写：setupPlayer + `UIBackgroundModes: audio`；后台出声待实测）
- [ ] 5.3 锁屏控制：歌名/封面显示，播放/暂停/上下曲可用
- [ ] 5.4 `updateNowPlayingTitles`，锁屏标题随歌词变化
- [ ] 5.5 缓存三方法降级（0/false），`preloadNextMusic` 不崩（降级代码已写：`isCached`/`getCacheSize`/`clearCache` 按 `isAndroid` 分支；运行时待验证）
- [ ] 5.6 CacheModule：设置页缓存大小显示与清理有效（代码已写：`CacheModule.{h,m}` 真实统计/清理 Caches，字符串字节数对齐 Android；设置页验证待 M）
- [ ] 5.7 门槛验证：完整听完一首在线歌，锁屏不中断可控

## 6. Phase 3：功能补齐

- [ ] 6.1 gzip 走 libz `windowBits=31`，`.lxmc` 与 Android 双向导入成功
- [ ] 6.2 `toast.ios.tsx`，各处 toast 正常显示
- [ ] 6.3 深链（AppDelegate + Info.plist），`lxmusic://` 触发对应行为
- [ ] 6.4 `CFBundleDocumentTypes`，从"文件"App 打开 `.lxmc` 触发导入
- [ ] 6.5 ChoosePath iOS 化（DocumentPicker），能选文件并导入歌单
- [ ] 6.6 通知权限 / 屏幕常亮 / 分享 / 设备名 / WiFi IP 逐项手测
- [ ] 6.7 数据同步与桌面版双向完成一次
- [ ] 6.8 `tools.ts` 平台分支，`isSupportedAutoTheme` 生效，深色模式跟随（平台分支已存在：iOS ≥13 判断 + Appearance 监听；深色跟随待真机验证）
- [ ] 6.9 门槛验证：主流程（搜索→播放→收藏→歌单管理→备份恢复→同步）全通

## 7. Phase 4：降级与打磨

- [ ] 7.1 桌面歌词整组隐藏 + `lyricDesktop.ios.ts` 桩，无死链无未捕获 reject（代码已写：22 导出安全桩 + `SETTING_SCREENS` 按平台过滤导航；设置页遍历待 M 验证）
- [ ] 7.2 本地音乐降级：扫描不崩，元数据显示文件名
- [ ] 7.3 应用内更新改为跳转 Release 页（代码已写：`version.ios.js` 版本检查逻辑不变，下载/安装改 `Linking.openURL` Release 页；更新弹窗路径待验证）
- [ ] 7.4 横屏 / iPad 布局：24 个 Horizontal tsx 不错位
- [X] 7.5 CI 新增 iOS unsigned build job 并通过（`.github/workflows/ios-verify.yml`，macos-15 / Xcode 16.4；首验 run 32705189097，门禁后归并为设备版构建 + IPA artifact，run 32707901201 双 SDK 均通过）
- [ ] 7.6 真机测试 ≥2 台（含 iOS 13/14 旧机），连续 30 分钟无崩溃，Instruments 无明显泄漏
- [ ] 7.7 `assets/script/user-api-preload.js` 移动后，Android release 构建回归一次
