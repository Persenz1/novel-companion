# 模块：gray-tower 测试夹具

## 需求

`samples/gray-tower` 是原创测试书包，用于验证格式、工具链、写入链路和防剧透查询。它不追求文学完成度，也不包含真实版权文本。

## 提交态

提交态保持为清洗后样例包：

- 正文和 Parsed 存在。
- 图片占位存在。
- 日文参考源存在。
- Accepted / Candidates / Review / work_runs 为空。
- Compiled 是空 Accepted 基线。

这个状态用于避免把模型试跑数据或 fixture 输出混进仓库。

## Fixture

实现：`tools/scripts/gray-tower-fixture.ts`

Fixture 会在临时目录中：

- 写 Candidates。
- 通过 fixture store 写 Accepted。
- 写 ReviewItem / OpenQuestion。
- 写 work_runs。
- validate。
- compile。
- 执行 query 测试。

Fixture 不调用真实模型，不需要 API key。它证明数据格式、写入链路和查询语义，不证明真实 LLM 长程质量。

## 覆盖点

- 多章节 Markdown。
- scene start/end。
- asset anchor。
- alignment：一对一、一对多、多对一、pending_review。
- entity、fact、event、relation_change。
- metric / metric_change。
- term_card / character_card。
- speaker_label。
- asset_subject。
- 后文揭示和 read_boundary 防剧透。
- 缺失数值不推测。

## 未完成

- 双卷 fixture。
- 真实书籍长程制作压测记录。
- 阅读器 UI 验收用例。
