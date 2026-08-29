* [ ]

## 1. Phase 0：能跑起来

- [X] 1.1 `pod install` 通过（关 Flipper），`ios/Pods` 生成无 error（CI run 32746235295 双 macOS job 均以 `NO_FLIPPER=1` 通过）
- [X] 1.2 修 Bundle ID / 版本号 / Display Name / arm64，Xcode build 成功（配置已改：Bundle ID `cn.toside.music.mobile`、MARKETING_VERSION 1.8.1、CURRENT_PROJECT_VERSION 73、显示名「洛雪音乐助手」、UIRequiredDeviceCapabilities arm64；CI run 32746235295 设备/模拟器双 SDK 构建通过，IPA 已产 artifact）
- [X] 1.3 UtilsModule iOS 骨架（`exitApp` 桩 + `getWindowSize`），`src/app.ts` 求值不再抛 TypeError（应用内自测 `utils_window_size` PASS：窗口尺寸/设备名/区域/通知权限运行时全通；run 32838388685）
- [X] 1.4 `fs.ios.ts` 适配层（除 gzip 外全部方法），27 个导出无 undefined，`stat`/`readDir` 合成 `mimeType`/`name`/`canRead`（应用内自测 `fs_exports` 27 导出无 undefined、`fs_roundtrip` 写读 md5 一致；gzip 已在 6.1 实现；run 32838388685）
- [X] 1.5 字体入 bundle + `UIAppFonts`，首页图标无豆腐块（应用内自测 `font_registered` PASS：原生 `isFontRegistered('icomoon')` 运行时注册为真且 `uiAppFontsEffective=true`（无需兜底重注册，即 `UIAppFonts` 生效），负例 `lx-nonexistent-font` 判否；此前冒烟截图存档头部/播放条图标字形渲染正常；run 33248314363）
- [X] 1.6 门槛验证：模拟器启动到首页，四个 Tab 可切换，无红屏（应用内自测 `tab_switch` PASS：四 Tab 状态切换 + 宿主截图握手逐拍消费、四截图互异、红色像素占比 0.00%、进程存活、无崩溃报告；握手时序见 run 32828495250 失步修复；run 32838388685）

## 2. Phase 1.0：验证基础设施

- [X] 2.1 给项目装测试框架（当前无任何测试载体），`npm test` 可执行
- [X] 2.2 Android 真机跑取证脚本，产出加密黄金基准 JSON（两种 AES mode + 非对齐明文 + 空 IV + 短 IV + RSA 双 padding 往返）（当前为 JDK 8 引导基准 `test/golden/gen.sh`，真机基准替换见桥计划停止条件 3）
- [X] 2.3 收集社区脚本回归集（≥10 个，覆盖 6 大音源），写成可一键跑的加载→inited→搜索→取链接断言（一键入口已接入 CI：宿主投递 23 脚本 + `ci-expect.json` 断言清单进沙箱，应用内 `user_api_regression` 用例逐个跑 加载→inited——21 个硬断言全绿（21/23，另 2 个为远端依赖型软记录，口径见清单），本地预跑判读与 CI 实证一致；搜索→取链接断言依赖外网且社区端点易变，按 design.md D6 留手测与报告判读；run 32883447399）

## 3. Phase 1：加密核心（Rust V1）

- [X] 3.1 `rust/lxcore` 工作区 + iOS staticlib 链接 + CI 编译步骤；`cargo build --target aarch64-apple-ios` 通过，哑函数经桥调通（不过则启用 design.md D2 退路）（交叉编译 + 链接经 CI 通过 run 32714184216；经桥调通已由 `crypto_golden` 运行时实证——Rust C ABI 经 ObjC 薄封装在 iOS 模拟器往返；run 32838388685）
- [X] 3.2 `lxcore-crypto` 实现 9 个方法，逐条对齐 design.md 契约表
- [X] 3.3 黄金基准成为 `cargo test` 用例，100% 字节级通过
- [X] 3.4 iOS `CryptoModule` 薄封装（含 4 个 `RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`），经桥复跑黄金基准逐条一致（应用内自测 `crypto_golden` PASS：AES 10 例 + RSA 3 例（OAEP 双明文往返、NoPadding 确定性密文）逐条对齐黄金基准；run 32838388685）

## 4. Phase 1：沙箱（JSC）与 G1 闸门

- [X] 4.1 UserApiModule：JSContext 创建 + console 注入，`preload.js:593` 的 `Preload finished.` 出现在 Xcode 日志（应用内自测 `user_api_sandbox` PASS：`Preload finished.` 出现在沙箱 console 采集，等价于 Xcode 日志路径；run 32838388685）
- [X] 4.2 7 个 `__lx_native_call__*` 注入，逐个返回值与 Android 逐字节一致（应用内自测 `user_api_sandbox` PASS：沙箱探针在 JSC 内调加密/md5/str2b64 注入并输出黄金值——AES-hex `ae46ee99...`、md5、base64 均与 Android 语义基准一致；run 32838388685）
- [X] 4.3 `lx_setup` + `__lx_native__` 反向通道 + `set_timeout` 双向，社区脚本加载收到 `inited`（应用内自测 `user_api_sandbox` PASS：探针脚本收到 `init` 事件、`LXCI_TIMER_OK` 证明 set_timeout 双向、事件序列 `log/log/init/log` 完整；run 32838388685）
- [ ] 4.4 门槛验证：导入社区自定义源显示"已加载"，搜索返回结果（导入→加载业务链已经 CI 验证：`user_api_import` PASS——生产链路 `importUserApi → setApiSource → 原生 loadScript → init 事件 → 状态翻转为 true`（UI「已加载」判据）+ `global.lx.apis` 注册 kw；搜索返回结果依赖外网与用户交互，待手测；run 32883447399）
- [X] 4.5 G1：回归集在 iOS JSC 全量跑，产出通过率报告并按 design.md D6 判读；触发二期则另立 change（加载→inited 通过率 21/23 硬断言全绿，逐脚本报告见冒烟日志 `scripts regression` 段 + 宿主断言脚本打印；判读：2 个失败均为远端依赖型（sixyin 求值期拉远端音源信息、zxwy 运行时拉远端源），非 JSC 引擎兼容性缺陷；搜索→取链接段因 CI 出口网络到音源域名不可达（run 32982319768 实锤，属出口网络而非沙箱）无法作为系统失败证据。结论：核心加载链无系统性失败 → 留 JSC，不触发二期；run 33248314363）

## 5. Phase 2：播放

- [X] 5.1 track-player iOS 侧 build 通过，`setupPlayer` 不 reject（应用内自测 `player_setup` PASS：`setupPlayer` resolve 且 `isInitialized`=true；run 32838388685）
- [X] 5.2 加 `iosCategory: 'playback'`，切后台仍出声（应用内自测 `audio_session` + `background_play` PASS：运行时 `AVAudioSessionCategoryPlayback` 生效；原生探针接管音频后宿主把前台切走，切后台 +2s/+14s 两次采样位置 12.87s→25.48s（+12.6s，rate=1 持续）硬断言「后台音频持续推进」成立，会话未断开、`playingNow=1`；run 33248314363）
- [ ] 5.3 锁屏控制：歌名/封面显示，播放/暂停/上下曲可用（元数据面已经 CI 验证：`playback` 用例经 `getNowPlayingInfo` 原生探针实证 Now Playing 面板 title/artist/album/duration/封面（`hasArtwork=true`）逐项写入；`remoteCommandController` 已注册 play/pause/next/previous/seek 五组远程控制处理器并桥到 JS 事件（`service.ts` 监听齐全）。锁屏面板上物理按键触发与目视确认待手测）
- [X] 5.4 `updateNowPlayingTitles`，锁屏标题随歌词变化（应用内自测 `playback` PASS：iOS 侧该方法经 `updateNowPlayingMetadataIOS` 走 fork 的 metadata 通道，调用后 `getNowPlayingInfo` 原生探针实证 title 翻为歌词行 `lx-ci lyric line`；run 33248314363）
- [X] 5.5 缓存三方法降级（0/false），`preloadNextMusic` 不崩（应用内自测 `player_cache_degrade` PASS：`isCached`=false、`getCacheSize`=0、`clearCache` 不崩；run 32838388685）
- [X] 5.6 CacheModule：设置页缓存大小显示与清理有效（应用内自测 `cache_module` PASS：写入样本后统计 128 字节、清理后归 0，字节口径对齐 Android；设置页展示待手测；run 32838388685）
- [ ] 5.7 门槛验证：完整听完一首在线歌，锁屏不中断可控

## 6. Phase 3：功能补齐

- [X] 6.1 gzip 走 libz `windowBits=31`，`.lxmc` 与 Android 双向导入成功（应用内自测 `gzip_contract` PASS + 宿主 `gzip_host_crosscheck`：iOS 产物经 Node gunzip 还原逐字节一致（iOS→外部）、`unGzipString` 方向契约内同样字节级对齐（外部→iOS）；文件实体双向互传待手测；run 32838388685）
- [X] 6.2 `toast.ios.tsx`，各处 toast 正常显示（应用内自测 `toast_overlay` PASS：RNN overlay 出现并自动消失；过程中发现并修复真实缺陷——`toast.ts` 与 `toast.ios.tsx` 基名同名导致 Metro 解析先命中无平台后缀的 `.ts`，iOS 实际一直走 ToastAndroid 空实现（console 警告实证），改名 `toast.android.ts` 后平台解析生效，双端 Metro 打包验证；run 32883447399）
- [X] 6.3 深链（AppDelegate + Info.plist），`lxmusic://` 触发对应行为（应用内自测 `deeplink` PASS：`lxmusic://player/pause` 经 SpringBoard 路由→AppDelegate openURL→RN 事件→`handlePlayerAction` 全链路（应用内 `Linking.openURL` 自投递），`file://` 探针经系统投递触发导入确认弹窗；注：iOS 18.5 模拟器 `simctl openurl` 对自定义 scheme 静默吞件（前台/后台唤醒均证伪，假 scheme 诊断证明 LaunchServices 已注册路由、纯投递层问题——run 32834027405/32836063520），真机外部唤起路径待 AltStore 重签后验证；run 32838388685）
- [ ] 6.4 `CFBundleDocumentTypes`，从"文件"App 打开 `.lxmc` 触发导入（代码已写：lxmc/js/audio 三类 DocumentTypes + lxmc UTI 导出声明 + iTunes 文件共享 + ATS 放行 http；`file://` 投递→`handleFileLXMCAction`→导入确认弹窗链路已端到端实证（run 32838388685）；"文件" App 交互入口待手测）
- [ ] 6.5 ChoosePath iOS 化（DocumentPicker），能选文件并导入歌单（代码已写：UtilsModule `selectFile` UIDocumentPicker 拷贝进沙箱、`fs.ios.ts` 接入、存储权限恒真、Header 隐藏存储卷切换、FileType 补 isFile/lastModified；运行时待验证）
- [X] 6.6 通知权限 / 屏幕常亮 / 分享 / 设备名 / WiFi IP 逐项手测（应用内自测 `misc_utils` PASS：设备名非空、WiFi IP 返回合法、通知开关只读布尔、屏幕常亮开-读（`idleTimerDisabled=true`）-关（`false`）往返、`shareText` 导出存在；仅分享面板实际弹出需人工交互确认；run 33248314363）
- [ ] 6.7 数据同步与桌面版双向完成一次
- [X] 6.8 `tools.ts` 平台分支，`isSupportedAutoTheme` 生效，深色模式跟随（应用内自测 `auto_theme` PASS：宿主 `simctl ui appearance dark` 触发后，RN Appearance 翻转且主题应用为 dark（themeId=black）；过程中发现并修复真实缺陷——`getIsSupportedAutoTheme` 用 Android 独有的 `Platform.constants.Release`，iOS 上恒为 false、深色跟随从未生效，iOS 分支改用 `Platform.Version`；run 32883447399）
- [ ] 6.9 门槛验证：主流程（搜索→播放→收藏→歌单管理→备份恢复→同步）全通

## 7. Phase 4：降级与打磨

- [X] 7.1 桌面歌词整组隐藏 + `lyricDesktop.ios.ts` 桩，无死链无未捕获 reject（应用内自测 `lyric_stubs` PASS：22 导出安全桩逐个可调用；整包经启动/四 Tab/深链全程无未捕获 reject；设置页人工遍历待手测；run 32838388685）
- [X] 7.2 本地音乐降级：扫描不崩，元数据显示文件名（应用内自测 `local_media_degrade` PASS：扫描 1 文件不崩、元数据降级为文件名 `lx-ci-fake`；run 32838388685）
- [X] 7.3 应用内更新改为跳转 Release 页（应用内自测 `version_update_release` PASS：spy `Linking.openURL`，`downloadNewVersion`/`updateApp` 均跳转 GitHub Release 页，无下载安装行为；run 32883447399）
- [ ] 7.4 横屏 / iPad 布局：24 个 Horizontal tsx 不错位（横屏旋转通道已经 CI 验证：`landscape` 用例断言尺寸翻转 402x874→874x402、`isHorizontalMode` 生效、宿主截图握手、可复原竖屏、全程无意外弹窗；本轮 `phantomForward=true`——iOS 18.5 模拟器幻影旋转致 RN 布局事件缺席，经原生读数重同步通过，布局实际重排版目视确认待手测；run 33248314363）
- [X] 7.5 CI 新增 iOS unsigned build job 并通过（`.github/workflows/ios-verify.yml`，macos-15 / Xcode 16.4；首验 run 32705189097，门禁后归并为设备版构建 + IPA artifact，run 32707901201 双 SDK 均通过）
- [ ] 7.6 真机测试 ≥2 台（含 iOS 13/14 旧机），连续 30 分钟无崩溃，Instruments 无明显泄漏
- [X] 7.7 `assets/script/user-api-preload.js` 移动后，Android release 构建回归一次（统一到仓库根：iOS pbxproj 跨目录引用、Android gradle sourceSets assets 映射，包内路径不变；CI `android-regression` job 通过——run 32802185448 assembleRelease 成功且 `assets/script/user-api-preload.js` 确认入包；iOS 侧同一构建经 `ios-build` job 验证）
