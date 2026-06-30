# Compiled 查询规格 v0.1

## 1. 目标

`compiled/reader_index.json` 是从 manifest、Parsed JSONL 和 Accepted JSONL 生成的阅读器查询产物。

它不是人工维护源文件，可以删除并重新生成。阅读器应通过统一查询入口获取增强上下文，而不是自行拼接防剧透逻辑。

## 2. 生成前提

只有在 `reports/validation_report.json` 无 `error` 时，才允许生成 `compiled/reader_index.json`。

Compiler 输出必须包含生成元信息：

```json
{
  "schema_version": "0.1.0",
  "series_id": "gray_tower",
  "generated_at": "2026-06-30T00:00:00Z",
  "source_fingerprint": null,
  "source_summary": {
    "manifest_path": "manifest.json",
    "parsed_files": {
      "blocks": {
        "path": "parsed/blocks.jsonl",
        "count": 35
      }
    },
    "accepted_files": {
      "entities": {
        "path": "accepted/entities.jsonl",
        "count": 5
      }
    }
  },
  "validation_report": {
    "path": "reports/validation_report.json",
    "status": "passed"
  }
}
```

第一阶段不强制计算文件 hash，但保留 `source_fingerprint` 字段供后续扩展。

## 3. 最小结构

`reader_index.json` 第一阶段采用以下顶层结构：

```json
{
  "schema_version": "0.1.0",
  "series_id": "gray_tower",
  "generated_at": "2026-06-30T00:00:00Z",
  "source_fingerprint": null,
  "source_summary": {},
  "validation_report": {},
  "timeline": {
    "positions": [],
    "order": {}
  },
  "blocks": {},
  "scenes": {},
  "assets": {},
  "alignments": {},
  "accepted": {
    "entities": {},
    "facts": {},
    "events": {},
    "relation_changes": {},
    "metrics": {},
    "metric_changes": {},
    "character_cards": {},
    "term_cards": {},
    "speaker_labels": {},
    "asset_subjects": {}
  },
  "index": {
    "by_block": {},
    "by_scene": {},
    "by_entity": {}
  }
}
```

Compiled 可以冗余保存查询副本，但不得成为正式数据源。正式数据仍以 Markdown、Parsed JSONL、Accepted JSONL 为准。

## 4. 时间线位置

第一阶段自动防剧透比较只支持中文正文派生位置：

```text
v01.start
v01.c01.start
v01.c01.b0001
v01.c01.end
v01.end
```

这些位置必须出现在 `timeline.order` 中。比较 `visible_from <= read_boundary` 时，只比较 `timeline.order` 数值，不使用字符串排序。

第一阶段不允许以下位置直接参与正式阅读查询：

```text
semester_1.end
external:*
manual:*
```

这些位置可以作为备注、Review 或 OpenQuestion 信息保存；如果要进入 Accepted 并参与阅读器展示，必须映射到正文时间线位置，例如 `v01.end` 或具体 block。

语义：

- `visible_from: v01.c01.b0002` 表示读完该 block 后可见。
- `read_boundary >= visible_from` 时可见。
- `v01.c01.end` 表示读完整章后可见。
- `v01.end` 表示读完整卷后可见。

## 5. 查询入口

阅读器使用统一查询：

```text
getVisibleContext(current_block, read_boundary, options)
```

参数语义：

- `current_block`：用户当前视口阅读标尺附近的 block，用于当前位置相关性。
- `read_boundary`：防剧透查询边界，用于过滤所有增强数据。
- `options`：日文参考、展示模块、数量限制等阅读器参数。

规则：

1. 查询先判断 `current_block` 和 `read_boundary` 的时间线顺序。
2. 如果 `current_block > read_boundary`，返回 `is_ahead_of_boundary: true`。
3. 无论是否跳读，所有增强数据都必须按 `read_boundary` 过滤。
4. `current_block` 只用于选择当前 block、当前 scene、附近术语、说话人、图片等相关内容，不放宽可见边界。
5. 阅读器只展示 Accepted 数据；Candidates、ReviewItems、OpenQuestions 不进入普通阅读器。

## 6. 返回结构

最小返回结构：

```json
{
  "current_block": {},
  "read_boundary": "v01.c01.b0002",
  "is_ahead_of_boundary": false,
  "current_scene": {},
  "speaker_labels": [],
  "entities": [],
  "facts": [],
  "events": [],
  "relation_changes": [],
  "term_cards": [],
  "character_cards": [],
  "metric_changes": [],
  "assets": [],
  "ja_refs": [],
  "warnings": []
}
```

说明：

- `speaker_labels` 只返回 Accepted speaker labels。
- `character_cards` 返回相关实体在 `read_boundary` 前最新可见版本。
- `ja_refs` 只按当前 block/alignment 返回，不参与中文主时间线判断。
- `warnings` 可包含 compiled 缺失、位置越界、alignment 未复核等非阻断提示。

## 7. 阅读器行为

- compiled 缺失时，阅读器提示需要先编译。
- compiled 的 validation status 不是 `passed` 时，不启用增强阅读。
- Parsed 或 Accepted 改变后，Agent 应提示需要重新编译。
- 第一阶段可以不做 compiled 过期自动检测；后续可通过 `source_fingerprint` 扩展。

## 8. 验收用例

- 较早 `read_boundary` 不返回后文揭示、伏笔解释或未来身份变化。
- `current_block` 跳到终章但 `read_boundary` 仍在第一章时，`is_ahead_of_boundary` 为 true，增强数据仍只按第一章边界返回。
- 手动确认 `read_boundary` 到终章后，才能返回终章可见数据。
- 当前 block 能返回 speaker label、term card、asset。
- 当前 scene 能返回相关人物和事件。
- 角色卡返回 `read_boundary` 前最新可见版本。
