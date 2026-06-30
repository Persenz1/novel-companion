# 第一阶段设计定案 v0.1

> 2026-06-30 状态覆盖：阶段 5-8 清洗后操作逻辑已由 `docs/post-cleaning-operation-design-v0.2.md` 定案。凡本文仍出现「逐候选人工复核」「AI 不得写 Accepted」「待重构 / 暂停实现」等旧口径，均以 v0.2 为准：AI 起草 + 独立 AI 复核后可自动写 Accepted，但必须生成可追溯、可回滚 Change，高风险项升级给人裁决。

本文记录项目审核后已经定案的第一阶段接口规则。若本文与更早需求草案冲突，以本文和各分规格文档为准。

## 0. 2026-06-30 状态覆盖

本文中的数据边界、文件职责、防剧透和审计链仍然有效；「AI 不得直接写 Accepted」已被 v0.2 修订为「AI 不得静默写 Accepted，经独立复核可自动写入，但必须有 Change 与回滚路径」。

Agent / 工作台相关段落不再表示“逐候选卡片式复核”是定案交互。当前定案见 `docs/post-cleaning-operation-design-v0.2.md`。

## 1. Parsed 与复核进度

`parsed/*.jsonl` 是由 Markdown 和资源目录生成的解析产物，应可重复生成。

block 复核进度不写入 `parsed/blocks.jsonl`，而写入：

```text
review/block_progress.jsonl
```

职责边界：

- `parsed/blocks.jsonl`：正文 block 结构和文本副本。
- `review/block_progress.jsonl`：block 制作进度。
- `candidates/candidates.jsonl`：AI 候选及候选状态。
- `review/open_questions.jsonl`：长期未决问题。
- `accepted/*.jsonl`：正式增强数据。
- `accepted/changes.jsonl`：正式数据变更审计。

## 2. Review 区分工

Review 区包含：

```text
review/block_progress.jsonl
review/review_items.jsonl
review/open_questions.jsonl
```

- `block_progress`：记录 block 制作进度。
- `review_items`：短期待处理任务。
- `open_questions`：长期未决问题，可以等后文回查。

`has_open_question` 表示 block 留有长期问题，但不阻塞继续往后复核。

## 3. Candidate 定位与作业顺序

Candidate 必须有 `source_span`。`block_id` 是主显示位置，可选；若存在，必须落在 `source_span` 内。默认主显示位置为 `source_span.start_block`。

本节定义的是 Candidate 的数据定位和可排序规则，不强制 UI 必须让人工逐条处理每个 Candidate。

复核主流程按正文时间线排序：

```text
source_span.start_block
-> source_span.end_block
-> candidate.id
```

范围型候选在 `source_span.start_block` 所在位置出现，复核时展示整个 `source_span`。

## 4. Accepted 与 Change

Accepted 保存当前正式状态，Change 保存最低可校验审计链。第一阶段不要求从 Change 重建 Accepted。

每条 Accepted 对象必须有：

```json
{
  "created_change_id": "change_000001",
  "updated_change_ids": []
}
```

每条 Change 必须有：

```text
id
operation
target_file
target_type
target_id
approved_by
created_at
```

`accept_candidate` 类 Change 必须有 `candidate_id`；`manual_create` 可以没有。

拒绝 Candidate、转 ReviewItem、转 OpenQuestion 不写 `accepted/changes.jsonl`，除非同时修改 Accepted。

## 5. Markdown 注释语法

Markdown 注释采用单行 HTML 注释，格式为：

```text
<!-- tag: primary key: value key: "quoted value" -->
```

规则：

- 注释必须单行。
- `primary` 统一表示对象 ID。
- 多值字段使用逗号分隔且不加空格。
- 带空格、冒号或复杂标点的值必须用双引号。
- 不支持复杂转义；需要引号时优先改写文本或使用中文引号。
- 未识别 tag 或未知 key 记 warning。
- 必填字段缺失或格式非法记 error。

## 6. 时间线与防剧透

第一阶段自动防剧透时间线只认中文正文派生位置：

```text
v01.start
v01.c01.start
v01.c01.b0001
v01.c01.end
v01.end
```

比较 `visible_from <= read_boundary` 时只使用 `compiled/reader_index.json` 的 `timeline.order`，不使用字符串排序。

`semester_1.end`、`external:*`、`manual:*` 不参与第一阶段自动阅读查询；若要进入 Accepted 并展示，必须映射到正文时间线位置。

## 7. Agent 一期边界

AI 是结构化制作的第一起草者，人工是正式数据的裁决者，Agent 是上下文、工具和写入规则的执行中枢。

2026-06-30 更新：以下能力列表保留为边界要求，但实际交互方式按 v0.2 执行。尤其是“按时间顺序送入复核工作台”不应被理解为候选卡片逐条点击确认。

第一阶段 Agent 必须能：

- 按 block/source_span 顺序读取正文。
- 检索当前范围相关 Accepted、Candidates、OpenQuestions。
- 调用 AI 生成候选草案。
- 候选覆盖 entity、fact、event、relation_change、speaker_label、metric、metric_change、term_card、character_card、asset_subject、review_item、open_question。
- 为候选生成 source_span、visible_from、confidence、evidence、risk_flags、payload.draft。
- 校验候选引用和格式。
- 送入独立复核 Agent 与异常队列。
- 独立复核通过或人工裁决后写 Accepted + Change。
- 更新 Candidate status 和 block_progress。

AI 可以自动写 Candidates、ReviewItems、OpenQuestions；经独立复核后可自动写低风险 Accepted。AI 不得静默写 Accepted、合并实体、硬写关系/身份/伏笔解释等高风险正式数据；这些必须升级给人裁决。

## 8. Agent 上下文预算

Agent 必须具备上下文预算意识。每次 AI 作业前，Agent 应展示：

- 作业范围。
- 已作业 block 与未作业 block。
- 输入正文、历史上下文、schema/提示词、输出预算的估算 token。
- 被注入的上下文组成。
- 可能的跨段、重复候选、证据不足等风险。

用户应能选择整卷、章节、scene、固定 block 数或自定义 range 作业。当前实用策略：目标按章节/范围处理，但背景上下文可喂入整卷正文以保持实体、称呼和情节连续；超长小说再分块处理。Agent 不应把全系列历史和全候选无差别塞入上下文。

作业记录写入：

```text
reports/work_runs.jsonl
```

## 9. 说话人标注

歧义 speaker_label 必须升级给人；无歧义单说话人可经独立复核后自动进入 Accepted。

- AI 先生成 speaker_label Candidate，再由独立复核 Agent 路由。
- 阅读器只展示 Accepted speaker_labels。
- 阅读器不展示未落盘 Candidate。
- 自动展示只来自已写入 Accepted 的 speaker_label。
- 一个 dialogue block 默认一条说话人标注；多说话人优先拆 block。

## 10. 测试书验收

《灰塔学院测试卷》是第一阶段验收夹具，不追求文学完整度。它必须覆盖 Markdown、Parsed、Candidates、Review、Accepted、Compiled、Reader、防剧透和 Agent 作业分段。
