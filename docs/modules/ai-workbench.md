# 模块：AI 数据工作台

## 需求

清洗后的结构化制作采用双 AI 流水线：

```text
选章节 / 范围
-> 起草 Agent 生成 Candidates
-> 复核 Agent 独立路由
   -> 低风险自动写 Accepted + Change
   -> 高风险进异常队列
   -> 无依据拒绝
-> 人清异常队列、审计 Change、必要时回滚
```

人的主操作面是异常裁决和审计，不是逐候选点击。

## 已实现

服务器：`tools/src/server.ts`（`npm run workbench`）。**已与阅读器合并**：同一服务器同时提供工作台（`/`）和阅读器（`/reader/`），共用同一份 `.workbench-config.json`（bookpack 路径 ＋ API key），顶栏互相跳转。读侧视图逻辑在 `tools/src/readerView.ts`，工作台与独立阅读器（`tools/src/reader.ts`）共用。

已用 DeepSeek 实跑验证（drafter=`deepseek-chat`、reviewer=`deepseek-reasoner`）：起草产出语义稳定实体 ID，章内 / 跨卷复用已确认实体不重造，复核干净项 auto 落盘；四卷长程实测结果见 [long-range-test-phase-a-2026-07-01](long-range-test-phase-a-2026-07-01.md)。

前端：`tools/web/*`（工作台）、`tools/web/reader/*`（阅读器）

Agent 模块：

- `tools/src/agent/config.ts`
- `tools/src/agent/llm.ts`
- `tools/src/agent/prompts.ts`
- `tools/src/agent/pipeline.ts`
- `tools/src/agent/agentStore.ts`
- `tools/src/agent/workbenchData.ts`

已实现接口：

- `/api/state`
- `/api/config`
- `/api/chapters`
- `/api/chapters/:id/blocks`
- `/api/blocks/:id/markers`
- `/api/draft`
- `/api/review`
- `/api/queue`
- `/api/queue/resolve`
- `/api/changes`
- `/api/revert`

## 当前上下文策略

当前作业目标是章节。起草和复核会收到：

- 目标章节正文。
- 目标章节所属整卷正文，作为背景。
- 全局 Accepted 结构化记忆；提示词当前主要渲染已确认实体名册。

这已经支撑 gray-tower `v01`-`v04` Phase A 长程压力测试：不加入前卷原文 / 前卷梗概时，核心实体复用、许映白伏笔回收、未寄出的名单长线和 D 班点数弧线均跑通。仍未完成的是 Phase B 增强档：把事实、事件、关系、数值、角色卡和 OpenQuestion 压缩成可预算的前文上下文，供真实书籍或质量 / 成本对照使用。

## 配置与安全

模型配置存在 `tools/.workbench-config.json`，已 gitignore。前端状态接口只返回 `api_key_set`，不返回 key 明文。

仓库测试不调用真实模型；真实 LLM 试跑只能提交脱敏结果和代码修正。

## Change 与回滚

自动落盘通过 `AgentStore.write()`：

- 写目标 Accepted 文件。
- 写 `accepted/changes.jsonl`。
- 标记 `decided_by`、`auto_accepted`、`reviewer_model`、`work_run_id`。
- 记录模型 `token_usage` 到 `reports/work_runs.jsonl`。

自动落盘前会做引用守卫：引用不存在或只在同批候选中无法落盘的草案会升级到 review item；非实体 / 非 metric 的同 ID 不同内容不再静默覆盖。`AgentStore.mergeAccepted()` 会保留实体 `first_seen` / `source_span` / aliases，并避免样例包 `series_id` 被模型输出带偏。

当前回滚支持：

- 单 Change。
- 整批 work_run。

未完成：

- 单对象专用回滚入口。
- update / merge / deprecate 的 `before` 快照和恢复。

## 未完成

- review item 批量裁决 / 批量转 OpenQuestion。
- 真实书籍长程制作压测。
- Phase B 前文上下文压缩 / 检索（gray-tower Phase A 暂不阻塞）。
- 任意 scene / block range / 整卷作业。
- token 预算器。
- LLM JSON schema 修复与重试。
- 复核 decision log 或 `review_runs`。
- 自动 validate / compile。
