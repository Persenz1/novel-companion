# 校验规格 v0.1

> 2026-06-30 状态覆盖：阶段 5-8 清洗后操作逻辑已由 `docs/post-cleaning-operation-design-v0.2.md` 定案。凡本文仍出现「逐候选人工复核」「AI 不得写 Accepted」「待重构 / 暂停实现」等旧口径，均以 v0.2 为准：AI 起草 + 独立 AI 复核后可自动写 Accepted，但必须生成可追溯、可回滚 Change，高风险项升级给人裁决。

## 1. 目标

校验器负责保证数据包不会以损坏、不一致或突破防剧透边界的状态进入下一阶段。

校验器同时要生成可供清洗 AI 返工的报告，而不仅是给人看的错误列表。

## 2. 输出文件

校验报告写入：

```text
reports/validation_report.json
```

最小结构：

```json
{
  "status": "failed",
  "errors": [
    {
      "code": "BLOCK_ID_DUPLICATE",
      "severity": "error",
      "message": "block id 重复：v01.c01.b0003",
      "file": "parsed/volumes/v01.md",
      "line": 42,
      "block_id": "v01.c01.b0003",
      "suggested_action": "为第二个重复 block 重新分配稳定 ID，并同步更新引用。"
    }
  ],
  "warnings": [
    {
      "code": "CHAPTER_TITLE_MISMATCH",
      "severity": "warning",
      "message": "Markdown 标题与 manifest title 不一致。",
      "file": "parsed/volumes/v01.md",
      "line": 12,
      "chapter_id": "v01.c01",
      "suggested_action": "确认以 manifest 还是 Markdown 标题为准。"
    }
  ]
}
```

## 3. 严重级别

`error`：

- 阻断进入下一阶段。
- 阻断编译或导入。

`warning`：

- 不阻断。
- 必须写入报告。
- 可由人工或 AI 后续清理。

## 4. 报告字段

每条问题尽量包含：

- `code`
- `severity`
- `message`
- `file`
- `line`
- `block_id`
- `chapter_id`
- `object_id`
- `suggested_action`

不是每个字段都必填，但校验器应尽力定位到可修复位置。

## 5. manifest 校验

错误：

- `manifest.json` 不存在。
- `schema_version` 缺失。
- `pack_id` 缺失或非法。
- `pack_type` 不是 `project` 或 `reader`。
- `series.id` 缺失。
- `volumes` 为空。
- `volumes[].id` 重复。
- `volumes[].main_text` 文件不存在。
- `chapters[].id` 重复。
- `chapters[].order` 在同卷内重复。
- `pack_type: "reader"` 中出现 `candidates/`、`review/` 或 AI 中间产物目录。

警告：

- `rights.rights_note` 为空。
- `features` 与实际文件不一致但不影响主流程。

## 6. Markdown 校验

错误：

- Markdown 中的 chapter 未在 manifest 声明。
- manifest 声明的章节未在 Markdown 中出现。
- block ID 重复。
- block ID 前缀不匹配当前 chapter。
- 同章 block 顺序不可解析。
- scene 嵌套。
- scene 交叉。
- scene 跨章节。
- scene end 找不到对应 start。
- asset 注释引用不存在的 block。
- 已识别 HTML 注释不符合 `tag: primary key: value` 格式。
- scene 注释缺少 `action: start` 或 `action: end`。
- asset 注释缺少 `anchor_type` 或 `block`。

警告：

- Markdown 标题与 chapter 注释 title 不一致。
- block kind 省略。
- 未识别的 HTML 注释标记。

## 7. Parsed JSONL 校验

错误：

- JSONL 某行不是合法 JSON。
- `blocks.jsonl` 中 block ID 重复。
- `blocks.jsonl` 引用不存在的 chapter。
- `scenes.jsonl` 引用不存在的 block。
- `assets.jsonl` 中 asset ID 重复。
- `asset_anchors.jsonl` 引用不存在的 asset 或 block。
- `alignments.jsonl` 引用不存在的中文 block。

警告：

- alignment 置信度低。
- alignment 状态不是 `reviewed`。
- asset 文件路径不存在但 manifest 声明不含 assets。

## 8. Accepted 校验

错误：

- Accepted 对象 ID 重复。
- Accepted 对象 `status` 不是 `accepted`、`deprecated` 或 `merged`。
- 引用不存在的 entity、event、metric、asset 或 block。
- `visible_from` 引用无效位置。
- `valid_from` / `valid_until` 引用无效位置。
- `source_span` 引用不存在的 block。
- `metric_change` 数值字段类型错误。
- `value_type: "entity"` 的 Fact 缺少 `value_entity_id`。
- 普通 Accepted 对象缺少 `created_change_id`。
- `created_change_id` 或 `updated_change_ids` 引用不存在的 Change。
- `created_change_id` 对应 Change 的 `target_id` 与 Accepted 对象 ID 不一致。
- `created_change_id` 对应 Change 的 `target_file` 与对象所在文件不一致。
- Change 缺少 `target_file`、`target_type`、`target_id`、`operation`、`approved_by` 或 `created_at`。
- `operation: "accept_candidate"` 或 `operation: "accept_candidate_with_edit"` 缺少有效 `candidate_id`。
- `target_type` 与 `target_file` 不符合 Accepted 类型到文件映射。
- `asset_subject` 缺少 `visible_from`、`asset_id`、`asset_anchor_id`、`source` 或 `created_change_id`。
- `character_card` 既没有 `source_span` 也没有 `source_refs`。
- `character_card.source_refs` 引用的 Accepted 对象不存在。

警告：

- Event 没有关联参与者。
- CharacterCard 没有 `source_refs`。
- RelationChange 没有关联 event。
- SpeakerLabel 置信度低但进入 Accepted。
- `character_card.source_refs` 引用链无法追溯到中文正文 block。

## 9. Candidates 校验

本节只定义 Candidate JSONL 的格式和引用完整性校验，不代表最终工作台必须采用逐候选人工点击流程。阶段 5-8 操作逻辑以 `docs/post-cleaning-operation-design-v0.2.md` 为准。

错误：

- Candidate 缺少 `id`。
- Candidate 缺少 `type`。
- Candidate 缺少 `source_span`。
- Candidate 的 `source_span.start_block` 或 `source_span.end_block` 引用不存在的 block。
- Candidate 的 `source_span` 顺序非法。
- Candidate 有 `block_id` 但 `block_id` 不在 `source_span` 范围内。
- Candidate 缺少 `visible_from`。
- Candidate 缺少 `confidence`。
- Candidate 缺少 `model`。
- Candidate 缺少 `task_id`。
- Candidate 缺少 `payload`。
- 普通 Candidate 缺少 `payload.target_type` 或 `payload.draft`。
- Candidate 的 `payload.target_type` 与 `type` 不可映射。
- Candidate 的 `payload.draft.source_span` 不在 Candidate `source_span` 范围内。
- Candidate 的 `payload.draft.visible_from` 早于 Candidate `visible_from`。

警告：

- Candidate payload 不贴近目标对象结构。
- Candidate confidence 低于工作台默认阈值。

## 10. Review 校验

错误：

- `review/block_progress.jsonl` 中 `block_id` 不存在。
- `block_progress.status` 不在允许枚举中。
- `review_items.jsonl` 中 `source_span` 引用无效 block。
- `review_items.status` 不在允许枚举中。
- `open_questions.jsonl` 中 `source_span` 引用无效 block。
- `open_questions.status` 不在允许枚举中。
- `open_question.revisit_after` 不是第一阶段可比较时间线位置。
- `open_question.resolved_by_change_id` 引用不存在的 Change。

警告：

- `block_progress.candidate_count` 与实际 Candidate 数量不一致。
- `block_progress.status` 是 `reviewed` 但仍有关联 open ReviewItem。

## 11. Compiled 校验

错误：

- `compiled/reader_index.json` 缺少 `schema_version`、`series_id`、`timeline` 或 `accepted`。
- `timeline.order` 缺少 Accepted 引用的 `visible_from`、`valid_from` 或 `valid_until` 位置。
- compiled 声明的 validation report status 不是 `passed`。

警告：

- compiled 缺少 `source_summary`。
- compiled 的生成时间早于最近的 Parsed 或 Accepted 文件修改时间。第一阶段可只提示，不阻断。

## 12. 返工闭环

清洗和候选生成流程应形成：

```text
生成
-> 校验
-> 输出 validation_report.json
-> AI 或人工按报告修复
-> 再校验
```

校验器报告中的 `suggested_action` 应尽量明确，方便清洗 AI 直接修改。
