# 项目阶段提示词 v0.1

本文件用于在新窗口、其他模型或后续工作会话中快速接续项目。每个阶段提示词都包含目标、输入文档、任务范围和验收标准。

## 使用规则

先复制“通用接手提示词”，再按任务选择一种提示词，不要混用。

- `0.x 独立提示词`：用于并行分工或只做某个模块，例如只做 Parser、只做测试文本、只做阅读器。它们是模块边界提示词。
- `1-10 阶段提示词`：用于按第一阶段闭环线性推进。它们是阶段任务提示词。
- 如果一个任务已经有对应的 `0.x 独立提示词`，优先使用对应独立提示词，不要再叠加相近阶段提示词。
- 如果是端到端验收，使用阶段十。

当前特别注意：阶段 5-8 清洗后操作逻辑已重构定案，见 `docs/post-cleaning-operation-design-v0.2.md`（AI 驱动 + 独立 AI 复核 + 人审计异常，取代旧的逐候选工作台）。`0.3 清洗后文本操作 Agent` 以及阶段五、阶段六、阶段八的提示词已按 v0.2 口径更新，实现前必须先读该设计文档。

当前代码进度必须先读 `docs/project-progress-audit-2026-06-30.md`。代码事实：工作台已有本地真实 LLM 试跑反馈，但仓库自动测试不调用模型、不提交 API key；真实书籍长程制作、第二卷前文上下文压缩 / 检索、最低限度 Markdown 阅读器仍未完成。

## 0. 通用接手提示词

```text
你正在接手 `novel-companion` 项目。

请先阅读并遵守以下文档：

- docs/requirements-v0.3.md
- docs/phase-1-implementation-spec.md
- docs/phase-1-design-decisions-v0.1.md
- docs/data-format-v0.1.md
- docs/validation-spec-v0.1.md
- docs/workflow-spec-v0.1.md
- docs/agent-operation-spec-v0.1.md
- docs/compiled-query-spec-v0.1.md
- docs/test-book-gray-tower.md
- docs/discussion-archive-2026-06-30.md
- docs/phase-5-8-operation-redesign-note.md
- docs/post-cleaning-operation-design-v0.2.md
- docs/project-progress-audit-2026-06-30.md

项目当前阶段不是做完整桌面应用，而是跑通第一阶段闭环：

原创测试书 -> 清洗 Markdown -> Parsed JSONL -> 硬校验 -> AI Candidates -> block 复核 -> Accepted 数据 -> Compiled 查询 -> Markdown 阅读器验证。

请优先遵守以下原则：

- 中文文本是唯一主轴。
- 日文只作为参考渲染内容，不进入主操作链。
- 阅读器查询使用 read_boundary 过滤增强数据（既有机制）。防剧透不是核心卖点；清洗后制作阶段由分卷逐本录入天然约束剧透风险，不对每条草案设严格剧透闸门，详见 `docs/post-cleaning-operation-design-v0.2.md` §5。
- 清洗后操作采用「AI 起草 + 独立 AI 复核 + 人审计异常」：AI 经复核后可自动写 Accepted，但每次写入必须是可追溯、可回滚的 Change，且规定的高风险类别（实体合并、歧义说话人、关系变化、伏笔/隐藏身份、数值冲突、图中人物身份）必须升级给人裁决。
- Accepted 正式数据必须可追溯；默认追溯到中文正文 block，图片主体等例外必须能通过 asset anchor 回到正文位置。
- 第一阶段先用 JSON/JSONL 和 Markdown，不急着上 SQLite 或完整桌面应用。
- 不要实现 candidate-by-candidate 的逐候选复核 UI（旧方案已回滚）。人的主操作面是异常队列 + Change 审计 + 整批回滚，不是逐条候选按钮。
- 仓库测试不得依赖或提交 API key；真实 LLM 试跑只能提交脱敏记录、问题清单和代码修正。
- 第二卷及后续卷尚未验证前文上下文压缩 / 检索策略；不要假设“整卷背景”已经解决跨卷连续性。
- 最低限度 Markdown 阅读器尚未实现，Compiled 查询接口不是阅读器 UI。

工作时请保持改动聚焦。若需要新增文件，请优先放在 docs/、samples/gray-tower/ 或后续约定的工具目录中。
```

## 0.1 并行分工规则

```text
如果多个模型或窗口并行工作，必须按模块解耦：

1. 测试文章/样例 bookpack 任务只改 samples/gray-tower/ 和必要样例数据。
2. Parser 任务只负责 Markdown -> Parsed JSONL，不写 Accepted。
3. Validator 任务只负责校验和 reports/validation_report.json，不修改业务数据，除非明确要求实现自动修复。
4. 内置制作 Agent 任务按 `docs/post-cleaning-operation-design-v0.2.md` 实现起草/复核/自动写入/回滚接口，不实现逐候选工作台；不得擅自改变数据格式规范。
5. 阅读器任务只读 manifest、Markdown、Parsed、Compiled 或 mock reader_index，不修改 schema、parser、validator。

如果发现数据格式不够用，先记录到 notes 或报告，不要在实现任务中擅自改 schema。
```

## 0.2 测试文章独立提示词

```text
你只负责《灰塔学院测试卷》的原创测试文章和样例 bookpack 内容。

请阅读：

- docs/test-book-gray-tower.md
- docs/data-format-v0.1.md
- docs/requirements-v0.3.md

任务边界：

- 可以创建或修改 samples/gray-tower/manifest.json。
- 可以创建或修改 samples/gray-tower/parsed/volumes/v01.md。
- 可以创建必要的空 JSONL 占位文件。
- 不实现 parser、validator、reader。
- 不修改 docs 中的数据格式规则。

验收：

- 文本完全原创。
- 覆盖人物、组织、对话、事件、关系变化、数值变化、术语、伏笔、跳读剧透风险。
- chapter/block/scene 注释符合 data-format-v0.1.md。
- 每章至少 5 个 block，全卷至少 35 个 block。
- 覆盖 test-book-gray-tower.md 中的第一阶段硬验收指标。
```

## 0.3 清洗后文本操作 Agent 独立提示词

```text
你负责实现清洗后文本操作阶段的内置制作 Agent，采用 AI 驱动 + 独立 AI 复核 + 人审计异常的架构。

请先阅读（设计以 v0.2 为准）：

- docs/post-cleaning-operation-design-v0.2.md   ← 操作逻辑定案，最优先
- docs/agent-operation-spec-v0.1.md             ← 工具接口与安全边界（逐候选章节已被 v0.2 取代）
- docs/workflow-spec-v0.1.md
- docs/data-format-v0.1.md
- docs/validation-spec-v0.1.md
- docs/phase-1-design-decisions-v0.1.md

目标：

实现双 AI 流水线，使清洗后正文能被自动结构化制作，人只做异常裁决和审计，不做逐候选点击。

任务：

1. 起草 Agent（Drafter）：按选定 range 读正文 + 受控上下文，调用 AI 生成结构化草案，
   写入 candidates/candidates.jsonl（候选作为内部中间格式），带 confidence 和 risk_flags。
2. 复核 Agent（Reviewer）：对每条草案做独立一次推理（独立 prompt/上下文/独立模型），
   核对正文依据、与已有 Accepted 的一致性、叙述正确性，判定路由：
   - 通过且低风险      -> 自动写 Accepted + Change（标记 auto_accepted、reviewer_model、work_run_id）
   - 通过但属升级清单  -> 进异常队列（ReviewItem），等人裁决
   - 不通过            -> 拒绝或退回起草，记录原因
   路由靠复核 Agent 的自然语言判断（证据是否充分 + 是否属高风险类别），不设数值置信阈值。
3. 必须升级给人裁决的高风险类别：实体合并、歧义说话人、关系变化、
   伏笔/隐藏身份/误导叙述、数值冲突或与已有 Accepted 冲突、图片人物身份识别、复核自身拿不准的草案。
4. 受控自动写入：autoAccept 必须强制生成 Change；当前实现已有单 Change / 整批 work_run 回滚，单对象专用入口和 update/merge/deprecate 的 before 快照恢复仍需补齐。
5. 模型配置：起草与复核各配一个模型、可跨厂商（如起草 ds4flash、复核 dsv4pro 或 mimov2.5），
   复核模型必须不同于起草模型；换模型只改本地配置不改流程。无信任档位、无数值阈值。
6. 写 work_run，记录范围、上下文预算、自动/升级/拒绝计数与 drafter_model/reviewer_model。
7. 防剧透轻量处理：visible_from 按草案自身位置生成，不设严格剧透闸门（v0.2 §5）。
8. 触发 compiler 重新生成 reader_index。

边界：

- 不实现 candidate-by-candidate 的逐候选复核 UI。
- 人的主操作面是异常队列 + Change 审计 + 整批回滚。
- 复核 Agent 不能是起草同一次调用的顺手自查。
- 自动写入必须可追溯、可回滚。

验收：

- 起草 -> 复核 -> 自动落盘 -> 异常升级 -> 回滚 全链路能用 gray-tower 夹具跑通。
- 自动写入的 Accepted 每条都有对应 Change，且能按对象/Change/work_run 回滚。
- 升级项带人话决策信息（为什么需要你看 + 正文片段 + 推荐操作 + 冲突对象）。
- 起草与复核模型分离可配，复核模型不同于起草模型；实体合并始终人裁决。
```

## 0.4 Parser 独立提示词

```text
你只负责 Markdown parser。

请阅读：

- docs/data-format-v0.1.md
- docs/validation-spec-v0.1.md

任务边界：

- 输入 manifest 和 parsed/volumes/*.md。
- 输出 parsed/blocks.jsonl、scenes.jsonl、assets.jsonl、asset_anchors.jsonl、alignments.jsonl、reports/cleaning_report.json。
- 不生成 Candidates。
- 不写 Accepted。
- 不实现阅读器。

验收：

- 能稳定解析 samples/gray-tower。
- JSONL 每行合法。
- block text 不包含 HTML 注释。
- scene `action: start/end` 正确。
- 重复运行结果稳定。
```

## 0.5 Validator 独立提示词

```text
你只负责硬校验器。

请阅读：

- docs/validation-spec-v0.1.md
- docs/data-format-v0.1.md

任务边界：

- 读取 manifest、Markdown、Parsed、Candidates、Accepted。
- 输出 reports/validation_report.json。
- 不修改业务数据。
- 不写 Accepted。
- 不实现 parser 的生成逻辑，除非已有 parser 接口可调用。

验收：

- 合法样例无 error。
- 重复 block ID 能报 error 并定位。
- chapter/manifest 不匹配能报 error 或 warning。
- 报告包含 suggested_action，能给清洗 AI 返工。
```

## 0.6 阅读器独立提示词

```text
你只负责最小 Markdown 阅读器原型。

请阅读：

- docs/phase-1-implementation-spec.md
- docs/data-format-v0.1.md
- docs/project-prompts-v0.1.md 中阶段九

任务边界：

- 可以读取 manifest、parsed/volumes/v01.md、parsed/*.jsonl、compiled/reader_index.json。
- 在真实 compiled 产物未完成前，可以使用 mock reader_index.json。
- 不修改 schema。
- 不修改 parser。
- 不修改 validator。
- 不修改样例 bookpack 的数据格式。

验收：

- 渲染 Markdown 并隐藏 HTML 注释。
- DOM 或内部结构保留 block ID。
- 计算 current_block。
- 维护 read_boundary。
- 慢速阅读自动推进 read_boundary。
- 快速跳读不推进 read_boundary。
- current_block 超过 read_boundary 时右侧保守提示。
- 支持“标记至当前 block 为已读”和“返回 read_boundary”。
- 停留时间阈值可调。
```

## 1. 阶段一：创建测试书包骨架

```text
目标：
创建原创测试书《灰塔学院测试卷》的 bookpack 骨架，用于第一阶段闭环验证。

请阅读：

- docs/data-format-v0.1.md
- docs/test-book-gray-tower.md
- docs/phase-1-implementation-spec.md

任务：

1. 创建 `samples/gray-tower/` 目录结构：
   - manifest.json
   - parsed/volumes/v01.md
   - parsed/*.jsonl 占位或初始文件
   - accepted/*.jsonl 占位或初始文件
   - candidates/candidates.jsonl
   - review/block_progress.jsonl
   - review/review_items.jsonl
   - review/open_questions.jsonl
   - reports/work_runs.jsonl
   - reports/
   - compiled/
   - assets/images/
2. 编写最小可用 `manifest.json`。
3. 在 `parsed/volumes/v01.md` 中写入章节骨架和少量示例 block，必须包含：
   - v01.prologue
   - v01.c01
   - v01.c02
   - v01.c03
   - v01.epilogue
4. 使用规定的 HTML 注释格式标记 chapter、block、scene。
5. 暂不需要写完整小说，只需能支撑 parser 和 validator 初步测试。

验收标准：

- 目录结构符合 data-format-v0.1.md。
- manifest 中章节列表与 Markdown 章节一致。
- Markdown 中每个 block ID 合法，且每章从 b0001 开始。
- 至少包含一个 `scene action: start/end`。
- 至少包含一个 dialogue block。
- 不引入真实版权文本。
```

## 2. 阶段二：扩写原创测试正文

```text
目标：
把《灰塔学院测试卷》扩写成可覆盖关键功能的短篇测试文本。

请阅读：

- docs/test-book-gray-tower.md
- docs/data-format-v0.1.md
- docs/requirements-v0.3.md

任务：

1. 扩写 `samples/gray-tower/parsed/volumes/v01.md`。
2. 文本必须原创，不能引用真实作品正文。
3. 覆盖以下测试点：
   - 人物初登场
   - 班级或组织
   - 对话说话人
   - 一次规则公告事件
   - 一次数值出现或变化
   - 一次关系变化
   - 一个术语解释入口
   - 一个伏笔，后文才揭示
   - 一处跳读会造成剧透风险的后文内容
4. 保持 block 粒度自然段优先；需要独立剧透定位时可人工拆分。
5. 保留 chapter、scene、block 注释。

验收标准：

- 每章至少 5 个 block。
- 全卷至少 35 个 block。
- 至少 8 个 dialogue block。
- 至少 4 个 scene。
- 至少 1 个后文揭示前文伏笔的设计。
- 文本能用于测试 read_boundary 和 current_block。
```

## 3. 阶段三：实现 Markdown Parser

```text
目标：
实现解析器，把清洗后的 Markdown 主文本解析为 Parsed JSONL。

请阅读：

- docs/data-format-v0.1.md
- docs/validation-spec-v0.1.md

任务：

1. 实现一个本地解析工具，读取 bookpack 的 manifest 和 parsed/volumes/*.md。
2. 解析以下 HTML 注释：
   - chapter
   - block
   - scene action: start/end
   - asset
   - alignment
3. 生成：
   - parsed/blocks.jsonl
   - parsed/scenes.jsonl
   - parsed/assets.jsonl
   - parsed/asset_anchors.jsonl
   - parsed/alignments.jsonl
   - reports/cleaning_report.json
4. blocks.jsonl 必须保存中文正文副本。
5. 注释不应进入 block text。
6. 未识别注释先作为 warning 信息保留，不直接中断解析。

验收标准：

- 能解析 samples/gray-tower。
- 生成的 JSONL 每行都是合法 JSON。
- blocks.jsonl 的 block 数量和 Markdown 注释一致。
- scenes.jsonl 的 `action: start/end` 对应 block 正确。
- block 的 chapter_id、volume_id、order 正确。
- blocks.jsonl 不保存 review_status；block 进度属于 review/block_progress.jsonl。
- 重复运行结果稳定。
```

## 4. 阶段四：实现硬校验器

```text
目标：
实现第一阶段硬校验器，并输出可供 AI 返工的 validation_report.json。

请阅读：

- docs/validation-spec-v0.1.md
- docs/data-format-v0.1.md

任务：

1. 校验 manifest：
   - 必填字段
   - volume/chapter 唯一性
   - main_text 文件存在
2. 校验 Markdown 和 Parsed：
   - chapter 是否与 manifest 匹配
   - block ID 是否唯一
   - block ID 是否匹配当前 chapter
   - scene 是否嵌套、交叉、跨章节
   - JSONL 每行是否合法
3. 校验引用：
   - asset anchor 引用存在的 asset 和 block
   - alignment 引用存在的中文 block
   - Accepted / Candidate / Review 引用存在的 block/entity/event/metric/change
   - Accepted 对象的 created_change_id 和 Change 审计链
   - Candidate 的 source_span、payload.draft、visible_from
   - reader 包不包含 candidates/review/open_questions 或 AI 中间产物
4. 输出 `reports/validation_report.json`。
5. 每条问题尽量包含 code、severity、message、file、line、block_id/chapter_id/object_id、suggested_action。

验收标准：

- 对合法 samples/gray-tower 输出 passed 或仅 warnings。
- 人工制造重复 block ID 时能报 error 并指出位置。
- 人工制造 chapter 不匹配时能报 error 或 warning。
- 报告结构符合 validation-spec-v0.1.md。
- error 会阻断后续编译；warning 不阻断。
```

## 5. 阶段五：生成 AI Candidates 样例

```text
【按 v0.2 实施】

本阶段生成 AI Candidates。候选已定位为「起草 Agent 到复核 Agent」之间的内部中间格式，不是人工逐条点击的对象。实现前先读 `docs/post-cleaning-operation-design-v0.2.md`，候选由起草 Agent 产出后交复核 Agent 路由（自动落盘 / 升级 / 拒绝）。fixture 仍可用于格式验证。

目标：
基于《灰塔学院测试卷》生成一批候选数据样例，验证 Candidates 格式和工作台复核流程。

请阅读：

- docs/data-format-v0.1.md
- docs/workflow-spec-v0.1.md
- docs/phase-1-design-decisions-v0.1.md
- samples/gray-tower/parsed/blocks.jsonl

任务：

1. 如仅为格式夹具，可以生成 `samples/gray-tower/candidates/candidates.jsonl`。
2. 如为真实操作流设计，不要只生成大量逐条候选；应先设计聚合、批处理和异常队列。
3. 候选类型至少包含：
   - entity
   - fact
   - event
   - relation_change
   - speaker_label
   - metric
   - metric_change
   - term_card
   - character_card
   - asset_subject
   - review_item
   - open_question
4. 每条 Candidate 必须包含：
   - id
   - series_id
   - type
   - source_span
   - visible_from
   - confidence
   - status
   - model
   - task_id
   - payload
5. block_id 只是主显示位置，可选；若存在，必须落在 source_span 内。
6. 普通 Candidate 的 payload 必须包含 target_type、draft、evidence、risk_flags。
7. AI 可提出新 entity ID，但不能写 Accepted。
8. 所有 speaker_label 只作为 Candidate，必须在对话 block 复核时由人工确认后才进入 Accepted。

验收标准：

- candidates.jsonl 每行合法 JSON。
- 至少 25 条候选。
- 每条候选有有效 source_span。
- 至少 3 条低置信候选。
- 至少 2 条冲突或疑似重复候选。
- 至少包含一个 open_question。
- 至少包含一个 review_item。
```

## 6. 阶段六：制作 Accepted 样例数据

```text
【按 v0.2 实施】

本阶段把候选转为 Accepted 数据。真实流程由复核 Agent 自动写入（经独立复核、生成 Change、可回滚），高风险类别升级给人裁决，不再是「逐条候选转 Accepted」。实现前先读 `docs/post-cleaning-operation-design-v0.2.md`。fixture 仍可用于 validator/compiler/query 测试。

目标：
模拟人工复核，把一部分 Candidates 转成 Accepted 数据，并生成 Change 记录。

请阅读：

- docs/data-format-v0.1.md
- docs/workflow-spec-v0.1.md
- docs/phase-1-design-decisions-v0.1.md

任务：

1. 基于 candidates，手工或脚本生成 Accepted JSONL：
   - accepted/entities.jsonl
   - accepted/facts.jsonl
   - accepted/events.jsonl
   - accepted/relation_changes.jsonl
   - accepted/metrics.jsonl
   - accepted/metric_changes.jsonl
   - accepted/term_cards.jsonl
   - accepted/speaker_labels.jsonl
   - accepted/character_cards.jsonl
   - accepted/asset_subjects.jsonl
   - accepted/changes.jsonl
2. 每条 Accepted 数据必须有 source_span，或符合 character_card source_refs / asset_subject asset_anchor_id 例外规则。
3. 每条 Accepted 数据必须有 created_change_id。
4. 每次接受、修改、合并、弃用正式对象都写入 changes.jsonl。
5. Change 必须包含 target_file、target_type、target_id、operation、approved_by、created_at。
6. 不确定内容进入 review/open_questions.jsonl。

验收标准：

- Accepted 对象引用全部有效。
- 每条正式增强数据有 source_span，或符合 character_card source_refs / asset_subject asset_anchor_id 例外规则。
- 每条正式增强数据有 created_change_id。
- changes.jsonl 至少 10 条。
- 至少一个候选被拒绝或转为 open_question。
- validator 能通过 Accepted 基础校验。
```

## 7. 阶段七：实现 Compiled 查询产物

```text
目标：
从 Parsed 和 Accepted 编译出阅读器可查询的 `compiled/reader_index.json`。

请阅读：

- docs/phase-1-implementation-spec.md
- docs/data-format-v0.1.md
- docs/compiled-query-spec-v0.1.md

任务：

1. 编写编译工具，读取 manifest、parsed/*.jsonl、accepted/*.jsonl。
2. 只有 validation report 无 error 时输出 `compiled/reader_index.json`。
3. 实现或模拟查询函数：
   - getVisibleContext(current_block, read_boundary, options)
4. 查询结果至少包含：
   - current block
   - current scene
   - speaker labels
   - visible entities/facts/events/relation_changes
   - character cards
   - term cards
   - metric changes
   - current block assets
   - optional ja reference
5. 所有增强数据按 read_boundary 过滤。
6. current_block 只用于当前位置相关性，不放宽剧透边界。
7. reader_index.json 包含 timeline.order、source_summary 和 validation_report 元信息。

验收标准：

- 给定较早 read_boundary 时，不返回后文揭示信息。
- 给定终章后的 read_boundary 时，能返回伏笔解释或后文事件。
- current_block 超过 read_boundary 时，仍只返回 read_boundary 前可见信息。
- current_block 超过 read_boundary 时，返回 is_ahead_of_boundary。
- JSON 结构稳定，可供阅读器使用。
```

## 8. 阶段八：最小数据工作台原型

```text
【按 v0.2 实施】

2026-06-30 曾实现并回滚候选卡片式 Web 工作台原型（逐候选交互成本过高）。新工作台按 `docs/post-cleaning-operation-design-v0.2.md` §10 设计：围绕作业控制台、异常队列、Change 审计/差异视图、可选 scene digest，而不是候选卡片列表。CLI 优先（draft/review/queue/audit/revert），Web 是后续增强。

目标：
按 v0.2 实现工作台的人工接触面，人的主操作是异常裁决 + 审计 + 整批回滚。

请阅读：

- docs/workflow-spec-v0.1.md
- docs/data-format-v0.1.md

任务：

1. 不直接做候选卡片式界面。
2. 先设计真实制作中的人类操作单位：block、scene、range、异常队列或批处理包。
3. 设计 AI 输出如何从候选草案聚合为可裁决的操作建议。
4. 设计人工如何批注、确认、拒绝、延后、拆分和回查。
5. 设计哪些写入可以批量确认，哪些必须单条确认。
6. 设计 Accepted 写入和 Change 审计如何保持可追溯。

验收标准：

- 产出新的阶段 5-8 工作台/Agent 操作设计。
- 明确不再采用逐候选点击作为主流程。
- 明确保留「AI 不静默写 Accepted」的边界：独立复核通过可自动落盘，但必须生成 Change、记录 reviewer_model/work_run_id，并可回滚。
- 明确可用样例 bookpack 验证的新闭环。
```

## 9. 阶段九：最小 Markdown 阅读器原型

```text
目标：
实现最小 Markdown 阅读器，验证 read_boundary、防剧透查询和右侧增强面板。

请阅读：

- docs/phase-1-implementation-spec.md
- docs/data-format-v0.1.md
- docs/compiled-query-spec-v0.1.md

任务：

1. 渲染 `parsed/volumes/v01.md`。
2. 隐藏 HTML 注释。
3. 每个 block 在 DOM 或内部结构中保留 block ID。
4. 使用内部阅读标尺计算 current_block。
5. 维护 read_boundary。
6. 正常连续阅读时自动推进 read_boundary。
7. 支持可调停留时间阈值。
8. 目录跳转、搜索跳转、大幅拖动、快速跳读时，不自动推进 read_boundary。
9. 当 current_block 超过 read_boundary，右侧显示保守提示。
10. 右侧提供：
    - 标记至当前 block 为已读
    - 返回 read_boundary
11. 右侧增强面板调用 getVisibleContext。
12. 支持中文 / 中文 + 日文参考开关。

验收标准：

- 慢速阅读时 read_boundary 会推进。
- 快速跳到终章时 read_boundary 不推进。
- 后文剧透不会提前显示。
- 手动确认后，右侧增强数据更新。
- 返回 read_boundary 可回到已读边界附近。
- 停留时间阈值可调。
```

## 10. 阶段十：端到端验收

```text
目标：
完成第一阶段端到端验收，确认制作闭环可跑通。

当前状态：

阶段 5-8 操作逻辑已按 `docs/post-cleaning-operation-design-v0.2.md` 定案。端到端验收不通过逐候选工作台，而是验证「起草→独立复核→自动落盘→异常升级→回滚」闭环；fixture 仍可用于数据格式、validator、compiler 和 query 验证。

代码事实以 `docs/project-progress-audit-2026-06-30.md` 为准。工作台已有本地真实 LLM 试跑反馈，但尚未用真实书籍做长程测试；阅读器 UI 尚未实现。

请阅读全部 docs/*.md，并运行已实现的工具链。

任务：

1. 从 samples/gray-tower/manifest.json 开始。
2. 解析 Markdown，生成 Parsed JSONL。
3. 运行 validator。
4. 准备 Candidates。
5. 通过 fixture 或已定案的新工作流接受一部分候选。
6. 生成 Accepted 和 Changes。
7. 编译 reader_index.json。
8. 在阅读器中验证：
   - 正文渲染
   - read_boundary
   - current_block
   - 跳读防剧透
   - 右侧增强面板
   - 日文参考开关

验收标准：

- 整个流程能从空 compiled 重新生成 reader_index.json。
- validator 无 error。
- 阅读器能展示至少人物、事件、术语、数值变化中的三类增强信息。
- 后文揭示不会在 read_boundary 前显示。
- current_block 超过 read_boundary 时，增强数据仍按 read_boundary 过滤。
- 文档、样例、工具之间没有明显字段不一致。

输出：

- 简短验收报告。
- 已知问题列表。
- 下一阶段建议。
```
