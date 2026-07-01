# novel-companion

面向长篇系列小说的本地交互式阅读增强系统，支持防剧透上下文、人物卡、说话人标注与 AI 辅助数据整理。

本仓库存放本地长篇小说阅读伴侣的规划文档、数据格式、工具链和当前工程实现。

## 当前状态

项目当前处于本地数据包 + 网页工作台阶段。详细状态见 [当前状态](docs/status.md)。

阶段 1-4（原创测试书、清洗 Markdown、Parsed JSONL、硬校验）已经按当前工具链落地。编译查询产物和 gray-tower 测试夹具可用于验证防剧透查询。

阶段 5-8（AI 候选、复核、Accepted 写入、数据工作台操作流）已按「AI 起草 + 独立 AI 复核 + 人审计异常」架构实现为图形化数据工作台（`tools/`，`npm run workbench`），见 [AI 数据工作台](docs/modules/ai-workbench.md)。三栏界面：左选章节范围 + 配置 API、中间逐段落块展示正文、右侧查看标识 / 异常队列 / 审计回滚。工作台已有本地真实大模型试跑反馈；仓库内可复现测试仍使用无密钥测试夹具，不提交 API 密钥。

Markdown 阅读器已实现并**与工作台合并**（`tools/`，`npm run workbench` 一起启动：工作台 `/`、阅读器 `/reader/`，共用配置）。中文正文为唯一主轴，连续阅读推进 `read_boundary`、跳读不推进、可鼠标点选 block，右侧增强面板按已读边界防剧透过滤。**中日双语为逐段交替显示**（真正双语，非参考对照），可切换中日双语 / 仅中文 / 仅日文，见 [阅读器](docs/modules/reader.md)。

样例卷 `samples/gray-tower` 已扩为 **4 卷中日双语**，埋有跨卷线索（实体复用、点数弧线、许映白身份伏笔卷 3 回收）。DeepSeek A 阶段四卷长程压力已跑通：全局 Accepted 结构化记忆 + 当前卷正文足以支撑主线连续性，结果见 [长程 A 阶段结果](docs/modules/long-range-test-phase-a-2026-07-01.md)。

清洗模块已从“已切好的 Markdown 包”往前推进到 EPUB：受控 EPUB 测试夹具、EPUB 导入器、MiMo 章节任务包、MiMo 无界面调用和 `/cleaning/` 一键清洗最小可用版本已落地。下一步是多卷 EPUB、真实书籍样式和 AI 清洗建议写回策略。

尚未完成：真实（版权）书籍长程压测、多卷 EPUB 解包/清洗、DeepSeek 缓存成本优化、B 阶段前卷梗概 / 词元预算器、同名实体批量合并，以及更新 / 合并 / 废弃操作的完整回滚语义。

## 核心理念

这个系统不只是 EPUB 阅读器，而是面向长篇叙事作品的本地阅读伴侣：

- 防剧透的人物、实体和术语上下文。
- 对话说话人标注。
- 跨卷记忆。
- 场景、事件、关系和剧情线追踪。
- 中文主轴阅读，日文文本可选显示。
- AI 辅助、人工可审计的数据整理流程。

## 文档入口

- [文档首页](docs/README.md)
- [需求层](docs/requirements.md)
- [当前状态](docs/status.md)
- [数据包格式](docs/modules/bookpack-data.md)
- [工具链](docs/modules/toolchain.md)
- [EPUB 清洗流水线](docs/modules/cleaning-pipeline.md)
- [模型供应商适配](docs/modules/provider-adapters.md)
- [AI 数据工作台](docs/modules/ai-workbench.md)
- [编译查询](docs/modules/compiled-query.md)
- [阅读器](docs/modules/reader.md)
- [长程制作测试](docs/modules/long-range-test.md)
- [长程 A 阶段结果](docs/modules/long-range-test-phase-a-2026-07-01.md)
- [测试夹具](docs/modules/test-fixture.md)
- [历史归档](docs/archive/README.md)
