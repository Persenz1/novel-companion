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

服务器：`tools/src/server.ts`

前端：`tools/web/*`

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
- 已确认实体列表。

这能改善卷内连续性，但不能解决第二卷及后续卷的前文压缩问题。事实、事件、关系、数值、角色卡和 OpenQuestion 尚未作为结构化历史上下文注入提示词。

## 配置与安全

模型配置存在 `tools/.workbench-config.json`，已 gitignore。前端状态接口只返回 `api_key_set`，不返回 key 明文。

仓库测试不调用真实模型；真实 LLM 试跑只能提交脱敏结果和代码修正。

## Change 与回滚

自动落盘通过 `AgentStore.write()`：

- 写目标 Accepted 文件。
- 写 `accepted/changes.jsonl`。
- 标记 `decided_by`、`auto_accepted`、`reviewer_model`、`work_run_id`。

当前回滚支持：

- 单 Change。
- 整批 work_run。

未完成：

- 单对象专用回滚入口。
- update / merge / deprecate 的 `before` 快照和恢复。

## 未完成

- 真实书籍长程制作压测。
- 第二卷前文上下文压缩 / 检索。
- 任意 scene / block range / 整卷作业。
- token 预算器。
- LLM JSON schema 修复与重试。
- 复核 decision log 或 `review_runs`。
- 自动 validate / compile。
