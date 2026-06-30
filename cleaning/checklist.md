# 清洗交付自检清单

清洗产物交付前对照本清单自查。最终以下游校验器（`nc validate`）无 `error` 为准；本清单帮助清洗者在校验前自行发现问题。

## 目录与文件

- [ ] `manifest.json` 存在且是合法 JSON。
- [ ] 每一卷都有对应的 `parsed/volumes/{volume}.md`，且在 manifest `main_text` 指向。
- [ ] 若声明含图片：`assets/images/` 下有对应文件（占位也可），命名为 `{asset_id}.*`。
- [ ] 若声明含日文参考：`source/ja/{volume}.json` 存在。
- [ ] 没有手写 `parsed/*.jsonl`、`accepted/`、`candidates/`、`compiled/`（这些由下游生成）。

## manifest

- [ ] `schema_version`、`pack_id`、`pack_type`、`series.id` 齐全。
- [ ] `pack_type` 是 `project` 或 `reader`。
- [ ] `volumes` 非空；卷 ID、章节 ID、同卷章节 `order` 均不重复。
- [ ] manifest 声明的每个章节都在对应 Markdown 中出现，反之亦然。

## Markdown 结构

- [ ] 每个章节有 `chapter` 注释，紧跟可见标题。
- [ ] 每个 block 有 `block` 注释，ID 前缀与所在章节匹配。
- [ ] block ID 在同章内不重复；插入补块用可排序后缀。
- [ ] 每个 `scene` 都有成对的 `action: start` / `action: end`。
- [ ] scene 不跨章节、不嵌套、不交叉。
- [ ] 每个 `asset` 有 `anchor_type` 和 `block`，且 `block` 指向存在的 block。
- [ ] 每个 `alignment` 的 `blocks` 都指向存在的中文 block。

## 注释格式

- [ ] 所有 marker 都是单行 HTML 注释，`<!--` 开头、`-->` 结尾。
- [ ] 带空格/冒号/复杂标点的值都用双引号包裹。
- [ ] 多值字段（如 `blocks:`）逗号分隔且不加空格。
- [ ] 没有把复杂结构（JSON、多行内容）塞进注释。

## 中日对照（如有）

- [ ] 日文文本只在 `source/ja/`，没有混进 Markdown。
- [ ] `source/ja/` 的键与 Markdown `alignment` ID 对应。
- [ ] 覆盖到所需的对照模式（一对一 / 一对多 / 多对一 / pending_review）。

## 内容质量（建议项）

- [ ] 数值在正文中前后自洽（如班级点数基线与变化能对上）。
- [ ] `kind: dialogue` 的 block 确实含引号对白；纯旁白用 `paragraph`。
- [ ] 需要独立防剧透定位的事实/数值/身份揭示已拆到单独 block。

## 返工闭环

清洗产物若未通过校验，按 `reports/validation_report.json` 中每条问题的 `suggested_action` 修复，再次校验，直到无 `error`。`warning` 不阻断，但应尽量清理或确认。
