# 日文参考来源规范

中文是唯一主轴，**日文只作为参考渲染内容**。日文不建立独立 block，不参与 `current_block` / `read_boundary` / `visible_from` / `source_span` 等主判定，也不进入 AI 操作主链路。

清洗阶段完成中日对照，把日文文本写在 `source/ja/` 旁挂文件中；Markdown 里只用 `alignment` 注释标记哪些中文 block 参与对齐（见 [markdown-spec.md](markdown-spec.md) §6）。解析器在生成 `parsed/alignments.jsonl` 时把日文合并进去，因此 `alignments.jsonl` 仍是可重复生成产物。

## 1. 文件位置

一卷一个文件：

```text
source/ja/v01.json
```

## 2. 格式

顶层是一个对象，键是 **alignment ID**（与 Markdown 中 `alignment` 注释的 `primary` 一致），值包含可选置信度与日文段落列表。

```json
{
  "v01.c01.a001": {
    "confidence": 0.95,
    "ja_refs": [
      "「今日、クラスポイントが発表されるって聞いたけど、緊張してる？」斜め前の男子が顔を覗かせた。"
    ]
  },
  "v01.c01.a002": {
    "confidence": 0.9,
    "ja_refs": [
      "「今日から、各クラスの初期ポイントは百点とする。」担任は顔を上げ、教室全体を見回した。",
      "「一か月後、ポイント順位に応じて翌月の待遇を調整する。」"
    ]
  }
}
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `<alignment_id>` | — | 顶层键，对应 Markdown `alignment` 注释 ID。 |
| `confidence` | 否 | 对齐置信度（0–1），写入对应 alignment。 |
| `ja_refs[]` | 是 | 日文段落文本数组，顺序即渲染顺序。解析器自动生成每段的 `id` 与 `order`。 |

## 3. 对照模式

模式由「Markdown 中 `blocks` 列出的中文 block 数量」与「`ja_refs` 日文段落数量」共同决定：

| 模式 | 中文 block | 日文段落 |
|---|---|---|
| 一对一 | 1 | 1 |
| 一对多 | 1 | 多 |
| 多对一 | 多 | 1 |

`pending_review` 状态的 alignment（在 Markdown 注释里用 `status: pending_review` 标记）默认不在普通阅读器展示，可用于尚未复核的对照。

## 4. 注意

- `source/ja/` 是清洗者产物；若 manifest 声明 `contains_ja_reference: true` 但某条 alignment 在 ja 源里找不到，解析器记 warning（不阻断）。
- 日文文本不要写进 Markdown 正文或注释，统一放在本文件，保持中文主轴纯净。
