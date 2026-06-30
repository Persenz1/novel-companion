# novel-companion

面向长篇系列小说的本地交互式阅读增强系统，支持防剧透上下文、人物卡、说话人标注与 AI 辅助数据整理。

This repository stores the planning documents and future engineering files for a local interactive reading companion for long-running novel series.

## Current Status

This project is in phase 1 toolchain validation.

Stages 1-4（原创测试书、清洗 Markdown、Parsed JSONL、硬校验）已经按当前工具链推进。Compiled 查询产物和 gray-tower fixture 也可用于验证防剧透查询。

Stages 5-8（AI Candidates、复核、Accepted 写入、数据工作台操作流）已按「AI 起草 + 独立 AI 复核 + 人审计异常」架构实现为图形化数据工作台（`tools/`，`npm run workbench`），见 [Post-cleaning Operation Design v0.2](docs/post-cleaning-operation-design-v0.2.md)。三栏界面：左选章节范围 + 配置 API、中逐 block、右看标识 / 异常队列 / 审计回滚。读写全链路已用 gray-tower 验证，实际 LLM 调用待接入 API key。

## Core Idea

The system is not just an EPUB reader. It is a local desktop reading companion for long-running narrative works:

- spoiler-safe character and entity context
- dialogue speaker labels
- cross-volume memory
- scene, event, relation, and arc tracking
- Chinese-first reading with optional Japanese reference text
- AI-assisted but human-reviewed data curation

## Documents

- [Requirements v0.3](docs/requirements-v0.3.md)
- [Phase 1 Implementation Spec](docs/phase-1-implementation-spec.md)
- [Phase 1 Design Decisions](docs/phase-1-design-decisions-v0.1.md)
- [Data Format v0.1](docs/data-format-v0.1.md)
- [Validation Spec v0.1](docs/validation-spec-v0.1.md)
- [Workflow Spec v0.1](docs/workflow-spec-v0.1.md)
- [Agent Operation Spec v0.1](docs/agent-operation-spec-v0.1.md)
- [Compiled Query Spec v0.1](docs/compiled-query-spec-v0.1.md)
- [Project Prompts v0.1](docs/project-prompts-v0.1.md)
- [Project Audit Prompt v0.1](docs/project-audit-prompt-v0.1.md)
- [Gray Tower Test Book](docs/test-book-gray-tower.md)
- [Post-cleaning Operation Design v0.2](docs/post-cleaning-operation-design-v0.2.md)
- [Phase 5-8 Operation Redesign Note](docs/phase-5-8-operation-redesign-note.md)
- [Discussion Archive 2026-06-30](docs/discussion-archive-2026-06-30.md)
- [Requirements v0.2 historical draft](docs/requirements-v0.2.md)
- [Requirements v0.1 historical draft](docs/requirements-v0.1.md)
