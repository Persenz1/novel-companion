# novel-companion 文档入口

当前文档只保留两层：需求层和模块实现层。历史讨论、旧规格和提示词已归档到 `archive/2026-06-30/`，不再作为默认接手入口。

## 阅读顺序

1. `requirements.md`：产品目标、阶段边界、硬约束和未完成需求。
2. `status.md`：当前代码事实、已验证范围、风险和下一步。
3. `modules/`：逐模块查看需求、实现、验证和缺口。

## 模块文档

- `modules/bookpack-data.md`：bookpack、Markdown、Parsed / Accepted / Candidate / Review 文件。
- `modules/toolchain.md`：CLI、Parser、Validator、Compiler、测试命令。
- `modules/ai-workbench.md`：AI 起草、独立复核、数据工作台、Change 和回滚。
- `modules/compiled-query.md`：`reader_index.json` 与 `getVisibleContext()`。
- `modules/reader.md`：最低限度 Markdown 阅读器的需求与未实现项。
- `modules/test-fixture.md`：gray-tower 样例包、fixture 和验收边界。

## 当前判断规则

- 代码事实优先于旧文档。
- 仓库可复现测试不调用真实模型、不需要 API key。
- `samples/gray-tower` 提交态保持为清洗后样例包，不保存 AI 后处理数据。
- 旧文档如与本层文档冲突，以本层文档和当前代码为准。
