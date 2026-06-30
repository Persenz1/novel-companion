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
    review_items.jsonl
    open_questions.jsonl
  compiled/
    reader_index.json
  reports/
    cleaning_report.json
    validation_report.json
```

## 2. Markdown 主文本

一卷一个 Markdown 文件：

```text
parsed/volumes/v01.md
```

注释采用单行键值格式：

```md
<!-- chapter: v01.c01 kind: chapter title: "第一章 试探" -->
# 第一章 试探

<!-- scene: start v01.c01.s001 title: "教室里的通知" -->

<!-- block: v01.c01.b0001 kind: paragraph -->
今天的教室有些安静。

<!-- block: v01.c01.b0002 kind: dialogue -->
「你知道今天要公布什么吗？」她问。

<!-- alignment: v01.c01.a001 blocks: v01.c01.b0002 -->

<!-- asset: v01_img_001 anchor: after v01.c01.b0002 alt: "教室插图" -->
![教室插图](../../assets/images/v01_img_001.jpg)

<!-- scene: end v01.c01.s001 -->
```

`value` 如果有空格、冒号或复杂标点，使用双引号。

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
  "review_status": "unreviewed",
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

## 6. Accepted JSONL

### 6.1 entities.jsonl

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
  }
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

### 6.2 facts.jsonl

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
  "status": "accepted"
}
```

`value_type` 支持：

```text
string
entity
number
boolean
```

### 6.3 events.jsonl

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
  "status": "accepted"
}
```

`importance` 支持：

```text
critical
major
minor
background
```

### 6.4 relation_changes.jsonl

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
  "status": "accepted"
}
```

第一阶段不强制 `relation_type`。

### 6.5 metrics.jsonl

```json
{
  "id": "metric_d_class_points",
  "series_id": "gray_tower",
  "subject_id": "entity_d_class",
  "name": "D班班级点数",
  "metric_type": "class_points",
  "unit": "points",
  "value_type": "integer",
  "status": "accepted"
}
```

### 6.6 metric_changes.jsonl

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
  "status": "accepted"
}
```

### 6.7 character_cards.jsonl

```json
{
  "id": "card_horikita_semester_1_end",
  "series_id": "gray_tower",
  "entity_id": "entity_horikita",
  "version_position": "semester_1.end",
  "short_summary": "成绩优秀但不善社交的D班学生。",
  "reader_memory": "读者此时应记得她与班级制度、同班同学之间的主要关系变化。",
  "source_refs": [
    "fact_horikita_class_v01_c01",
    "event_v01_c01_exam_announced"
  ],
  "visible_from": "semester_1.end",
  "summary_source": "ai_draft",
  "status": "accepted"
}
```

### 6.8 term_cards.jsonl

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
  "status": "accepted"
}
```

### 6.9 speaker_labels.jsonl

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
  "status": "accepted"
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

### 6.10 asset_subjects.jsonl

```json
{
  "id": "asset_subject_001",
  "asset_id": "v01_img_001",
  "subject_type": "entity",
  "entity_id": "entity_horikita",
  "role": "depicted",
  "confidence": 1.0,
  "status": "accepted",
  "source": "manual"
}
```

### 6.11 changes.jsonl

```json
{
  "id": "change_000001",
  "series_id": "gray_tower",
  "operation": "accept_candidate",
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
  "created_by": "user",
  "created_at": "2026-06-30T00:00:00Z"
}
```

## 7. Candidates

统一文件：

```text
candidates/candidates.jsonl
```

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
    "speaker_type": "entity",
    "speaker_entity_id": "entity_horikita",
    "display_name": "堀北"
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

`payload` 应尽量贴近目标 Accepted 对象结构。

