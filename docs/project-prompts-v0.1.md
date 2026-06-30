# 项目阶段提示词 v0.1

本文件用于在新窗口、其他模型或后续工作会话中快速接续项目。每个阶段提示词都包含目标、输入文档、任务范围和验收标准。

使用方式：先复制“通用接手提示词”，再追加对应阶段提示词。

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

项目当前阶段不是做完整桌面应用，而是跑通第一阶段闭环：

原创测试书 -> 清洗 Markdown -> Parsed JSONL -> 硬校验 -> AI Candidates -> block 复核 -> Accepted 数据 -> Compiled 查询 -> Markdown 阅读器验证。

请优先遵守以下原则：

- 中文文本是唯一主轴。
- 日文只作为参考渲染内容，不进入主操作链。
- 防剧透查询使用 read_boundary，不直接使用 current_block 放宽边界。
- AI 可以写 Candidates、ReviewItems 和 OpenQuestions，但不能绕过人工确认写 Accepted。
- Accepted 正式数据必须可追溯；默认追溯到中文正文 block，图片主体等例外必须能通过 asset anchor 回到正文位置。
- 工作台复核最小单位是 block，scene 只作为上下文提示。
- 第一阶段先用 JSON/JSONL 和 Markdown，不急着上 SQLite 或完整桌面应用。
- 清洗后文本操作阶段应通过内置制作 Agent 协调工具接口；Agent 应具备基础 AI 制作能力，能按 block/source_span 读取正文、生成结构化候选、显示上下文预算和作业范围，但不能绕过人工确认直接写 Accepted。

工作时请保持改动聚焦。若需要新增文件，请优先放在 docs/、samples/gray-tower/ 或后续约定的工具目录中。
```

## 0.1 并行分工规则

```text
如果多个模型或窗口并行工作，必须按模块解耦：

1. 测试文章/样例 bookpack 任务只改 samples/gray-tower/ 和必要样例数据。
2. Parser 任务只负责 Markdown -> Parsed JSONL，不写 Accepted。
3. Validator 任务只负责校验和 reports/validation_report.json，不修改业务数据，除非明确要求实现自动修复。
4. 内置制作 Agent 任务只设计或实现工具协调层、上下文预算和 AI 候选生成流程，不改变数据格式规范。
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
你只负责设计或实现清洗后文本操作阶段的内置制作 Agent。

请阅读：

- docs/agent-operation-spec-v0.1.md
- docs/workflow-spec-v0.1.md
- docs/data-format-v0.1.md
- docs/validation-spec-v0.1.md
- docs/phase-1-design-decisions-v0.1.md

目标：

实现一个轻量 Agent 架构，使它能协调 parser、validator、candidate generator、review queue、accepted store、compiler 等接口，并能对清洗后正文进行基础 AI 结构化制作。

任务：

1. 设计 Agent 的接口边界：
   - FileStore
   - Parser
   - Validator
   - CandidateGenerator
   - ReviewQueue
   - AcceptedStore
   - Compiler
2. 实现或伪实现 Agent 操作循环：
   - 读取当前状态
   - 选择下一步操作
   - 调用工具
   - 读取报告
   - 显示上下文预算、作业范围、已作业 block 和未作业 block
   - 按 block/source_span 调用 AI 生成候选或复核项
   - 请求人工确认
   - 人工确认后写入 Accepted 和 Changes
3. Agent 可以直接操作 JSONL 或未来数据库适配层，但必须通过接口操作。
4. Agent 不能绕过人工确认直接写 Accepted。
5. 高风险内容必须进入人工复核：
   - 新实体确认
   - 实体合并
   - 说话人歧义
   - 关系变化
   - 伏笔/隐藏身份
   - 数值冲突
   - 图片人物识别

验收：

- Agent 能调用 parser/validator/compiler。
- Agent 能读取 validation_report 并提出修复建议。
- Agent 能显示上下文预算和作业范围。
- Agent 能生成或整理包含 evidence、risk_flags 和 payload.draft 的 Candidates。
- Agent 能把不确定内容转为 ReviewItem 或 OpenQuestion。
- Agent 能在人工确认后写 Accepted 和 Change。
- Agent 不直接越权修改 Accepted。
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
目标：
基于《灰塔学院测试卷》生成一批候选数据样例，验证 Candidates 格式和工作台复核流程。

请阅读：

- docs/data-format-v0.1.md
- docs/workflow-spec-v0.1.md
- docs/phase-1-design-decisions-v0.1.md
- samples/gray-tower/parsed/blocks.jsonl

任务：

1. 生成 `samples/gray-tower/candidates/candidates.jsonl`。
2. 候选类型至少包含：
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
3. 每条 Candidate 必须包含：
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
4. block_id 只是主显示位置，可选；若存在，必须落在 source_span 内。
5. 普通 Candidate 的 payload 必须包含 target_type、draft、evidence、risk_flags。
6. AI 可提出新 entity ID，但不能写 Accepted。
7. 所有 speaker_label 只作为 Candidate，必须在对话 block 复核时由人工确认后才进入 Accepted。

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
目标：
实现最小可用数据工作台，用于按 block 复核 Candidates。

请阅读：

- docs/workflow-spec-v0.1.md
- docs/data-format-v0.1.md

任务：

1. 做一个最小界面或命令行/网页原型。
2. 左侧显示卷、章节、block 进度。
3. 中间显示当前 block 和前后上下文。
4. 右侧显示当前 block/source_span 相关 Candidates。
5. 支持操作：
   - accept
   - edit and accept
   - reject
   - merge entity
   - convert to open question
   - skip
   - mark block reviewed
6. 操作后写入对应 Accepted JSONL、changes.jsonl、Candidate status 和 review/block_progress.jsonl。

验收标准：

- 能加载 samples/gray-tower。
- 能按 source_span.start_block 的正文时间线顺序浏览。
- 能接受至少一种 candidate 并写入 Accepted。
- 能生成 Change。
- 能把不确定候选转为 open_question。
- 不要求界面美观，优先闭环可用。
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

请阅读全部 docs/*.md，并运行已实现的工具链。

任务：

1. 从 samples/gray-tower/manifest.json 开始。
2. 解析 Markdown，生成 Parsed JSONL。
3. 运行 validator。
4. 准备 Candidates。
5. 通过工作台接受一部分候选。
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
