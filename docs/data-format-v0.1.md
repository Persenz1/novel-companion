# 数据格式规格 v0.1

## 1. 目录结构

推荐工程包结构：

```text
bookpack/
  manifest.json
  source/
  parsed/
    volumes/
      v01.md
    blocks.jsonl
    scenes.jsonl
    assets.jsonl
    asset_anchors.jsonl
    alignments.jsonl
  assets/
    images/
  accepted/
    entities.jsonl
    facts.jsonl
    events.jsonl
    relation_changes.jsonl
    metrics.jsonl
    metric_changes.jsonl
    character_cards.jsonl
    term_cards.jsonl
    speaker_labels.jsonl
    asset_subjects.jsonl
    changes.jsonl
  candidates/
    candidates.jsonl
  review/
    block_progress.jsonl
    review_items.jsonl
    open_questions.jsonl
  compiled/
    reader_index.json
  reports/
    cleaning_report.json
    validation_report.json
    work_runs.jsonl
```

## 2. Markdown 主文本

一卷一个 Markdown 文件：

```text
parsed/volumes/v01.md
```

注释采用单行 HTML 注释，通用格式为：

```text
<!-- tag: primary key: value key: "quoted value" -->
```

`primary` 统一表示对象 ID。`value` 如果有空格、冒号或复杂标点，使用双引号。多值字段使用逗号分隔且不加空格。

```md
<!-- chapter: v01.c01 kind: chapter title: "第一章 试探" -->
# 第一章 试探

<!-- scene: v01.c01.s001 action: start title: "教室里的通知" -->

<!-- block: v01.c01.b0001 kind: paragraph -->
今天的教室有些安静。

<!-- block: v01.c01.b0002 kind: dialogue -->
「你知道今天要公布什么吗？」她问。

<!-- alignment: v01.c01.a001 blocks: v01.c01.b0002 -->

<!-- asset: v01_img_001 anchor_type: after_block block: v01.c01.b0002 alt: "教室插图" -->
![教室插图](../../assets/images/v01_img_001.jpg)

<!-- scene: v01.c01.s001 action: end -->
```

已识别 tag 包括 `chapter`、`block`、`scene`、`asset`、`alignment`。未识别 tag 或未知 key 进入 warning；必填字段缺失或格式非法进入 error。

## 3. ID 规则

普通 block ID：

```text
v01.c03.b0042
```

特殊章节：

```text
v01.prologue.b0001
v01.epilogue.b0001
```

block 编号每章重置。插入补块使用可排序后缀：

```text
v01.c03.b0042a
```

实体 ID 使用人工可读 slug：

```text
entity_horikita
entity_d_class
term_oaa
```

## 4. manifest.json

最小示例：

```json
{
  "schema_version": "0.1.0",
  "pack_id": "gray_tower_project_v1",
  "pack_name": "灰塔学院测试卷工程包",
  "pack_type": "project",
  "series": {
    "id": "gray_tower",
    "title": "灰塔学院测试卷"
  },
  "volumes": [
    {
      "id": "v01",
      "title": "第一卷",
      "main_text": "parsed/volumes/v01.md",
      "chapters": [
        {
          "id": "v01.prologue",
          "order": 0,
          "kind": "prologue",
          "title": "序章：灰塔学院"
        },
        {
          "id": "v01.c01",
          "order": 1,
          "kind": "chapter",
          "title": "第一章：点数公告"
        }
      ]
    }
  ],
  "features": {
    "contains_text": true,
    "contains_assets": false,
    "contains_ja_reference": false
  },
  "rights": {
    "usage_scope": "sample_only",
    "rights_note": "原创测试文本，可用于项目测试。"
  }
}
```

`pack_type` 支持：

```text
project
reader
```

`project` 包可以包含 Source、Parsed、Candidates、Review、Reports、Accepted 和 Compiled。`reader` 包只应包含 manifest、Parsed / 正文资源、Accepted、Compiled 和必要 assets；不得包含 `candidates/`、`review/`、OpenQuestions 或 AI 中间产物。

## 5. Parsed JSONL

### 5.1 blocks.jsonl

```json
{
  "id": "v01.c01.b0001",
  "series_id": "gray_tower",
  "volume_id": "v01",
  "chapter_id": "v01.c01",
  "order": 1,
  "kind": "paragraph",
  "text": "今天的教室有些安静。",
  "source_markdown": "parsed/volumes/v01.md"
}
```

`kind` 支持：

```text
paragraph
dialogue
separator
note
```

### 5.2 scenes.jsonl

```json
{
  "id": "v01.c01.s001",
  "series_id": "gray_tower",
  "volume_id": "v01",
  "chapter_id": "v01.c01",
  "order": 1,
  "title": "教室里的通知",
  "start_block": "v01.c01.b0001",
  "end_block": "v01.c01.b0008",
  "pov": null,
  "location_entity_id": null,
  "status": "parsed"
}
```

### 5.3 assets.jsonl

```json
{
  "id": "v01_img_001",
  "type": "image",
  "path": "assets/images/v01_img_001.jpg",
  "alt": "教室插图",
  "source_volume_id": "v01"
}
```

### 5.4 asset_anchors.jsonl

```json
{
  "id": "asset_anchor_001",
  "asset_id": "v01_img_001",
  "anchor_type": "after_block",
  "block_id": "v01.c01.b0002"
}
```

### 5.5 alignments.jsonl

```json
{
  "id": "v01.c01.a001",
  "series_id": "gray_tower",
  "volume_id": "v01",
  "chapter_id": "v01.c01",
  "zh_block_ids": ["v01.c01.b0002"],
  "ja_refs": [
    {
      "id": "v01.c01.j0002",
      "order": 1,
      "text": "「今日、何が発表されるか知ってる？」"
    }
  ],
  "confidence": 0.92,
  "status": "reviewed"
}
```

日文只作参考渲染，不进入中文主操作链。

## 6. Review JSONL

### 6.1 block_progress.jsonl

`block_progress` 只记录 block 制作进度，不保存候选正文或正式事实。

```json
{
  "block_id": "v01.c01.b0008",
  "status": "has_open_question",
  "candidate_count": 5,
  "open_question_count": 1,
  "updated_by": "user",
  "updated_at": "2026-06-30T00:00:00Z"
}
```

`status` 支持：

```text
unreviewed
ai_generated
reviewing
reviewed
has_open_question
skipped
```

`has_open_question` 表示留下长期问题，但不阻塞继续往后复核。

### 6.2 review_items.jsonl

ReviewItem 是短期待处理任务。

```json
{
  "id": "review_v01_c01_0001",
  "type": "candidate_conflict",
  "status": "open",
  "priority": "medium",
  "block_id": "v01.c01.b0008",
  "source_span": {
    "start_block": "v01.c01.b0008",
    "end_block": "v01.c01.b0012"
  },
  "candidate_id": "cand_000123",
  "message": "候选事件与已有事件可能重复。",
  "recommended_action": "merge_or_reject",
  "created_by": "agent",
  "created_at": "2026-06-30T00:00:00Z"
}
```

`status` 支持：

```text
open
resolved
dismissed
converted_to_open_question
```

### 6.3 open_questions.jsonl

OpenQuestion 是长期悬而未决的问题。

```json
{
  "id": "oq_v01_c01_0001",
  "type": "possible_foreshadowing",
  "status": "open",
  "risk_level": "high",
  "source_span": {
    "start_block": "v01.c01.b0010",
    "end_block": "v01.c01.b0010"
  },
  "question": "未寄出的名单是否与后续分组有关？",
  "related_entity_ids": [],
  "related_candidate_ids": ["cand_000145"],
  "related_accepted_ids": [],
  "revisit_after": "v01.epilogue.end",
  "resolution": null,
  "resolved_by_change_id": null,
  "created_by": "agent",
  "created_at": "2026-06-30T00:00:00Z",
  "updated_at": "2026-06-30T00:00:00Z"
}
```

`status` 支持：

```text
open
resolved
dismissed
```

如果 resolved 产生正式数据，必须写 Accepted + Change，并把 `resolved_by_change_id` 指向对应 Change。

## 7. Accepted JSONL

### 7.1 通用规则

默认所有 Accepted 对象必须有：

- `status`
- `visible_from`
- `created_change_id`
- `updated_change_ids`

默认来源追溯字段是 `source_span`，引用中文正文 block range。

`character_card` 可以用 `source_refs` 代替直接 `source_span`，但 `source_refs` 引用的 Accepted 对象必须能追溯到中文正文 block。

`asset_subject` 的来源是图片本体，可以用 `asset_anchor_id` 回到图片所在 block；但仍必须有 `visible_from` 和 `created_change_id`。

### 7.2 类型到文件映射

```text
entity            -> accepted/entities.jsonl
fact              -> accepted/facts.jsonl
event             -> accepted/events.jsonl
relation_change   -> accepted/relation_changes.jsonl
metric            -> accepted/metrics.jsonl
metric_change     -> accepted/metric_changes.jsonl
character_card    -> accepted/character_cards.jsonl
term_card         -> accepted/term_cards.jsonl
speaker_label     -> accepted/speaker_labels.jsonl
asset_subject     -> accepted/asset_subjects.jsonl
```

### 7.3 entities.jsonl

```json
{
  "id": "entity_horikita",
  "series_id": "gray_tower",
  "type": "character",
  "name": "堀北铃音",
  "aliases": ["堀北"],
  "first_seen": "v01.c01.b0002",
  "status": "accepted",
  "source_span": {
    "start_block": "v01.c01.b0002",
    "end_block": "v01.c01.b0002"
  },
  "created_change_id": "change_000001",
  "updated_change_ids": []
}
```

实体类型第一阶段支持：

```text
character
organization
location
term
event_concept
group
worldbuilding
```

### 7.4 facts.jsonl

```json
{
  "id": "fact_horikita_class_v01_c01",
  "series_id": "gray_tower",
  "subject_id": "entity_horikita",
  "predicate": "class",
  "value": "D班",
  "value_type": "entity",
  "value_entity_id": "entity_d_class",
  "valid_from": "v01.c01.b0002",
  "valid_until": null,
  "visible_from": "v01.c01.b0002",
  "source_span": {
    "start_block": "v01.c01.b0002",
    "end_block": "v01.c01.b0002"
  },
  "status": "accepted",
  "created_change_id": "change_000002",
  "updated_change_ids": []
}
```

`value_type` 支持：

```text
string
entity
number
boolean
```

### 7.5 events.jsonl

```json
{
  "id": "event_v01_c01_exam_announced",
  "series_id": "gray_tower",
  "type": "exam_rule_announced",
  "title": "特别考试规则公布",
  "summary": "班级收到一次特别考试的规则说明。",
  "summary_source": "ai_draft",
  "position": "v01.c01.b0010",
  "participants": ["entity_ayanokouji", "entity_horikita"],
  "related_entities": ["entity_d_class"],
  "importance": "major",
  "visible_from": "v01.c01.b0010",
  "source_span": {
    "start_block": "v01.c01.b0008",
    "end_block": "v01.c01.b0012"
  },
  "status": "accepted",
  "created_change_id": "change_000003",
  "updated_change_ids": []
}
```

`importance` 支持：

```text
critical
major
minor
background
```

### 7.6 relation_changes.jsonl

```json
{
  "id": "relation_change_ayanokouji_horikita_v01_c01",
  "series_id": "gray_tower",
  "entities": ["entity_ayanokouji", "entity_horikita"],
  "before": "几乎没有交集，只是同班同学。",
  "after": "因为一次规则说明产生了短暂交流，彼此开始注意到对方。",
  "event_id": "event_v01_c01_exam_announced",
  "valid_from": "v01.c01.b0012",
  "visible_from": "v01.c01.b0012",
  "source_span": {
    "start_block": "v01.c01.b0008",
    "end_block": "v01.c01.b0012"
  },
  "status": "accepted",
  "created_change_id": "change_000004",
  "updated_change_ids": []
}
```

第一阶段不强制 `relation_type`。

### 7.7 metrics.jsonl

```json
{
  "id": "metric_d_class_points",
  "series_id": "gray_tower",
  "subject_id": "entity_d_class",
  "name": "D班班级点数",
  "metric_type": "class_points",
  "unit": "points",
  "value_type": "integer",
  "status": "accepted",
  "visible_from": "v01.c01.b0015",
  "source_span": {
    "start_block": "v01.c01.b0015",
    "end_block": "v01.c01.b0015"
  },
  "created_change_id": "change_000005",
  "updated_change_ids": []
}
```

### 7.8 metric_changes.jsonl

```json
{
  "id": "metric_change_d_class_points_v01_c01_001",
  "series_id": "gray_tower",
  "metric_id": "metric_d_class_points",
  "old_value": 0,
  "new_value": 100,
  "delta": 100,
  "reason": "规则说明后公布初始点数。",
  "reason_event_id": "event_v01_c01_exam_announced",
  "valid_from": "v01.c01.b0015",
  "visible_from": "v01.c01.b0015",
  "source_span": {
    "start_block": "v01.c01.b0015",
    "end_block": "v01.c01.b0015"
  },
  "status": "accepted",
  "created_change_id": "change_000006",
  "updated_change_ids": []
}
```

### 7.9 character_cards.jsonl

```json
{
  "id": "card_horikita_v01_end",
  "series_id": "gray_tower",
  "entity_id": "entity_horikita",
  "version_position": "v01.end",
  "short_summary": "成绩优秀但不善社交的D班学生。",
  "reader_memory": "读者此时应记得她与班级制度、同班同学之间的主要关系变化。",
  "source_refs": [
    "fact_horikita_class_v01_c01",
    "event_v01_c01_exam_announced"
  ],
  "visible_from": "v01.end",
  "summary_source": "ai_draft",
  "status": "accepted",
  "created_change_id": "change_000007",
  "updated_change_ids": []
}
```

### 7.10 term_cards.jsonl

```json
{
  "id": "term_card_oaa_v01_c01",
  "series_id": "gray_tower",
  "term_entity_id": "term_oaa",
  "title": "OAA",
  "summary": "学校用于评价学生能力的综合指标。",
  "visible_from": "v01.c01.b0018",
  "source_span": {
    "start_block": "v01.c01.b0018",
    "end_block": "v01.c01.b0020"
  },
  "summary_source": "ai_draft",
  "status": "accepted",
  "created_change_id": "change_000008",
  "updated_change_ids": []
}
```

### 7.11 speaker_labels.jsonl

```json
{
  "id": "speaker_v01_c01_b0002_001",
  "series_id": "gray_tower",
  "block_id": "v01.c01.b0002",
  "speaker_type": "entity",
  "speaker_entity_id": "entity_horikita",
  "display_name": "堀北",
  "confidence": 1.0,
  "visible_from": "v01.c01.b0002",
  "source_span": {
    "start_block": "v01.c01.b0002",
    "end_block": "v01.c01.b0002"
  },
  "status": "accepted",
  "created_change_id": "change_000009",
  "updated_change_ids": []
}
```

`speaker_type` 支持：

```text
entity
narrator
unknown
group
system
ambiguous
```

所有 `speaker_label` 都必须在对话 block 复核时由人工确认后进入 Accepted。AI 只能生成 `speaker_label` Candidate；阅读器不展示高置信 Candidate。

### 7.12 asset_subjects.jsonl

```json
{
  "id": "asset_subject_001",
  "asset_id": "v01_img_001",
  "asset_anchor_id": "asset_anchor_001",
  "subject_type": "entity",
  "entity_id": "entity_horikita",
  "role": "depicted",
  "confidence": 1.0,
  "visible_from": "v01.c01.b0002",
  "status": "accepted",
  "source": "manual",
  "created_change_id": "change_000010",
  "updated_change_ids": []
}
```

### 7.13 changes.jsonl

```json
{
  "id": "change_000001",
  "series_id": "gray_tower",
  "operation": "accept_candidate",
  "target_file": "accepted/events.jsonl",
  "target_type": "event",
  "target_id": "event_v01_c01_exam_announced",
  "candidate_id": "cand_000123",
  "before": null,
  "after": {
    "target_id": "event_v01_c01_exam_announced",
    "summary": "新增事件：特别考试规则公布"
  },
  "reason": "人工确认 AI 候选事件。",
  "source_span": {
    "start_block": "v01.c01.b0008",
    "end_block": "v01.c01.b0012"
  },
  "approved_by": "user",
  "created_at": "2026-06-30T00:00:00Z"
}
```

`operation` 第一阶段支持：

```text
accept_candidate
accept_candidate_with_edit
manual_create
manual_update
merge_entities
deprecate_object
```

## 8. Candidates

统一文件：

```text
candidates/candidates.jsonl
```

当前状态说明：Candidate JSONL 格式仍然有效，validator 仍按本节校验。2026-06-30 的交互验证只否定“逐候选卡片式复核”作为真实制作主流程，不否定 Candidate 作为 AI 草案、fixture、审计前置和异常记录的中间格式。

通用模板：

```json
{
  "id": "cand_v01_c01_b0002_001",
  "series_id": "gray_tower",
  "type": "speaker_label",
  "block_id": "v01.c01.b0002",
  "source_span": {
    "start_block": "v01.c01.b0002",
    "end_block": "v01.c01.b0002"
  },
  "visible_from": "v01.c01.b0002",
  "confidence": 0.88,
  "status": "pending_review",
  "model": "gpt-5",
  "task_id": "task_v01_c01_extract_001",
  "payload": {
    "target_type": "speaker_label",
    "draft": {
      "id": "speaker_v01_c01_b0002_001",
      "series_id": "gray_tower",
      "block_id": "v01.c01.b0002",
      "speaker_type": "entity",
      "speaker_entity_id": "entity_horikita",
      "display_name": "堀北",
      "confidence": 0.88,
      "visible_from": "v01.c01.b0002",
      "source_span": {
        "start_block": "v01.c01.b0002",
        "end_block": "v01.c01.b0002"
      },
      "status": "accepted"
    },
    "evidence": "该句后文动作和上下文指向堀北。",
    "risk_flags": []
  }
}
```

候选类型第一阶段支持：

```text
entity
fact
event
relation_change
speaker_label
metric
metric_change
term_card
character_card
asset_subject
open_question
review_item
```

Candidate 必须有 `source_span`。`block_id` 是主显示位置，可选；若存在，必须落在 `source_span` 内。复核排序按 `source_span.start_block`、`source_span.end_block`、`candidate.id`。

排序规则只定义数据的时间线组织方式，不要求工作台 UI 必须让人工逐条处理所有 Candidate。

Candidate 状态支持：

```text
pending_review
accepted
accepted_with_edit
rejected
converted_to_review_item
converted_to_open_question
superseded
```

普通 Candidate 的 `payload` 必须采用目标对象草案结构：

```json
{
  "target_type": "event",
  "draft": {},
  "evidence": "给人工复核的简短证据说明。",
  "risk_flags": ["source_span_too_wide"]
}
```

`payload.draft` 是未来 Accepted 对象的草案，但不包含 `created_change_id`。OpenQuestion 和 ReviewItem Candidate 可以使用专用 payload，但必须包含 `question` 或 `review_reason`。

## 9. Reports

### 9.1 work_runs.jsonl

`reports/work_runs.jsonl` 记录一次 AI 作业，帮助 Agent 显示已作业和未作业范围。

当前注意：上下文预算应服务作业决策。后续工作台不应只把 token JSON 原样抛给用户，而应提供可读摘要、风险提示和推荐作业范围。

```json
{
  "id": "work_v01_c01_part_001",
  "start_block": "v01.c01.b0001",
  "end_block": "v01.c01.b0032",
  "status": "completed",
  "task_types": ["entity", "speaker_label", "event", "fact"],
  "context_estimate": {
    "text_tokens": 18000,
    "history_tokens": 12000,
    "schema_tokens": 6000,
    "output_budget_tokens": 8000,
    "total_tokens": 44000
  },
  "created_candidate_count": 42,
  "created_at": "2026-06-30T00:00:00Z"
}
```

`task_id` 第一阶段只是 Candidate 内的字符串，用于关联同批候选；不强制反查到 `work_runs`。
