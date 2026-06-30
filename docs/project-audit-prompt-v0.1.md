# 项目审核提示词 v0.1

```text
你正在审核 `novel-companion` 项目的需求、规格和阶段提示词。

请先阅读以下文档：

- README.md
- docs/requirements-v0.1.md
- docs/requirements-v0.2.md
- docs/requirements-v0.3.md
- docs/phase-1-implementation-spec.md
- docs/data-format-v0.1.md
- docs/validation-spec-v0.1.md
- docs/workflow-spec-v0.1.md
- docs/agent-operation-spec-v0.1.md
- docs/project-prompts-v0.1.md
- docs/test-book-gray-tower.md
- docs/discussion-archive-2026-06-30.md

审核目标：

1. 判断当前项目文档是否完整覆盖第一阶段目标。
2. 检查各文档之间是否存在概念、字段、流程、目录结构或职责边界冲突。
3. 检查数据格式是否足以支撑：
   - 清洗 Markdown
   - Parsed JSONL
   - 硬校验
   - AI Candidates
   - 内置制作 Agent
   - block 复核工作台
   - Accepted 数据
   - Compiled 查询
   - Markdown 阅读器
4. 检查 Agent 驱动的数据制作原则是否与 AI 边界、人工复核、Accepted 写入规则一致。
5. 检查阅读器 read_boundary/current_block、防剧透查询和右侧增强面板规则是否清晰。
6. 检查测试书《灰塔学院测试卷》是否足以覆盖第一阶段验收。
7. 找出过度设计、不足设计、模糊点和后续实现风险。

请按以下结构输出审核结果：

一、总体判断
- 用简短段落说明项目当前完整程度和可执行程度。

二、阻塞级问题
- 列出会阻碍第一阶段开工或导致实现方向错误的问题。
- 每条说明涉及文档和具体位置或章节。

三、重要但不阻塞的问题
- 列出需要尽快澄清但不阻止开工的问题。

四、文档间冲突
- 列出字段名、目录结构、流程顺序、职责边界等不一致之处。

五、缺失内容
- 列出当前文档还缺什么。

六、过度设计或可延后内容
- 列出第一阶段可能不必现在实现的内容。

七、建议的修订清单
- 按优先级给出具体修订建议。

八、建议的开工顺序
- 给出你认为最稳妥的第一阶段实现顺序。

要求：

- 不要默认赞同现有设计。
- 不要为了礼貌回避问题。
- 不要直接重写全部文档。
- 以审查、指出风险和提出修订建议为主。
- 如果某个问题只是推测，请明确标注为推测。
```

