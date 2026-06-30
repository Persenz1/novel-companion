# novel-companion

面向长篇系列小说的本地交互式阅读增强系统，支持防剧透上下文、人物卡、说话人标注与 AI 辅助数据整理。

This repository stores the planning documents and future engineering files for a local interactive reading companion for long-running novel series.

## Current Status

This project is in phase 1 toolchain validation. 当前状态见 [Status](docs/status.md)。

Stages 1-4（原创测试书、清洗 Markdown、Parsed JSONL、硬校验）已经按当前工具链推进。Compiled 查询产物和 gray-tower fixture 也可用于验证防剧透查询。

Stages 5-8（AI Candidates、复核、Accepted 写入、数据工作台操作流）已按「AI 起草 + 独立 AI 复核 + 人审计异常」架构实现为图形化数据工作台（`tools/`，`npm run workbench`），见 [AI Workbench](docs/modules/ai-workbench.md)。三栏界面：左选章节范围 + 配置 API、中逐 block、右看标识 / 异常队列 / 审计回滚。工作台已有本地真实 LLM 试跑反馈；仓库内可复现测试仍使用无 key fixture，不提交 API key。

尚未完成：输入第二卷时的前卷上下文压缩 / 检索策略尚未实测，真实书籍长程制作尚未压测；最低限度 Markdown 阅读器尚未开始实现。

## Core Idea

The system is not just an EPUB reader. It is a local desktop reading companion for long-running narrative works:

- spoiler-safe character and entity context
- dialogue speaker labels
- cross-volume memory
- scene, event, relation, and arc tracking
- Chinese-first reading with optional Japanese reference text
- AI-assisted but human-reviewed data curation

## Documents

- [Docs Index](docs/README.md)
- [Requirements](docs/requirements.md)
- [Status](docs/status.md)
- [Bookpack Data](docs/modules/bookpack-data.md)
- [Toolchain](docs/modules/toolchain.md)
- [AI Workbench](docs/modules/ai-workbench.md)
- [Compiled Query](docs/modules/compiled-query.md)
- [Reader](docs/modules/reader.md)
- [Test Fixture](docs/modules/test-fixture.md)
- [Archive](docs/archive/README.md)
