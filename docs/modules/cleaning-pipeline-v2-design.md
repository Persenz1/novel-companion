# 设计：清洗流水线 v2 —— 从 EPUB 到「完美清洗数据」

状态：设计 + P0/P1 已实现（2026-07-02）。实现落点见文末「实现落点」。

原始状态：设计稿（2026-07-02）。动机：清洗产出是下游起草 / 复核 / 阅读的地基；没有完美清洗数据，后面一切都做不好。本文基于首次真实 EPUB（COTE 中译 1-1/1-2/1-3）导入 + MiMo 多模态实跑的结论（见 `real-epub-import-test` 记忆与 `cleaning-pipeline.md`）。

## 1. 「完美」的定义（收口验收清单）

清洗完成 = 同时满足：

1. `validation` 0 error。
2. 无孤立噪声 block（页码、杂散数字、广告页残留）。
3. 场景切分正确（scene marker 就位）。
4. 每张图片：有中文图注 + 锚点对位到正确 block + 已识别主体（可选配名册认人）。
5. 非正文页正确归类（封面 / 目录 / 版权 / 后记 / 特典…），不混进正文时间线。
6. 章节 kind / title 正确。
7. 多卷正确合并为一本书。
8. 以上每一步**人工可审计、可回滚**。

只有验收清单全绿，才允许 compile 并进入起草阶段。

## 2. 为什么现状达不到（真实测试实据）

- importer 忠实解包，但把原书噪声一并带入：**孤立数字**（COTE 用 "1"/"2"/"3" 做场景分隔）被当成正文 paragraph；封面 / 目录 / Logo / 后记 / 特典被当成正文 chapter；章节 kind 全是 chapter。
- MiMo 识图 / 结构判断质量好（认出主角名、剧情细节、Logo 页、图文对位），但：
  - 建议**只写报告、不写回**（除 set-alt 窄路径）——没有应用闭环。
  - 同现象多解读（数字 block 一会 `drop_noise` 一会 `set_scene`）——缺清洗规则。
  - alt 输出语言不统一（中 / 英 / 日 OCR 混）、把「设置 alt 为'…'」指令文字混进 alt 值。

结论：**瓶颈不在识图能力，在规范化规则 + 建议应用器 + 人工裁决 + 收口标准。**

## 3. 五层流水线

```
EPUB
 └─(1) 忠实解包 importer      保序、不丢、不猜语义（图片入序已完成）
 └─(2) 确定性规范化 normalizer 规则明确的直接做，不劳 AI
 └─(3) AI 清洗建议 MiMo        只处理「需要判断」的部分
 └─(4) 裁决队列 + 应用器        建议→人裁决→写回 Markdown/manifest→reparse+validate→记可回滚 change
 └─(5) 收口 gate               验收清单全绿才 compile→进起草
```

分层原则：**确定性信号规则化（省 token、零误判），模糊信号交 AI，AI 建议一律经人裁决再落地。** 这样 AI 只做它擅长的判断，规则做它擅长的确定性，人做最终裁决。

## 4. 组件设计

### (2) 确定性规范化 normalizer（新，parse 前的 Markdown 后处理 pass）

- **孤立分隔符**：block 文本匹配 `^\s*(\d{1,3}|[*※◇◆●・—－─]+|\*(\s*\*){1,3})\s*$` → kind 改 `separator`。这是场景分隔的确定模式，规则化处理，不再喂 AI。
- **强信号非正文页**：由 spine item 的 `epub:type`（cover/toc/colophon/…）、`properties`（nav/cover-image）、文件名（cover/title/logo/message/contents/postscript/ss*）判定 → 直接给 chapter.kind（front-matter / back-matter / nav / extra…）。弱信号（无这些标记、要看内容才知道）留给 AI。
- 产出形式与应用器统一：写 cleaning change（含 before），因确定性可默认应用、仍可回滚。

### (3) AI 清洗建议改进

- prompt 增加**消歧规则**：孤立数字已由 normalizer 处理为 separator，不要再对 separator 提 drop/scene 建议；只提 normalizer 覆盖不到的结构 / 图注 / 图文对位问题。
- **alt 输出规范**：`patch.alt` = 纯中文图注，不含「设置 alt 为」之类指令，限长；不 OCR 整段日文。
- 图片建议必须在 UI 显示图片（补 `workbench-image-review-gap`）。
- 图片主体识别 → 写 `asset_subject`（可选配名册认人）。
- 保留现有八种类型：set_asset_alt / move_asset_anchor / set_scene / set_block_kind / drop_noise / retitle_chapter / split_block / merge_blocks。

### (4) 裁决队列 + 应用器（核心新组件）

- **数据**：`review/cleaning_items.jsonl`（建议 + 状态 open/accepted/rejected/applied）；`accepted/cleaning_changes.jsonl`（应用记录 + before，供回滚）。沿用已落地的批量裁决与 change/rollback 模式。
- **裁决**：复用 resolve / resolve-batch；`risk=low` 且高置信的默认预选「接受」，人一键批量；medium/high 必须人看。图片项必须显示图片。
- **应用器** `applyCleaningSuggestion(type, target, patch)` —— 每类型一个确定的 Markdown/manifest 变换：

  | type | 写回动作 | 风险 |
  |---|---|---|
  | set_asset_alt | 改 asset marker alt（已有 set-alt） | low |
  | move_asset_anchor | 改 asset marker 的 block | low |
  | set_block_kind | 改 block marker kind | low |
  | set_scene | 插入 / 调整 scene marker | low-med |
  | drop_noise | 删除 block marker + 文本 | med |
  | retitle_chapter | 改 chapter marker + manifest title | med |
  | split_block / merge_blocks | 拆 / 合 block | high（先人工，后期自动） |

- **闭环**：应用后自动 reparse + validate；validation 失败则回滚该次应用。
- **幂等**：同建议重复应用不叠加；已 applied 的不再处理。

### (5) 收口 gate

- `GET /api/cleaning/readiness`：跑验收清单，列出未达标项（哪些图无图注、哪些 block 疑似噪声、非正文未归类、validation error…）。
- 全绿才放行 compile。

## 5. 多卷 / 整本

- 1-1/1-2/1-3 → import 为 v01/v02/v03（append 已支持）。
- 清洗按卷做、裁决按卷、收口按全书。文件名不含 v01/v02 时由输入顺序或用户指定卷号。

## 6. 实现顺序

- **P0（闭环骨架，立竿见影）**：normalizer 数字分隔符规则 + 应用器五种低风险写回（set_asset_alt/move_asset_anchor/set_block_kind/set_scene/drop_noise）+ cleaning change log 与回滚 + reparse/validate 闭环。做完就能把 MiMo 已产出的建议真正落到数据上，肉眼可见清洗数据变干净。
- **P1（人审计 + 质量）**：清洗裁决队列 + UI（图片显示、应用前后 diff、批量）；prompt/alt 规则化消歧。
- **P2（补全 + 收口）**：split/merge、强信号非正文归类、图片主体 + 名册、整本多卷汇总、readiness 收口 gate。

## 7. 边界与不做

- 不改写小说正文（清洗只动结构 / 标记 / 图注 / 噪声）。
- 图片身份在清洗阶段定死；操作阶段（纯文本 DeepSeek）直接信任，不把多模态接进 agent（沿用既定边界）。
- 清洗只写 manifest / parsed volumes markdown / assets / reports / review(cleaning_items) / accepted(cleaning_changes)；不碰起草产出的 candidates / accepted 实体。

## 实现落点（2026-07-02 P0/P1）

代码：
- `tools/src/cleaning/markdownEdit.ts`：marker 行的检索 / 属性写入 / block 删除（唯一改 Markdown 的底层，有单测 `markdownEdit.test.ts`）。
- `tools/src/cleaning/epubImport.ts`：`classifyChapterKind` 按强信号（epub:type / properties / 文件名 / 标题）给章节 kind，`BODY_CHAPTER_KINDS` / `isBodyChapterKind` 区分正文与前后杂页。
- `tools/src/cleaning/cleaningStore.ts`：`commitVolumeChange`（快照 md+manifest → 改 → reparse+validate → 失败自动回滚 → 记 `accepted/cleaning_changes.jsonl`）、`rollbackChange`（恢复快照，连带回滚同卷后续 change）、cleaning_items 读写与状态。
- `tools/src/cleaning/normalize.ts`：孤立数字 / 符号 block → separator 的确定规则（`isIsolatedSeparator`）。
- `tools/src/cleaning/applySuggestion.ts`：8 种建议 → Markdown/manifest 变换（低/中风险落地，split/merge 报跳过）；按卷批量提交。
- `tools/src/cleaning/ingest.ts`：MiMo 输出 → cleaning_items 队列（幂等，保留人工裁决状态）。
- `tools/src/cleaning/readiness.ts`：收口验收清单（含占位 alt 识别 `isPlaceholderAlt`）。
- `tools/src/cleaning/mimoFeed.ts`：prompt/alt 规则化（纯中文图注、patch 结构、分隔符消歧）。

CLI：`normalize` / `ingest-cleaning` / `apply-cleaning [ids|--all-low|--one]` / `cleaning-changes` / `rollback-cleaning` / `cleaning-readiness`。

HTTP（server.ts）：`POST /api/cleaning/normalize`、`POST /api/cleaning/ingest`、`GET /api/cleaning/items`（图片类附 url、其它类附 block 预览）、`POST /api/cleaning/items/resolve`、`POST /api/cleaning/items/apply`、`GET /api/cleaning/changes`、`POST /api/cleaning/rollback`、`GET /api/cleaning/readiness`；`auto-start` 导入后自动 normalize，跑完 MiMo 自动 ingest。

UI：`/cleaning/` 新增「裁决队列」页——工具条（规范化 / 取入 / 应用全部低风险）、收口清单、逐条建议（图片类显示图 + 可编辑图注，其它类显示 block 预览，接受/拒绝/应用）、变更历史（可回滚）。

真实 COTE 1-1 验证：章节 kind 全部正确归类；normalize 把 30 个孤立数字 block 归 separator；MiMo 新 prompt 产出纯中文图注（认出主角名）；ingest→apply→写回 Markdown→reparse→validate→readiness 全链通；回滚可逆；tsc 干净、node:test 24/24。

## 仍未做（P2）

- split_block / merge_blocks 自动写回（当前人工）。
- 非正文页从阅读时间线剔除（现已分类 kind，但 timeline 尚未按 `isBodyChapterKind` 过滤）。
- 图片主体识别 → asset_subject（配名册认人）。
- 整本多卷汇总的作业编排。
