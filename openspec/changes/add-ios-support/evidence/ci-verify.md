# CI 验证证据：iOS Verify（2026-08-24）

- 运行：[actions/runs/32705189097](https://github.com/wtfdelphia/lx-music-mobile/actions/runs/32705189097)
  （`dev-ios` @ `1dbb577`，工作流 `.github/workflows/ios-verify.yml`）
- Runner：GitHub Actions `macos-15`（arm64）
- 工具链：Xcode 16.4（Build 16F6）、CocoaPods 1.17.0、Node v18（.nvmrc）

## 结果

| 验证项 | 对应任务 | 结果 |
|---|---|---|
| `cargo build --locked --release --target aarch64-apple-ios` | 3.1（编译部分） | ✅ 39s |
| `cargo test --locked`（macOS 宿主黄金基准） | 3.3 复证 | ✅ |
| `npm ci` → `pod install`（`NO_FLIPPER=1`）→ `xcodebuild` 模拟器 Release，`CODE_SIGNING_ALLOWED=NO` | 7.5 / R8 门槛 | ✅ 21m14s，`** BUILD SUCCEEDED **`，产物 `LxMusicMobile.app` |

## 结论

- RN 0.73.11 × Xcode 16.4 编译级兼容成立，Phase 0 的 Xcode 版本风险降级
  （运行时级兼容仍需模拟器/真机验证）。
- 任务 3.1 的 D2 退路条件未触发；剩余"哑函数经桥调通"属交互式验证，
  待本机macOS（macOS 15 / Intel）环境。
- 首次 `npm ci` 失败源于 vitest 引入时 lockfile 未同步，已由 `1dbb577`
  以 `--package-lock-only` 修复。
