## Purpose

在 iOS 上提供与 Android 字节级一致的 AES/RSA 加密能力，支撑音源请求、数据同步与自定义源注入。

## ADDED Requirements

### Requirement: AES 字节级一致

对任意 `(输入, key, iv, mode)`，iOS 侧 AES 加解密输出 SHALL 与 Android 黄金基准字节级一致，包括非 16 字节对齐明文、空串 IV、不足 16 字节的 IV。

#### Scenario: ECB 模式带填充

- **WHEN** 以 `ECB_128_NoPadding` 加密非 16 字节对齐明文
- **THEN** 密文与 Android 基准一致（实际含 PKCS7 填充）

#### Scenario: 空 IV 与短 IV

- **WHEN** iv 为空串或不足 16 字节
- **THEN** 分别走无 IV 重载与零填充路径，输出与基准一致

### Requirement: RSA 契约

RSA SHALL 支持 OAEP-SHA1 与 NoPadding 两种 padding，公钥以 SPKI、私钥以 PKCS#8 格式进出，且一端生成的密钥能被另一端解开。

#### Scenario: 跨端密钥往返

- **WHEN** iOS 生成密钥对并以两种 padding 各做一次加解密往返
- **THEN** 全部成功，且公钥可被 Android 侧解出

### Requirement: 同步方法可用

`aesEncryptSync`、`aesDecryptSync`、`rsaEncryptSync`、`rsaDecryptSync` SHALL 保持同步调用语义，可在 JS 表达式内直接取返回值。

#### Scenario: 音源请求路径

- **WHEN** 酷我/网易云请求经同步加密路径发起
- **THEN** 同步返回密文且请求成功

### Requirement: 黄金基准门禁

加密实现的任何变更 SHALL 先全量通过黄金基准（桌面单元测试与 iOS 经桥各一次）方可合入。

#### Scenario: 基准回归

- **WHEN** 修改加密实现后运行基准测试
- **THEN** 全部用例字节级通过，否则阻断合入
