# 第一阶段实现规格

## 1. 目标

第一阶段只追求跑通制作闭环，不追求完整桌面应用体验。

闭环包括：

```text
原创测试文本
-> 清洗 Markdown
-> Parsed JSONL
-> 硬校验
-> AI Candidates
-> block 复核工作台
-> Accepted 数据
-> Compiled 查询产物
-> Markdown 阅读器
```

第一阶段执行时还应遵守：

- `docs/phase-1-design-decisions-v0.1.md`
- `docs/compiled-query-spec-v0.1.md`

## 2. 模块顺序

### 2.1 清洗输出

输入来源不限，可以是手工、脚本、OCR、EPUB、TXT、外部 AI 等。

第一阶段最低交付物：

```text
manifest.json
parsed/volumes/v01.md
```

如果包含图片：

```text
assets/images/...
```

### 2.2 Parsed 生成

从 Markdown 和资源目录生成：

```text
parsed/blocks.jsonl
parsed/scenes.jsonl
parsed/assets.jsonl
parsed/asset_anchors.jsonl
parsed/alignments.jsonl
reports/cleaning_report.json
```

`blocks.jsonl` 保存正文副本，可作为结构化正文使用。

Parsed 是可重复生成产物，不保存人工复核进度。block 制作进度写入 `review/block_progress.jsonl`。

### 2.3 硬校验

校验 manifest、Markdown、JSONL、引用完整性、时间线位置和安全边界。

校验结果写入：

```text
reports/validation_report.json
```

校验报告必须能供人阅读，也能供清洗 AI 返工。

### 2.4 AI Candidates

AI 按 block、scene、章节或用户指定范围生成候选。

第一阶段统一写入：

```text
candidates/candidates.jsonl
```

每条候选绑定 block 或 block range。

候选必须包含 `source_span`。`block_id` 只是工作台主显示位置，默认等于 `source_span.start_block`。复核队列按 `source_span.start_block` 的正文时间线顺序推进。

### 2.5 内置制作 Agent

清洗后文本操作阶段应提供一个轻量内置 Agent，用来协调 parser、validator、candidate generator、review queue、accepted store 和 compiler。

第一阶段 Agent 不需要复杂自主规划，但必须具备基础 AI 制作能力：

- 读取当前 bookpack 状态。
- 调用 parser 和 validator。
- 读取 validation_report，并提出返工建议。
- 按 block/source_span 顺序读取正文。
- 检索当前范围相关的 Accepted、Candidates 和 OpenQuestions。
- 调用 AI 生成 entity、fact、event、relation_change、speaker_label、metric、metric_change、term_card、open_question 等候选草案。
- 为候选生成 source_span、visible_from、confidence、evidence、risk_flags 和 payload.draft。
- 校验候选引用和格式。
- 按正文时间线组织复核队列。
- 主动把低置信、冲突、主观判断和高剧透风险内容交给人工复核。
- 在人工确认后写入 Accepted 和 Changes。
- 更新 Candidate status 和 block_progress。
- 调用 compiler 生成 reader_index。

Agent 不能绕过人工确认直接写 Accepted。详细规则见 `docs/agent-operation-spec-v0.1.md`。

### 2.6 数据工作台

工作台主流程按 block 顺序推进。

最小视图：

- 左侧：卷、章节、复核进度、候选队列。
- 中间：当前 block 正文和前后上下文。
- 右侧：当前 block 相关候选和操作。

最小操作：

- 接受
- 修改后接受
- 拒绝
- 合并实体
- 转为未决问题
- 跳过
- 标记 block 已复核

### 2.7 Accepted 入库

人工确认后写入 `accepted/`，同时写入 `accepted/changes.jsonl`。

AI 不直接写 Accepted。

Accepted 对象必须带 `created_change_id`。Change 必须带 `target_file`、`target_type`、`target_id`、`operation`、`approved_by` 和 `created_at`。

### 2.8 Compiled 查询

第一阶段编译为：

```text
compiled/reader_index.json
```

不急着使用 SQLite。Compiled 是可再生成产物，不作为人工维护源文件。

Compiled 查询结构和 `getVisibleContext(current_block, read_boundary, options)` 见 `docs/compiled-query-spec-v0.1.md`。

### 2.9 Markdown 阅读器

阅读器最小能力：

- 渲染 Markdown 正文。
- 隐藏 HTML 注释。
- 根据内部阅读标尺定位 `current_block`。
- 维护 `read_boundary`。
- 按 `visible_from` 查询右侧增强数据。
- 支持右侧增强面板。
- 支持跳读后的保守提示。
- 支持“标记至当前 block 为已读”。
- 支持“返回已读边界”。
- 支持自动推进和停留时间阈值调节。

## 3. 复核粒度

人工复核最小单位是 block。

scene 只是上下文提示和聚合视图，不作为主复核单位，不作为防剧透边界。

block 复核状态：

```text
unreviewed
ai_generated
reviewing
reviewed
has_open_question
skipped
```

这些状态落盘在 `review/block_progress.jsonl`，不写入 Parsed。

## 4. 阅读进度规则

- `current_block` 表示用户当前视口阅读标尺附近的 block。
- `read_boundary` 表示防剧透查询使用的已读边界。
- 正常连续阅读可自动推进 `read_boundary`。
- 目录跳转、搜索跳转、大幅拖动、快速跳很多时，只更新 `current_block`，不自动推进 `read_boundary`。
- 当 `current_block` 超过 `read_boundary`，右侧增强面板仍按 `read_boundary` 查询。
- 右侧提供手动确认和返回边界。
- 停留时间阈值可调。

## 5. 第一阶段不做

- 账号和云同步。
- 自动下载书籍或数据包。
- EPUB 原版渲染。
- 大规模性能优化。
- 完整复杂图谱布局。
- 官方资料外部来源正式入库。
- 自动合并实体。
- AI 直接改 Accepted。
