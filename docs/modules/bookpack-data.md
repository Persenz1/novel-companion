# 模块：Bookpack 与数据格式

## 需求

bookpack 是本项目的本地数据工程单位。它需要同时支撑清洗、制作、校验、编译和阅读。

工程包可包含：

- `manifest.json`
- `source/`
- `parsed/`
- `assets/`
- `candidates/`
- `review/`
- `accepted/`
- `reports/`
- `compiled/`

阅读包长期应只包含稳定阅读所需数据：manifest、正文 / Parsed、Accepted、Compiled 和必要 assets，不包含 Candidates、Review、OpenQuestions 或模型中间产物。

## 已实现格式

当前工具链读取和写入：

- `manifest.json`
- `parsed/volumes/*.md`
- `parsed/blocks.jsonl`
- `parsed/scenes.jsonl`
- `parsed/assets.jsonl`
- `parsed/asset_anchors.jsonl`
- `parsed/alignments.jsonl`
- `accepted/*.jsonl`
- `accepted/changes.jsonl`
- `candidates/candidates.jsonl`
- `review/block_progress.jsonl`
- `review/review_items.jsonl`
- `review/open_questions.jsonl`
- `reports/cleaning_report.json`
- `reports/validation_report.json`
- `reports/work_runs.jsonl`
- `compiled/reader_index.json`

## Markdown 主文本

清洗后的中文正文放在 `parsed/volumes/*.md`。正文通过单行 HTML 注释 marker 标记：

- `chapter`
- `block`
- `scene`
- `asset`
- `alignment`

Parser 会隐藏注释并把正文复制到 `parsed/blocks.jsonl`。block ID 在清洗后应保持稳定；进入 Candidate / Review / Accepted 后不得随意重排。

## 时间线位置

第一阶段只支持中文正文派生位置参与阅读查询：

```text
v01.start
v01.c01.start
v01.c01.b0001
v01.c01.end
v01.end
```

`semester_1.end`、`external:*`、`manual:*` 不参与当前自动阅读查询。需要展示时必须映射到正文位置。

## Accepted 与 Change

Accepted 是正式增强数据；Change 是审计链。当前支持类型包括：

- `entity`
- `fact`
- `event`
- `relation_change`
- `metric`
- `metric_change`
- `character_card`
- `term_card`
- `speaker_label`
- `asset_subject`

每次 Accepted 写入必须生成 Change。当前 `AgentStore` 对新对象接受和撤销可用；update / merge / deprecate 需要补 `before` 快照才能做到完整恢复。

## Candidate / Review

Candidate 是起草到复核之间的中间格式，不是最终 UI 的主操作对象。ReviewItem 是短期异常队列；OpenQuestion 是长期未决问题。普通阅读器不得展示这些中间产物。

## 未完成

- reader 包导出规则尚未实现。
- text hash / source fingerprint 仍是预留。
- Phase B 跨卷历史上下文还没有数据格式产物，例如卷末压缩记忆或检索索引；gray-tower Phase A 已先用全局 Accepted + 当前卷正文跑通四卷。
