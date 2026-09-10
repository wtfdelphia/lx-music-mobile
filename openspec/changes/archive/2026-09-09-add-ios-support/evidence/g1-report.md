# G1 闸门判读报告（任务 4.5）

变更：add-ios-support
判读基准：design.md D6
数据源：`.github/workflows/ios-verify.yml` 冒烟 job 的 `user_api_regression`
用例（23 个社区脚本逐一「加载→inited」），本报告以 CI run 32982319768
为准（21/23，21 个硬断言全绿），历史参照 run 32883447399 同口径。

## 回归集构成与断言口径

- 23 个社区自定义源脚本，覆盖 kw/kw 变体等 6 大音源家族
- 硬断言（expectInited=true，21 个）：离线即可完成握手，失败即门禁红
- 软记录（expectInited=false，2 个）：
  - `a970-sixyin-1.2.1.js`：求值期依赖远端音源信息，离线必失败
  - `zxwy-lx-script.js`：包装器型，运行时拉远端源，CI 外网不稳定
- 「搜索→取链接」段依赖外网且社区端点易变，按 D6 不作硬门禁，
  保留手测与本报告判读（kw 端点可达性已离线复测：搜索接口 200 有真实
  返回；playUrl 无有效 Secret 令牌返回非法请求，属凭证侧而非沙箱侧问题）

## 结果

- 加载→inited：21/23（硬断言 21/21 全绿，零失败）
- 软记录 2 项（与沙箱无关，远端依赖型）：
  - `a970-sixyin-1.2.1.js`：sources=0，求值期依赖远端
  - `zxwy-lx-script.js`：sources=0，包装器拉远端
- 两次独立 run（32883447399 / 32982319768）结果一致，排除偶发

## D6 判读

- 硬断言 21/21 全绿，零脚本级失败 → 核心音源在 iOS JavaScriptCore
  系统性可用，`preload.js` 依赖的 ES 特性（Proxy / Promise / TypedArray
  等）无运行时缺口
- 2 个软记录项均为远端依赖型，与沙箱无关（本地预跑同口径）
- 结论：**留 JSC，不触发 Rust 二期**。无需脚本级 shim，无需另立 change

## 附：判定依据明细

- 沙箱侧逐项能力已由 `user_api_sandbox` 用例独立实证（加载完成、7 个
  `__lx_native_call__*` 注入与 Android 语义一致、`lx_setup` 双向通道、
  `set_timeout` 回调）——回归集失败若发生可定位到脚本自身而非沙箱
- 加载→inited 通过率即 D6 的「核心音源可用」判据；搜索→取链接留手测
