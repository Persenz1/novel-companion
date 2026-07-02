# 当前状态

本文件以当前代码和样例数据为准。

## 已实现并自动化验证

- CLI：`parse` / `validate` / `compile` / `query`。
- Parser：Markdown + manifest -> Parsed JSONL + cleaning report。
- Validator：校验 manifest、Markdown、Parsed、Accepted、Candidates、Review、Compiled。
- Compiler：生成 `compiled/reader_index.json`，且要求 validation report 为 `passed`。
- Query：`getVisibleContext(current_block, read_boundary, options)` 按 `read_boundary` 防剧透过滤。
- EPUB 清洗基础：`export-epub` / `import-epub` / `prepare-mimo` 已用受控 gray-tower fixture 验证，可导入、parse、validate 并生成章节任务包；真实模型调用不进入仓库自动测试。
- 清洗流水线 v2（确定性规范化 + 建议应用器 + 裁决队列 + 快照回滚 + 收口 gate）：见 `modules/cleaning-pipeline-v2-design.md`。CLI `normalize` / `ingest-cleaning` / `apply-cleaning` / `cleaning-changes` / `rollback-cleaning` / `cleaning-readiness`，HTTP `/api/cleaning/{normalize,ingest,items,items/resolve,items/apply,changes,rollback,readiness}`，`/cleaning/` 新增「裁决队列」页。`markdownEdit` 有单测（node:test 24 例）。真实 COTE 三卷已端到端验证（见下）。
- gray-tower fixture：在临时目录生成 Candidates / Review / Accepted / work_runs，不调用模型。
- 自动测试：19 个 node:test 用例覆盖 marker 解析和 query 防剧透行为。

## 已实现并已长程验证

- Web 数据工作台：`tools/src/server.ts` + `tools/web/*`。
- 起草 / 复核流水线 v2：`tools/src/agent/pipeline.ts` + `prompts.ts`。2026-07-02 重构为「卷 + pass」运行（1 实体名册 / 2 事实数值术语 / 3 事件关系 / 4 说话人密集标注），窗口对齐 separator/章节边界、稳定前缀（全卷正文+已确认记忆在前，变化区仅 ~0.5%）吃前缀缓存、JSONL 容截断输出 + 自动续写、说话人全覆盖契约（缺判定自动补跑）、关系变化/歧义说话人代码级强制升级。入口：工作台 pass 选择器、CLI `draft-pass` / `review-pass`、`POST /api/draft|review {volume_id, pass}`。设计与 v1 缺陷实据见 `modules/drafting-review-v2-design.md`。2026-07-02 已用 DeepSeek 对 v01 实跑部分验证：缓存命中率稳定 99.5%+（控制台侧同步观察到提升）、密度与章长解耦、relation_change 强制升级生效、复核有真实判断力；跑到 speakers 中段遇 DeepSeek 官方服务故障中断，**当日测试产出已全部从数据包回滚**，完整重跑清单见设计文档 §10 待测清单。
- 本地模型配置：`tools/.workbench-config.json`，已 gitignore。
- 自动写入：`AgentStore.write()` 写 Accepted + Change。
- 异常队列：复核升级项写 `review/review_items.jsonl`。单项裁决 `POST /api/queue/resolve`；**批量裁决** `POST /api/queue/resolve-batch`（接受 / 拒绝 / 批量转 open_question，`resolveExceptionsBatch` 一次读写、open_question 顺序 ID 批内累进）。工作台队列面板支持勾选 / 全选 / 按类型选（如 relation_change）+ 批量操作。
- 落盘后收口：`POST /api/compile`（先 validate 再 compile），队列面板「重新编译」按钮一键刷新阅读器右栏。
- 多模态识图：config 加 `vision` 角色（OpenAI 兼容，如 MiMo `mimo-v2.5`）；`llm.chat` 支持图文混合内容 + `imagePart()` + 双鉴权头（Bearer/api-key）；`nc describe-image <path>` CLI 可对任意图跑识别。
- 清洗工作台：`/cleaning/` 页 + `tools/src/cleaning/*`。当前主入口是“填 EPUB 路径 -> 开始自动清洗”：可填单本 EPUB，也可多行填多个单卷 EPUB，系统按卷号 / 输入顺序导入到同一 bookpack，自动 parse + validate、生成全书 MiMo 章节任务、逐章调用 MiMo 并展示进度和建议。图片 alt 标注仍保留，人工确认后 `POST /api/cleaning/set-alt` 写回卷 Markdown 的 asset 标记并重解析。图片身份在**清洗阶段**定死，操作阶段（纯文本 DeepSeek）直接信任，不把多模态接进 agent。已用真实插图验证（单人/五人群像按名册认人正确）。**清洗→起草→复核→批量裁决→compile→阅读 一条龙已端到端跑通**（工作副本上：MiMo 标注图片→写回 Markdown→reparse→起草复核→compile→阅读器右栏显示确认后的图注）。
- 配置形态（对齐 DeepSeek 官方文档）：base_url 用 `https://api.deepseek.com`，起草 `deepseek-v4-flash`、复核 `deepseek-v4-pro`（旧 `deepseek-chat` / `deepseek-reasoner` 将于 2026/07/24 弃用）；设置面板新增「识图模型」栏，MiMo 可在界面直接配置，无需手改 `.workbench-config.json`。`llm.chat` 区分 `max_tokens`（DeepSeek 等）与 `max_completion_tokens`（MiMo 等推理模型）两套上限，起草调用固定 `max_tokens=8192` 防多候选 JSON 被 4096 默认值截断。DeepSeek / MiMo 默认开启 thinking，但应用层只读取最终 `content`，不展示、不保存推理正文。工作副本建议放在 `/tmp` 之外的持久目录（如 `~/nc-workpack/gray-tower`），避免重启清空 `/tmp` 后数据包丢失。
- 用量计费器：`GET /api/usage` 聚合 `reports/work_runs.jsonl`、`reports/cleaning_mimo_outputs/*.json` 与 `reports/ja_alignment_mimo_outputs/*.json`，工作台和清洗页右侧「用量」页签按匹配 / 清洗 / 起草 / 复核阶段 + 模型拆分显示输入、缓存命中 / 未命中、输出、推理、图片 token 和缓存命中率；当前只记录 token 原始账本，不硬编码供应商单价。供应商控制台与本地 usage 账本存在明显口径差异，后续需单独做 request_id 级别 usage audit。
- 回滚入口：单 Change / 整批 work_run。
- Markdown 阅读器：`tools/src/reader.ts` + `tools/web/reader/`。阅读标尺推算 `current_block`，连续阅读推进 `read_boundary`，跳读 / 目录跳转 / 大幅拖动不推进，也可鼠标点选 block；右侧面板按 `read_boundary` 调 `getVisibleContext`，越界时提示预览。目录为推开式独立栏，不遮挡正文。2026-07-02：右栏增强区已清空为占位（旧的 9 类卡片列表信息过载，待基于 v2 数据重建）；新增**说话人文字标签**——正文左侧空白处逐句显示说话人（数据来自 `accepted/speaker_labels.jsonl`，群体说话有标记则显示），顶栏开关切换，且按 `visible_from` 对 `read_boundary` 防剧透（未读到揭示点不显示）。
- 中日双语显示（真正双语，非参考对照）：逐段交替（中文段 + 其日文段），可切 中日双语 / 仅中文 / 仅日文。日文按 block 1:1 存于 `source/ja/{vol}.blocks.json`，阅读器侧读入合并；中文仍是唯一时间线主轴、防剧透基准；核心 parser/validator/compiler/schema 不受影响。读侧逻辑抽到 `tools/src/readerView.ts`。
- 界面合并：`npm run workbench` 同一服务器同时提供工作台（`/`）和阅读器（`/reader/`），共用同一份配置，顶栏互相跳转。
- DeepSeek 长程 Phase A 实跑：历史工作副本 `/tmp/gt-longrange-4vol-final2` 已跑通 gray-tower `v01`-`v04`。当时使用的是旧模型名，复跑应按 `provider-adapters.md` 使用当前 `deepseek-v4-flash` / `deepseek-v4-pro`。每卷结束均 validate + compile 通过；实体复用、许映白身份伏笔回收、未寄出的名单长线、D 班点数弧线均成立。脱敏结果见 `modules/long-range-test-phase-a-2026-07-01.md`。
- 真实 COTE 三卷本轮结果已收口为本机主数据包 `~/nc-workpack/cote-bilingual-v1`，后续不再重复清洗 / 日文匹配 / 起草 / 复核：
  - v01 日文匹配：`source/ja/v01.blocks.json` 中故事正文 `3857/3857` 全覆盖；4 条中文译注进入 `review/ja_alignment_items.jsonl`，不强行匹配、不进入结构化抽取。
  - v02/v03 MiMo 清洗：14 个正文章节完成，36 条低风险建议全部应用；v02/v03 正文图片缺图注为 0，锚点有效。v01 此前一次 normalize 被回滚且未重跑，遗留 30 处场景分隔符残留段（旧文档误记为「用户确认基线」，实无此决策）；2026-07-02 已补跑 `normalize` 修复全部 30 处并重新 validate + compile 通过。
  - DeepSeek 起草 / 复核：v01-v03 最终 `validate` + `compile` passed，Accepted 283，review item 30，work_runs 53。起草使用 `deepseek-v4-flash`，复核使用 `deepseek-v4-pro`。
  - 实跑中暴露并修复两个生产级问题：真实长章 JSON 输出截断（候选数收敛到最多 15 条）；模型偶尔输出短 block id（候选入库前补全为当前章节完整 block id）。
  - 当前结论：清洗、匹配、起草、复核阶段足够作为后续阅读器作业基线，但尚不作为无监督批处理流水线；后续重点转向角色卡、时间线、说话人显示和 usage 对账。

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

真实商业 EPUB 测试语料放在 `samples/real-epubs/`（本机，`*.epub` 已被 `.gitignore` 忽略，正文不入库）。只有测试登记表 + 预期基线 + 已知怪癖入库，见 `modules/real-epub-test-corpus.md` 与 `modules/compatibility-testing-plan.md`。当前语料：COTE 中译 v01/v02/v03 与日文原版 v01；本轮结果已固化到 `~/nc-workpack/cote-bilingual-v1`，真实书正文和模型输出不提交入库。

## 主要技术债

- 长程 Phase A 已证明「全局 accepted + 当前卷正文」足以支撑 gray-tower 4 卷主线；暂不急着做卷/章级梗概、token 预算器、可选 RAG。
- 复核仍只识别部分重复实体并升级；批量**裁决**已有入口（见下），但批量**合并**同名实体尚无专用入口。
- 工作台作业粒度已从章节改为「卷 + pass + 自动窗口」（v2）；任意 scene / block range 的手动指定仍未支持。v2 已部分实跑验证（见上），但 v01 speakers 及 v02/v03 全部 pass 待重跑；v1 的产出（cote-bilingual-v1 的 Accepted 283）覆盖密度不足（6143 对话块仅 1 条说话人、relation_change 为 0、后卷密度崩塌），v2 重跑完成后需对照替换。v2 已知工程缺口：重跑同 pass 不跳过已完成窗口（无 resume-skip），中断续跑会重复产候选。
- `work_runs.context_estimate` 只记录 block 数；真实模型调用已记录 `token_usage` 并可通过 `/api/usage` 聚合查看，但尚未做 token 预算器，也尚未与 DeepSeek / MiMo 控制台按 request_id 对账。
- 同模型起草 / 复核目前只有文档要求，没有代码硬拒绝。
- `AgentStore` 已避免实体 first_seen 被后卷覆盖、避免非实体同 ID 内容静默覆盖；但 Change `before` 仍不足以恢复完整 update / merge / deprecate。
- 清洗 MiMo 建议的通用应用器已实现（`applySuggestion` + `cleaningStore.commitVolumeChange`：采纳 -> 改 Markdown/manifest -> reparse/validate -> 失败自动回滚 -> 记 `accepted/cleaning_changes.jsonl`）；仍未做的是 split_block/merge_blocks 自动化（当前人工）。
- EPUB importer 多个单卷 EPUB append 汇入同一 bookpack 已用真实 COTE 三卷（v01/v02/v03）验证通过；真实 EPUB 的脚注 / 跨文件章节 / 异常 nav 仍需继续扩大样本（见 `modules/compatibility-testing-plan.md`）。
- 非主线页已按强信号分类章节 kind（`classifyChapterKind`）。清洗任务和阅读器按“书籍可读材料”纳入封面 / 制作信息 / 目录 / 彩页 / 后记 / 特典；agent 整卷背景仍按 `isBodyChapterKind` 只抽故事正文，避免把前后页当剧情证据。
- 阅读器防剧透已在 4 卷、填满 accepted 的工作副本上做过长程压测（gray-tower `v01`–`v04`，239 个时间线位置全扫）：0 越界泄漏、0 非单调回退，reveal 曲线单调（实体 14→23→31→36、relation_change 1→4→7→10），spoiler-bound 关系卡在其 `visible_from` 前一块隐藏、到位后出现。**真实书籍**级别的长程阅读压测仍未做；提交态样例包 accepted 为空，右栏走空态，需跑 agent 或 fixture 填数据后才见实体 / 卡片。
