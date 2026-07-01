# 模块：gray-tower 测试夹具

## 需求

`samples/gray-tower` 是原创测试书包，用于验证格式、工具链、写入链路和防剧透查询。它不追求文学完成度，也不包含真实版权文本。

现在是 **4 卷**原创测试卷（`v01`–`v04`），刻意埋了跨卷线索（实体复用、D 班点数弧线、林澈–许映白关系、许映白隐藏身份伏笔在卷 3 回收），专供长程制作测试，见 [long-range-test](long-range-test.md)。

## 提交态

提交态保持为清洗后样例包：

- 4 卷正文和 Parsed 存在（`parsed/volumes/v0{1..4}.md`）。
- v01 有 5 张真实测试插图（林澈立绘、银发少女读信、灰塔夜景、点数榜、五人群像），供清洗识图和阅读器测试。
- 中日双语日文源存在：每卷 `source/ja/{vol}.blocks.json`（`block_id -> 日文`，1:1，供阅读器逐段交替显示）。旧的 alignment 级 `source/ja/v01.json` 保留，供 parser 生成 alignments。
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

- 真实 LLM 长程测试的仓库可复现自动化（已有人机实跑脱敏记录，见 [long-range-test-phase-a-2026-07-01](long-range-test-phase-a-2026-07-01.md)；仓库自动测试仍不调用模型）。
- 真实（版权）书籍长程压测。
- 阅读器 UI 自动化验收用例（当前为 typecheck ＋ 接口冒烟 ＋ 无头截图人工确认）。
