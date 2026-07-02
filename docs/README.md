# novel-companion 文档入口

当前文档只保留两层：需求层和模块实现层。历史讨论、旧规格和提示词已归档到 `archive/2026-06-30/`，不再作为默认接手入口。

## 阅读顺序

1. `requirements.md`：产品目标、阶段边界、硬约束和未完成需求。
2. `status.md`：当前代码事实、已验证范围、风险和下一步。
3. `modules/`：逐模块查看需求、实现、验证和缺口。

## 模块文档

- `modules/bookpack-data.md`：bookpack、Markdown、Parsed / Accepted / Candidate / Review 文件。
- `modules/toolchain.md`：CLI、Parser、Validator、Compiler、测试命令。
- `modules/cleaning-pipeline.md`：EPUB 导入、AI 清洗、写回 bookpack 的前端清洗流水线（MVP）。
- `modules/cleaning-pipeline-v2-design.md`：清洗流水线 v2（确定性规范化 + 建议应用器 + 裁决队列 + 快照回滚 + 收口 gate），设计与实现落点。
- `modules/real-epub-test-corpus.md`：真实 EPUB 测试语料登记表（预期基线 + 已知怪癖）。
- `modules/compatibility-testing-plan.md`：真实 EPUB 极端兼容性测试规划。
- `modules/real-book-bilingual-long-range-test.md`：本轮真实书籍中日匹配、阅读器渲染与长程处理测试计划。
- `modules/provider-adapters.md`：DeepSeek / MiMo 等模型供应商适配层。
- `modules/ai-workbench.md`：AI 起草、独立复核、数据工作台、Change 和回滚。
- `modules/drafting-review-v2-design.md`：起草/复核 v2（分 pass 抽取 + 稳定前缀缓存），设计与实测进展。
- `modules/drafting-review-v2-three-volume-test-2026-07-03.md`：起草/复核 v2 三卷（COTE）真实全量测试结果、过程中修复的 6 个数据完整性 bug、speakers pass 放弃记录。
- `modules/compiled-query.md`：`reader_index.json` 与 `getVisibleContext()`。
- `modules/reader.md`：Markdown 阅读器（已实现）＋ 中日双语逐段显示。
- `modules/test-fixture.md`：gray-tower 4 卷样例包、fixture 和验收边界。
- `modules/long-range-test.md`：跨卷上下文的测试执行手册。
- `modules/long-range-test-phase-a-2026-07-01.md`：DeepSeek 四卷 Phase A 长程压力测试结果与下一步。
- `modules/next-session-cleaning-and-multivolume.md`：下一轮阅读器作业、结果包验收和 usage 对账计划。

## 当前判断规则

- 代码事实优先于旧文档。
- 本层文档必须把状态写清楚：`已实现`、`已验证`、`待验证`、`待设计` 不混写。
- `status.md` 只记录当前代码事实和真实验证结果，不写远期愿景。
- 模块文档可以保留下一步设计，但必须放在明确的“未完成 / 下一步”段落里。
- 仓库可复现测试不调用真实模型、不需要 API key。
- `samples/gray-tower` 提交态保持为清洗后样例包，不保存 AI 后处理数据。
- 旧文档如与本层文档冲突，以本层文档和当前代码为准。
