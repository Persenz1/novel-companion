# manifest.json 规范

`manifest.json` 是数据包的身份证与装箱单。它**不存正文，也不存人物事件**，只负责标识数据包、声明系列、列出卷与章节目录、声明包类型与权利范围。

## 1. 最小示例

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
        { "id": "v01.prologue", "order": 0, "kind": "prologue", "title": "序章：灰塔学院" },
        { "id": "v01.c01", "order": 1, "kind": "chapter", "title": "第一章：点数公告" }
      ]
    }
  ],
  "features": {
    "contains_text": true,
    "contains_assets": true,
    "contains_ja_reference": true
  },
  "rights": {
    "usage_scope": "sample_only",
    "rights_note": "原创测试文本，可用于项目测试。"
  }
}
```

## 2. 字段说明

| 字段 | 必需 | 说明 |
|---|---|---|
| `schema_version` | 是 | 数据格式版本，当前 `0.1.0`。 |
| `pack_id` | 是 | 数据包唯一标识。 |
| `pack_name` | 否 | 人类可读名称。 |
| `pack_type` | 是 | `project`（制作包）或 `reader`（阅读包）。清洗阶段一般产出 `project`。 |
| `series.id` | 是 | 系列 ID，会写进每条下游数据。 |
| `series.title` | 否 | 系列标题。 |
| `volumes[]` | 是 | 至少一卷，不能为空。 |
| `volumes[].id` | 是 | 卷 ID，卷间不可重复。 |
| `volumes[].main_text` | 是 | 指向该卷清洗后 Markdown 的相对路径，文件必须存在。 |
| `volumes[].chapters[]` | 是 | 章节目录，**顺序的唯一权威来源**。 |
| `chapters[].id` | 是 | 章节 ID，同卷内不可重复，必须与 Markdown 中 `chapter` 注释一一对应。 |
| `chapters[].order` | 是 | 同卷内章节顺序，不可重复。 |
| `chapters[].kind` | 是 | `prologue` / `chapter` / `epilogue` / `interlude` / `extra` 等。 |
| `chapters[].title` | 否 | 章节标题，建议与 Markdown 一致。 |
| `features` | 否 | 声明是否含正文 / 图片 / 日文参考。`contains_ja_reference: true` 时解析器会期望 `source/ja/`。 |
| `rights` | 否 | 权利与使用范围声明。`rights_note` 为空记 warning。 |

## 3. 校验要点（清洗者需自查）

- `manifest.json` 必须存在且是合法 JSON。
- `pack_type` 必须是 `project` 或 `reader`。
- `volumes` 非空，卷 ID、章节 ID、同卷章节 order 都不重复。
- 每个 `main_text` 文件存在。
- **Markdown 中出现的章节都要在 manifest 声明，manifest 声明的章节都要在 Markdown 出现**（任一缺失记 error）。
- `reader` 包不得包含 `candidates/`、`review/` 等 AI 中间产物目录（清洗阶段通常不涉及）。
