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
- 异常队列：复核升级项写 `review/review_items.jsonl`。单项裁决 `POST /api/queue/resolve`；**批量裁决** `POST /api/queue/resolve-batch`（接受 / 拒绝 / 批量转 open_question，`resolveExceptionsBatch` 一次读写、open_question 顺序 ID 批内累进）。工作台队列面板支持勾选 / 全选 / 按类型选（如 relation_change）+ 批量操作。
- 落盘后收口：`POST /api/compile`（先 validate 再 compile），队列面板「重新编译」按钮一键刷新阅读器右栏。
- 多模态识图：config 加 `vision` 角色（OpenAI 兼容，如 MiMo `mimo-v2.5`）；`llm.chat` 支持图文混合内容 + `imagePart()` + 双鉴权头（Bearer/api-key）；`nc describe-image <path>` CLI 可对任意图跑识别。
- 清洗·图片标注（Phase 1）：`/cleaning/` 页 + `src/cleaning/imageAnnotate.ts`。vision 模型看图给出 alt + 描述（可按角色名册认人），人工确认后 `POST /api/cleaning/set-alt` 写回卷 Markdown 的 asset 标记并重解析。图片身份在**清洗阶段**定死，操作阶段（纯文本 DeepSeek）直接信任，不把多模态接进 agent。已用真实插图验证（单人/五人群像按名册认人正确）。**清洗→起草→复核→批量裁决→compile→阅读 一条龙已端到端跑通**（工作副本上：MiMo 标注图片→写回 Markdown→reparse→起草复核→compile→阅读器右栏显示确认后的图注）。
- 配置形态（对齐 DeepSeek 官方文档）：base_url 用 `https://api.deepseek.com`，起草 `deepseek-chat`、复核 `deepseek-reasoner`；设置面板新增「识图模型」栏，MiMo 可在界面直接配置，无需手改 `.workbench-config.json`。`llm.chat` 区分 `max_tokens`（DeepSeek 等）与 `max_completion_tokens`（MiMo 等推理模型）两套上限，起草调用固定 `max_tokens=8192` 防多候选 JSON 被 4096 默认值截断。工作副本建议放在 `/tmp` 之外的持久目录（如 `~/nc-workpack/gray-tower`），避免重启清空 `/tmp` 后数据包丢失。
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
- v01 的 5 张图片现为**真实插图**（`assets/images/v01_img_00{1..5}.png`：林澈立绘 / 银发少女读信 / 灰塔夜景 / 点数榜 / 五人群像），供清洗·图片标注与阅读器测试；不再是占位 SVG。

测试所需分析数据由 fixture 在临时目录生成。长程测试也须在工作副本上跑（见 `modules/long-range-test.md` 和 `modules/long-range-test-phase-a-2026-07-01.md`）。不要把模型试跑数据或 fixture 输出混回提交态样例包。

## 主要技术债

- 长程 Phase A 已证明「全局 accepted + 当前卷正文」足以支撑 gray-tower 4 卷主线；暂不急着做卷/章级梗概、token 预算器、可选 RAG。
- 复核仍只识别部分重复实体并升级；批量**裁决**已有入口（见下），但批量**合并**同名实体尚无专用入口。
- 工作台作业粒度当前是章节，不是任意 scene / block range / 整卷。
- `work_runs.context_estimate` 只记录 block 数；真实模型调用已记录 `token_usage`，但尚未做 token 预算器。
- 同模型起草 / 复核目前只有文档要求，没有代码硬拒绝。
- `AgentStore` 已避免实体 first_seen 被后卷覆盖、避免非实体同 ID 内容静默覆盖；但 Change `before` 仍不足以恢复完整 update / merge / deprecate。
- 阅读器防剧透已在 4 卷、填满 accepted 的工作副本上做过长程压测（gray-tower `v01`–`v04`，239 个时间线位置全扫）：0 越界泄漏、0 非单调回退，reveal 曲线单调（实体 14→23→31→36、relation_change 1→4→7→10），spoiler-bound 关系卡在其 `visible_from` 前一块隐藏、到位后出现。**真实书籍**级别的长程阅读压测仍未做；提交态样例包 accepted 为空，右栏走空态，需跑 agent 或 fixture 填数据后才见实体 / 卡片。
