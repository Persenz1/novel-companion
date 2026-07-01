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

## 已实现并已长程验证

- Web 数据工作台：`tools/src/server.ts` + `tools/web/*`。
- 起草 / 复核流水线：`tools/src/agent/pipeline.ts`。
- 本地模型配置：`tools/.workbench-config.json`，已 gitignore。
- 自动写入：`AgentStore.write()` 写 Accepted + Change。
- 异常队列：复核升级项写 `review/review_items.jsonl`。
- 回滚入口：单 Change / 整批 work_run。
- Markdown 阅读器：`tools/src/reader.ts` + `tools/web/reader/`。阅读标尺推算 `current_block`，连续阅读推进 `read_boundary`，跳读 / 目录跳转 / 大幅拖动不推进，也可鼠标点选 block；右侧面板按 `read_boundary` 调 `getVisibleContext`，越界时提示预览。目录为推开式独立栏，不遮挡正文。
- 中日双语显示（真正双语，非参考对照）：逐段交替（中文段 + 其日文段），可切 中日双语 / 仅中文 / 仅日文。日文按 block 1:1 存于 `source/ja/{vol}.blocks.json`，阅读器侧读入合并；中文仍是唯一时间线主轴、防剧透基准；核心 parser/validator/compiler/schema 不受影响。读侧逻辑抽到 `tools/src/readerView.ts`。
- 界面合并：`npm run workbench` 同一服务器同时提供工作台（`/`）和阅读器（`/reader/`），共用同一份配置，顶栏互相跳转。
- DeepSeek 长程 Phase A 实跑：drafter=`deepseek-chat`、reviewer=`deepseek-reasoner`，已按 `modules/long-range-test.md` 在 `/tmp/gt-longrange-4vol-final2` 跑通 gray-tower `v01`-`v04`。每卷结束均 validate + compile 通过；实体复用、许映白身份伏笔回收、未寄出的名单长线、D 班点数弧线均成立。脱敏结果见 `modules/long-range-test-phase-a-2026-07-01.md`。

真实 LLM 长程验证依赖本机 API key，没有进入仓库可复现测试；仓库自动测试仍不调用模型。

## 样例包提交态

`samples/gray-tower` 是清洗后样例包，现为 **4 卷**（`v01`–`v04`，中日双语，埋有跨卷线索）：

- `accepted/*.jsonl` 为空。
- `candidates/candidates.jsonl` 为空。
- `review/*.jsonl` 为空。
- `reports/work_runs.jsonl` 为空。
- `compiled/reader_index.json` 是空 Accepted 基线编译产物。

测试所需分析数据由 fixture 在临时目录生成。长程测试也须在工作副本上跑（见 `modules/long-range-test.md` 和 `modules/long-range-test-phase-a-2026-07-01.md`）。不要把模型试跑数据或 fixture 输出混回提交态样例包。

## 主要技术债

- 长程 Phase A 已证明「全局 accepted + 当前卷正文」足以支撑 gray-tower 4 卷主线；暂不急着做卷/章级梗概、token 预算器、可选 RAG。下一步优先补 review item 批量裁决 / 批量转 open_question。
- 复核能识别部分重复实体并升级，但还没有批量合并/裁决入口。
- 工作台作业粒度当前是章节，不是任意 scene / block range / 整卷。
- `work_runs.context_estimate` 只记录 block 数；真实模型调用已记录 `token_usage`，但尚未做 token 预算器。
- 同模型起草 / 复核目前只有文档要求，没有代码硬拒绝。
- `AgentStore` 已避免实体 first_seen 被后卷覆盖、避免非实体同 ID 内容静默覆盖；但 Change `before` 仍不足以恢复完整 update / merge / deprecate。
- 工作台自动落盘后不会自动 validate / compile（跑完 agent 要手动 validate + compile，阅读器右栏才更新）。
- 阅读器未做真实书籍长程阅读压测；提交态样例包 accepted 为空，右栏走空态，需跑 agent 或 fixture 填数据后才见实体 / 卡片。
