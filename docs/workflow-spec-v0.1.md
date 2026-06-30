# 制作工作流规格 v0.1

## 1. 总体流程

```text
原创或授权文本
-> 清洗 Markdown
-> 生成 Parsed JSONL
-> 硬校验
-> AI 候选生成
-> block 顺序复核
-> Accepted 数据
-> Compiled 查询产物
-> 阅读器验证
```

第一阶段用原创测试书跑通流程。

## 2. 清洗阶段

清洗阶段只规定输出，不规定输入。

清洗者可以使用：

- 人工整理
- 脚本
- OCR
- EPUB/TXT 转换
- 外部大模型
- Codex/GPT 辅助

清洗输出必须符合：

- `manifest.json`
- `parsed/volumes/v01.md`
- 必要图片资源
- 可由工具生成的 Parsed JSONL

清洗后必须运行校验。校验失败时，根据 `reports/validation_report.json` 返工。

## 3. 内置制作 Agent

清洗后的文本操作阶段应由内置制作 Agent 协调，而不是只依赖一组彼此孤立的脚本。

Agent 的职责：

- 调用 parser 生成 Parsed JSONL。
- 调用 validator 生成 validation_report。
- 根据 validation_report 组织返工。
- 调用或触发 AI 候选生成。
- 管理 Candidates、ReviewItems、OpenQuestions。
- 在工作台中按 block 提供候选和建议操作。
- 在人工确认后通过受控接口写入 Accepted 和 Changes。
- 调用 compiler 生成 reader_index。
- 显示当前作业范围、上下文预算、已作业 block 和未作业 block。

Agent 可以自主选择下一步工具操作，但不能静默写入 Accepted。任何正式增强数据变更都必须经过人工确认并生成 Change。

详细规则见 `docs/agent-operation-spec-v0.1.md`。

## 4. AI 候选生成

AI 默认读取：

- 当前 block 或 block 范围。
- 当前 scene 上下文。
- 已确认实体列表。
- 已确认事实、事件、关系、数值摘要。
- 未决问题摘要。

AI 输出到：

```text
candidates/candidates.jsonl
```

AI 可以输出：

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
- open_question
- review_item

AI 可以提出新实体 ID，但只作为候选。

每条 Candidate 必须包含 `source_span`。`block_id` 只是主显示位置，默认等于 `source_span.start_block`。工作台按 `source_span.start_block` 的正文时间线顺序推进，范围型候选复核时展示完整 `source_span`。

Candidate 的 `payload` 应包含：

- `target_type`
- `draft`
- `evidence`
- `risk_flags`

`draft` 是未来 Accepted 对象的草案，但不包含 `created_change_id`。

AI 作业可以按整卷、章节、scene、固定 block 数或自定义 range 执行。每次作业应记录到 `reports/work_runs.jsonl`，用于区分已作业和未作业 block。

## 5. 人工复核

人工复核以 block 为最小单位，按正文顺序推进。

每个 block 显示：

- 当前 block 正文。
- 前后少量上下文。
- 当前 scene。
- 当前 block 相关候选。
- 已确认实体和相关历史上下文。

操作：

- 接受候选。
- 修改后接受。
- 拒绝候选。
- 合并实体。
- 转为未决问题。
- 跳过。
- 标记 block 已复核。

接受候选后：

- 写入对应 Accepted JSONL。
- 写入 `accepted/changes.jsonl`。
- 更新 block 复核状态。

block 复核状态写入 `review/block_progress.jsonl`，不写入 Parsed。

## 6. ReviewItem 与 OpenQuestion

ReviewItem 是短期复核任务。

OpenQuestion 是长期悬而未决的问题，例如身份不明、疑似伏笔、关系影响待确认。

两者都不进入普通阅读界面，只在数据工作台显示。

Review 区分工：

- `review/block_progress.jsonl`：block 制作进度。
- `review/review_items.jsonl`：短期待处理任务。
- `review/open_questions.jsonl`：长期未决问题。

OpenQuestion 的 `has_open_question` block 状态不阻塞继续复核。后文确认 OpenQuestion 时，如果产生正式数据，必须写 Accepted + Change，并将 OpenQuestion 标记为 `resolved`。

## 7. 编译阶段

编译阶段读取：

- manifest
- Parsed JSONL
- Accepted JSONL

输出：

```text
compiled/reader_index.json
```

Compiled 产物不人工维护，可以随时重新生成。

Compiled 查询结构和 `getVisibleContext(current_block, read_boundary, options)` 见 `docs/compiled-query-spec-v0.1.md`。只有 validation report 无 error 时才允许 compile。

## 8. 阅读器验证

阅读器验证内容：

- Markdown 正文渲染。
- HTML 注释隐藏。
- block 定位。
- current_block 更新。
- read_boundary 自动推进。
- read_boundary 手动确认。
- 跳读时不自动推进。
- 返回 read_boundary。
- 右侧增强面板按 `visible_from` 过滤。
- 日文参考按开关渲染。

## 9. 角色卡和摘要生成

角色卡和事件摘要可以由 AI 起草。

AI 摘要必须基于当前可见边界内的 Accepted 数据和正文来源。人工确认后进入 Accepted。

角色卡按稳定节点生成：

- 卷末
- 学期末
- 年级末

卷内变化通过事件、事实、关系变化、最近变化模块展示，不频繁重写整张卡。
