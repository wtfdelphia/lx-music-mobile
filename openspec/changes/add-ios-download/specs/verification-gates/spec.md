## ADDED Requirements

### Requirement: 原生下载行为实证门禁

依赖真机与侧载签名的原生下载行为（后台会话重挂接、后台唤醒时独立完成与记账、强退取消分类与续传、备份排除属性读回）MUST NOT 在未经真机实证时标记为通过；每项实证的操作、观察、结论 SHALL 记录在 change 的 `evidence/` 目录。依赖实证的后续阶段在实证全部通过前 MUST NOT 开始实施。

#### Scenario: 实证留痕

- **WHEN** 查阅 `openspec/changes/add-ios-download/evidence/`
- **THEN** 每项实证有操作、观察、结论记录，未实证项标为待实证而非通过

#### Scenario: 实证未过不开工

- **WHEN** 四项实证中有任一项未完成或证伪
- **THEN** 依赖实证的实施阶段（暂停、续传、后台唤醒）未开始，结论记录为停下重估
