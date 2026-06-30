# 内置制作 Agent 规格 v0.1

## 1. 定位

内置制作 Agent 是清洗后文本进入结构化制作阶段的本地操作助理。

它不是普通聊天框，也不是直接替代人工的自动整理器。它的职责是在数据工作台和工具链之间协调操作：

- 读取清洗后的 Markdown 和 Parsed JSONL。
- 调用 parser、validator、candidate generator、compiler 等工具接口。
- 管理 Candidates、ReviewItems、OpenQuestions。
- 在低风险场景执行机械修复或生成候选。
- 在高风险、主观、不确定或会影响 Accepted 的场景主动请求人工复核。
- 在人工确认后，通过受控接口写入 Accepted 和 Changes。

第一阶段架构不需要复杂，但必须提前留下“工具接口 + 人工复核 + 审计记录”的边界。

本项目的长期目标不是让制作者反复打开外部 chatbox、粘贴大量上下文、复制 JSON 再手工导回项目。内置 Agent 必须承担上下文检索、工具调用、候选组织、复核分发和受控写入的主流程职责。聊天界面可以存在，但只能作为解释和辅助入口，不能成为数据制作的核心流程。

第一阶段 Agent 不能只是脚本按钮壳。它必须能对清洗后正文进行基础结构化制作：按正文顺序读取 block 或 source_span，调用 AI 生成实体、事实、事件、关系、数值、说话人、术语和未决问题候选，校验候选草案，并在人工确认后执行正式写入。

换作品、换制作者或处理制作者不熟悉的小说时，Agent 应通过结构化数据、检索上下文和复核队列降低上手成本。人类只需要在关键判断点做确认、修正或否决。

## 2. 基本原则

- Agent 可以操作接口和数据文件，但不能绕过规则直接改正式数据。
- AI 推理结果默认进入 Candidates 或 Review，不直接进入 Accepted。
- Accepted 的变更必须来自人工确认动作，并写入 Changes。
- 数据制作默认由 Agent 驱动，人类负责复核和裁决。
- Agent 负责检索和组织上下文，不能要求人类长期承担上下文搬运工作。
- Agent 可以自动运行 parser、validator、compiler。
- Agent 可以根据 validation report 尝试修复清洗后 Markdown 或 Parsed 产物。
- Agent 可以主动决定哪些候选需要人工复核。
- Agent 可以给人工提供建议、diff、风险提示和推荐操作。
- Agent 不拥有最终事实判断权。
- AI 是结构化制作的第一起草者，人工是正式数据的裁决者，Agent 是上下文、工具和写入规则的执行中枢。
- Agent 必须具备上下文预算意识，不能默认把全卷、全历史和全候选无差别塞入模型上下文。

## 3. 可操作对象

第一阶段 Agent 可以操作：

```text
manifest.json
parsed/volumes/*.md
parsed/*.jsonl
candidates/candidates.jsonl
review/review_items.jsonl
review/open_questions.jsonl
review/block_progress.jsonl
reports/*.json
reports/work_runs.jsonl
compiled/reader_index.json
```

受限操作：

```text
accepted/*.jsonl
```

Accepted 只能通过“人工确认后的受控写入接口”修改。Agent 可以准备写入草案，但不能静默落盘为正式数据。

## 4. 工具接口

第一阶段可以把接口实现为函数、命令、模块或服务。接口形态可以简单，但语义要稳定。

### 4.1 FileStore

负责读写 bookpack 文件：manifest、Markdown、JSONL、reports，并提供文件路径和行号定位。

### 4.2 Parser

负责从 Markdown 生成 Parsed JSONL。

核心能力：

- `parseVolume(volume_id)`
- `parseBookpack()`
- 输出 blocks、scenes、assets、asset_anchors、alignments。
- 输出 cleaning_report。

### 4.3 Validator

负责硬校验和软提示。

核心能力：

- `validateManifest()`
- `validateMarkdown()`
- `validateParsed()`
- `validateCandidates()`
- `validateAccepted()`
- `validateBookpack()`
- 输出 validation_report。

### 4.4 CandidateGenerator

负责基于 block 或 block range 生成候选。

核心能力：

- `generateForBlock(block_id)`
- `generateForRange(start_block, end_block)`
- `generateForScene(scene_id)`
- `estimateContextForRange(start_block, end_block, task_types)`

输出统一写入 `candidates/candidates.jsonl`。

每条候选必须包含 `source_span`、`visible_from`、`confidence`、`evidence`、`risk_flags` 和 `payload.draft`。`block_id` 只是工作台主显示位置，默认等于 `source_span.start_block`。

### 4.5 ReviewQueue

负责复核队列。

核心能力：

- `listCandidates(block_id)`
- `markCandidateAccepted(candidate_id)`
- `markCandidateRejected(candidate_id)`
- `convertCandidateToOpenQuestion(candidate_id)`
- `createReviewItem()`
- `createOpenQuestion()`
- `getBlockProgress(block_id)`
- `updateBlockProgress(block_id, status)`

### 4.6 AcceptedStore

负责正式数据写入，但必须要求人工确认。

核心能力：

- `previewAccept(candidate_id)`
- `acceptCandidate(candidate_id, edited_payload, approved_by)`
- `manualCreate(target_type, payload, approved_by)`
- `manualUpdate(target_type, target_id, patch, approved_by)`
- `mergeEntities(source_id, target_id, approved_by)`
- `deprecateObject(target_type, target_id, reason, approved_by)`

所有写入都必须同步生成 Change。

### 4.7 Compiler

负责生成阅读器查询产物。

核心能力：

- `compileReaderIndex()`
- `getVisibleContext(current_block, read_boundary, options)`

详细结构见 `docs/compiled-query-spec-v0.1.md`。

### 4.8 WorkRunStore

负责记录一次 AI 作业范围和上下文预算。

核心能力：

- `createWorkRun(start_block, end_block, task_types, context_estimate)`
- `markWorkRunCompleted(work_run_id, created_candidate_count)`
- `listWorkedBlocks()`
- `listUnworkedBlocks()`

输出写入：

```text
reports/work_runs.jsonl
```

## 5. 上下文预算与作业分段

每次 AI 作业前，Agent 应展示：

- 当前任务范围。
- 已作业 block 和未作业 block。
- 本次输入正文估算 token。
- 历史上下文估算 token。
- schema / 提示词估算 token。
- 候选输出预算。
- 总上下文估算。
- 模型上下文上限。
- 上下文状态：健康、偏大、过大。

用户应能选择：

- 整卷作业。
- 按章节作业。
- 按 scene 作业。
- 按固定 block 数分段。
- 自定义 range。

默认建议：

- 初次候选生成按章节或 20-40 个 block 一段。
- 说话人标注按 dialogue block 或 scene。
- 事件和关系变化按 scene 或章节。
- 角色卡、卷总结等稳定摘要在基础 Accepted 数据完成后生成。

上下文组成应分层：

必选：

- 当前 work_range 正文。
- 当前 range 前后少量邻近 block。
- schema / 输出格式。
- 已确认实体和别名表。
- 当前相关 Accepted 摘要。

按需：

- 当前 scene 上下文。
- 最近事件摘要。
- 相关人物卡。
- OpenQuestions。
- 术语表。
- 数值状态。

默认不放：

- 全卷原文。
- 全系列事实全量。
- 所有候选历史。
- 已拒绝候选。

Agent 应提示分段作业的风险，包括跨段事件被切断、别名遗忘、重复候选、visible_from 判断偏差、OpenQuestion 漏检和 source_span 过宽。

## 6. Agent 操作循环

推荐循环：

```text
读取当前状态
-> 选择下一步任务
-> 调用工具接口
-> 检查结果
-> 如果低风险且允许自动处理，执行
-> 如果高风险或不确定，生成复核项
-> 等待人工确认
-> 写入 Accepted/Changes 或回到 Candidates
-> 继续下一项
```

## 7. 自动处理范围

Agent 可以自动执行：

- 运行 parser。
- 运行 validator。
- 根据 validation report 修复明显格式问题。
- 补全缺失但可机械确定的 Parsed 字段。
- 生成 Candidates。
- 按 block 整理候选顺序。
- 生成 ReviewItems。
- 生成 OpenQuestions。
- 编译 reader_index。
- 写入 work_runs。
- 更新 Candidate status 和 block_progress。

Agent 不应自动执行：

- 接受事实、事件、关系、数值为正式数据。
- 合并实体。
- 删除或弃用正式对象。
- 修改防剧透边界。
- 将主观关系判断写入 Accepted。
- 将官方说明书内容覆盖正文来源。
- 静默写入 Accepted。
- 静默确认说话人标注。
- 静默写入关系、身份、伏笔解释为正式数据。

## 8. 需要人工复核的场景

必须交给人工：

- 新实体是否真的成立。
- 疑似同一实体合并。
- 说话人歧义。
- 关系变化是否成立。
- 伏笔、隐藏身份、误导叙述。
- 数值冲突。
- 图片中人物身份识别。
- 任何会写入 Accepted 的操作。
- 所有 speaker_label 写入 Accepted 的操作。说话人必须在对话 block 复核时由人工确认。

建议交给人工：

- 低置信候选。
- source_span 过宽或证据不足。
- AI 摘要可能含有后文信息。
- 与已有 Accepted 数据冲突。

## 9. 人工复核界面要求

Agent 提供给人工的信息应包含：

- 当前 block 正文。
- 前后上下文。
- 当前 scene。
- 当前作业范围和上下文预算。
- 候选 payload。
- 证据 source_span。
- 可见边界 visible_from。
- 置信度。
- 与已有 Accepted 的冲突。
- 推荐操作。

人工操作：

- 接受。
- 修改后接受。
- 拒绝。
- 合并。
- 转未决问题。
- 跳过。
- 标记 block 已复核。

## 10. 数据库与文件适配

第一阶段源数据使用 Markdown + JSONL。Agent 接口不应绑定具体存储实现。

未来可以把 Accepted、Candidates、Review 或 Compiled 放入数据库，但 Agent 应通过 Store/Repository 接口操作，而不是散落地直接读写数据库表。

第一阶段推荐：

- 源数据：JSONL。
- 查询产物：`compiled/reader_index.json`。
- 后续数据库：作为适配层替换，不改变上层 Agent 语义。

## 11. 验收标准

内置制作 Agent 第一阶段验收：

- 能读取 bookpack 当前状态。
- 能运行 parser 和 validator。
- 能读取 validation_report 并提出修复建议。
- 能展示作业范围、已作业 block、未作业 block 和上下文预算。
- 能按 block/source_span 顺序读取正文并调用 AI 生成 Candidates。
- 能生成或整理 Candidates，候选包含 evidence、risk_flags 和 payload.draft。
- 能按 block 提供复核队列。
- 能把人工接受的 Candidate 写入 Accepted。
- 能生成 Change。
- 能把不确定内容转为 ReviewItem 或 OpenQuestion。
- 能更新 Candidate status、block_progress 和 work_runs。
- 能触发 compiler 生成 reader_index。
- 不会绕过人工确认直接写 Accepted。
