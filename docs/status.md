# 当前状态

本文件以当前代码和样例数据为准。

## 已实现并自动化验证

- CLI：`parse` / `validate` / `compile` / `query`。
- Parser：Markdown + manifest -> Parsed JSONL + cleaning report。
- Validator：校验 manifest、Markdown、Parsed、Accepted、Candidates、Review、Compiled。
- Compiler：生成 `compiled/reader_index.json`，且要求 validation report 为 `passed`。
- Query：`getVisibleContext(current_block, read_boundary, options)` 按 `read_boundary` 防剧透过滤。
- gray-tower fixture：在临时目录生成 Candidates / Review / Accepted / work_runs，不调用模型。
- 自动测试：19 个 node:test 用例覆盖 marker 解析和 query 防剧透行为。

## 已实现但未长程验证

- Web 数据工作台：`tools/src/server.ts` + `tools/web/*`。
- 起草 / 复核流水线：`tools/src/agent/pipeline.ts`。
- 本地模型配置：`tools/.workbench-config.json`，已 gitignore。
- 自动写入：`AgentStore.write()` 写 Accepted + Change。
- 异常队列：复核升级项写 `review/review_items.jsonl`。
- 回滚入口：单 Change / 整批 work_run。

制作者已用真实 LLM 在本地试跑过工作台流程，但该验证依赖本机 API key，没有进入仓库可复现测试，也未拿真实书籍做长程压测。

## 样例包提交态

`samples/gray-tower` 是清洗后样例包：

- `accepted/*.jsonl` 为空。
- `candidates/candidates.jsonl` 为空。
- `review/*.jsonl` 为空。
- `reports/work_runs.jsonl` 为空。
- `compiled/reader_index.json` 是空 Accepted 基线编译产物。

测试所需分析数据由 fixture 在临时目录生成。不要把模型试跑数据或 fixture 输出混回提交态样例包。

## 主要技术债

- 第二卷前文信息尚未压缩 / 检索注入。
- 工作台作业粒度当前是章节，不是任意 scene / block range / 整卷。
- `work_runs.context_estimate` 只记录 block 数，不是 token 预算器。
- 同模型起草 / 复核目前只有文档要求，没有代码硬拒绝。
- `AgentStore` 的 Change `before` 仍不足以恢复 update / merge / deprecate。
- 工作台自动落盘后不会自动 validate / compile。
- 阅读器 UI 未实现。
