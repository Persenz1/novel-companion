# 内置制作 Agent 规格 v0.1

> 2026-06-30 状态覆盖：阶段 5-8 清洗后操作逻辑已由 `docs/post-cleaning-operation-design-v0.2.md` 定案。凡本文仍出现「逐候选人工复核」「AI 不得写 Accepted」「待重构 / 暂停实现」等旧口径，均以 v0.2 为准：AI 起草 + 独立 AI 复核后可自动写 Accepted，但必须生成可追溯、可回滚 Change，高风险项升级给人裁决。

## 0. 当前状态说明

本文件保留 Agent 的职责边界、工具接口、安全边界和审计原则；阶段 5-8 的直接实现清单以 `docs/post-cleaning-operation-design-v0.2.md` 为准。

2026-06-30 曾尝试实现一个包含候选生成、Web 工作台、预览候选、逐条接受/拒绝/转未决的原型。交互验证后确认：candidate-by-candidate 的人工复核方式会导致真实长篇制作工作量过大，且人类操作集中在低层微决策上。因此该实现已回滚；现行阶段 5-8 操作逻辑见 `docs/post-cleaning-operation-design-v0.2.md`。

当前操作逻辑已定案：

- 不应继续实现逐候选卡片式工作台。
- 本文件第 6、9、11 节是历史操作循环和信息需求清单；实现以 v0.2 的作业控制台、异常队列、审计/回滚为准。
- 仍必须遵守 Accepted 必须生成 Change、正式数据必须可追溯、可回滚等硬边界。
- AI 不得静默写 Accepted；经独立复核的低风险草案可自动落盘，高风险升级给人。

## 1. 定位

内置制作 Agent 是清洗后文本进入结构化制作阶段的本地操作助理。

它不是普通聊天框，也不是直接替代人工的自动整理器。它的职责是在数据工作台和工具链之间协调操作：

- 读取清洗后的 Markdown 和 Parsed JSONL。
- 调用 parser、validator、candidate generator、compiler 等工具接口。
- 管理 Candidates、ReviewItems、OpenQuestions。
- 在低风险场景执行机械修复或生成候选。
- 在高风险、主观、不确定或会影响 Accepted 的场景主动请求人工复核。
- 在独立复核通过或人工裁决后，通过受控接口写入 Accepted 和 Changes。

第一阶段架构不需要复杂，但必须提前留下“工具接口 + 人工复核 + 审计记录”的边界。

本项目的长期目标不是让制作者反复打开外部 chatbox、粘贴大量上下文、复制 JSON 再手工导回项目。内置 Agent 必须承担上下文检索、工具调用、候选组织、复核分发和受控写入的主流程职责。聊天界面可以存在，但只能作为解释和辅助入口，不能成为数据制作的核心流程。

第一阶段 Agent 不能只是脚本按钮壳。它必须能对清洗后正文进行基础结构化制作：按正文顺序读取 block 或 source_span，调用 AI 生成实体、事实、事件、关系、数值、说话人、术语和未决问题候选，校验候选草案，并经独立复核或人工裁决后执行正式写入。

当前注意：这里的“候选”是数据中间层，不等于 UI 必须逐条候选确认。

换作品、换制作者或处理制作者不熟悉的小说时，Agent 应通过结构化数据、检索上下文和复核队列降低上手成本。人类只需要在关键判断点做确认、修正或否决。

## 2. 基本原则

- Agent 可以操作接口和数据文件，但不能绕过规则静默改正式数据。
- AI 推理结果默认先进入 Candidates 或 Review；经独立复核通过的低风险草案可进入 Accepted。
- Accepted 的变更必须来自独立复核通过或人工确认动作，并写入 Changes。
- 数据制作默认由 Agent 驱动，人类负责复核和裁决。
- Agent 负责检索和组织上下文，不能要求人类长期承担上下文搬运工作。
- Agent 可以自动运行 parser、validator、compiler。
- Agent 可以根据 validation report 尝试修复清洗后 Markdown 或 Parsed 产物。
- Agent 可以主动决定哪些候选需要人工复核。
- Agent 可以给人工提供建议、diff、风险提示和推荐操作。
- Agent 不拥有高风险最终事实判断权。
- AI 是结构化制作的第一起草者，独立 AI 是低风险复核者，人工是异常和高风险正式数据的裁决者，Agent 是上下文、工具和写入规则的执行中枢。
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

Accepted 只能通过受控写入接口修改。Agent 可以准备写入草案；经独立复核通过的低风险草案可自动落盘，但不能静默落盘，必须生成 Change 并支持回滚。

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

负责正式数据写入。人工确认仍用于高风险和异常项；低风险草案可由独立复核 Agent 自动确认，但必须生成 Change。

核心能力：

- `previewAccept(candidate_id)`
- `acceptCandidate(candidate_id, edited_payload, approved_by)`
- `autoAccept(candidate_id, reviewer_decision)`
- `manualCreate(target_type, payload, approved_by)`
- `manualUpdate(target_type, target_id, patch, approved_by)`
- `mergeEntities(source_id, target_id, approved_by)`
- `deprecateObject(target_type, target_id, reason, approved_by)`
- `revertChange(change_id)`
- `revertWorkRun(work_run_id)`

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

- 全系列事实全量。
- 所有候选历史。
- 已拒绝候选。

当前实用策略：对一卷约 100k 的小说，目标仍按章节/范围处理，但可把整卷完整正文作为背景上下文喂给起草/复核模型，以保持实体、称呼、情节连续；超长小说再分块。

Agent 应提示分段作业的风险，包括跨段事件被切断、别名遗忘、重复候选、visible_from 判断偏差、OpenQuestion 漏检和 source_span 过宽。

## 6. Agent 操作循环

推荐循环：

当前注意：以下循环是早期推荐模型；v0.2 已把“等待人工确认”重新定义为低风险自动落盘、高风险异常裁决，而不是每条候选一个按钮。

```text
读取当前状态
-> 选择下一步任务
-> 调用工具接口
-> 检查结果
-> 如果低风险且允许自动处理，执行
-> 如果高风险或不确定，生成复核项
-> 独立复核：低风险写入 Accepted/Changes，高风险进异常队列
-> 人工裁决异常或审计回滚
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

- 合并实体。
- 删除或弃用正式对象。
- 无依据地提前修改可见边界。
- 将主观关系判断写入 Accepted。
- 将官方说明书内容覆盖正文来源。
- 静默写入 Accepted。
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
- 复核 Agent 自身拿不准的任何草案。
- 所有高风险或异常 Accepted 写入操作。

建议交给人工：

- 低置信候选。
- source_span 过宽或证据不足。
- AI 摘要可能含有后文信息。
- 与已有 Accepted 数据冲突。

## 9. 人工复核界面要求

Agent 提供给人工的信息应包含：

当前注意：本节是信息需求清单，不是已定案界面。此前的候选详情 + 操作按钮 Web 原型已回滚，新的界面应先讨论工作流粒度。

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

当前注意：本节验收标准按 v0.2 更新；不再要求逐候选人工确认。

- 能读取 bookpack 当前状态。
- 能运行 parser 和 validator。
- 能读取 validation_report 并提出修复建议。
- 能展示作业范围、已作业 block、未作业 block 和上下文预算。
- 能按 block/source_span 顺序读取正文并调用 AI 生成 Candidates。
- 能生成或整理 Candidates，候选包含 evidence、risk_flags 和 payload.draft。
- 能调用独立复核模型路由 Candidates。
- 能把复核通过或人工裁决的 Candidate 写入 Accepted。
- 能生成 Change。
- 能把不确定内容转为 ReviewItem 或 OpenQuestion。
- 能更新 Candidate status、block_progress 和 work_runs。
- 能触发 compiler 生成 reader_index。
- 不会静默写 Accepted；自动写入都有复核记录、Change 和回滚路径。
