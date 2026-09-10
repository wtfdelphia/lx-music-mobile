# 自定义源脚本回归集

用途：验证 `user-api-preload.js` 沙箱在目标引擎上的脚本兼容性。

- **iOS 侧**：Phase 1 末的 G1 闸门（`docs/ios-optimal-plan.md` §4 / design.md D6）
- **Android 侧**：仅当 Rust 二期（rquickjs 换芯）启动后需要，见 `docs/ios-rust-hybrid-analysis.md` §4

## 收集要求

- 数量 ≥10，覆盖 6 大音源：`bd` `kg` `kw` `mg` `tx` `wy`
- 优先选择社区高频使用的自定义源脚本
- 每个脚本入库前确认许可证允许；在 `manifest.json` 登记文件名、来源、目标音源

## 断言链（每个脚本）

1. `load`：脚本可被沙箱加载，无求值期异常
2. `inited`：收到 `inited` 事件（`lx_setup` 握手成功）
3. `search`：固定关键词搜索返回非空结果
4. `getMusicUrl`：对搜索结果首条取播放链接成功

## 执行方式

回归集运行依赖沙箱环境（iOS：Xcode 工程 + UserApiModule；Android：App 内自定义源导入），
在具备对应环境后接入一键运行入口；JCE/引擎差异导致的失败按 design.md D6 判读。
