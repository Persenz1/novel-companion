# 2026-06-30 讨论归档

本文件归档 2026-06-30 关于第一阶段数据格式、制作流程、阅读器边界和测试样本的讨论结论。它用于保留决策脉络；正式执行规范见同目录下的 v0.3 需求和各规格文件。

## 1. 文档组织决策

不再把所有内容继续堆成一个巨大的需求 v3。采用“总需求 + 分规格”的方式：

- `requirements-v0.3.md`：产品定位、边界、第一阶段目标。
- `phase-1-implementation-spec.md`：第一阶段模块闭环和实现顺序。
- `data-format-v0.1.md`：Markdown、manifest、Parsed、Accepted、Candidates 等文件格式。
- `validation-spec-v0.1.md`：硬校验、软校验和返工报告。
- `workflow-spec-v0.1.md`：人和 AI 的制作协作流程。
- `test-book-gray-tower.md`：原创测试书《灰塔学院测试卷》的设计。

本归档文件保留讨论过程中的取舍和理由，便于后续回溯。

## 2. Markdown 主文本

清洗后主文本采用一卷一个 Markdown 文件，例如 `parsed/volumes/v01.md`。

block 切分采用“自然段优先，人工可例外拆分”：

- 默认一个自然段等于一个 block。
- 对话段、旁白段、独立说明段通常各自成 block。
- 不默认切到句子级。
- 同一自然段里如果存在多个需要独立防剧透定位的事实、数值变化、身份揭示、说话人切换，可以人工拆成多个 block。
- 进入 Candidates、Review、Accepted 引用阶段后，block ID 原则上冻结。

block ID 采用每章重置：

```text
v01.c03.b0042
```

- `v01` 为卷号。
- `c03` 为普通章节号。
- `b0042` 为章内 block 号。
- block 号每章从 `b0001` 开始。
- 后续插入 block 时使用可排序后缀，例如 `v01.c03.b0042a`。

特殊章节允许语义 ID：

```text
v01.prologue
v01.interlude01
v01.epilogue
v01.afterword
v01.extra01
```

章节顺序不靠 ID 猜测，必须由 manifest 中的章节列表声明。

Markdown 注释采用单行键值格式，不使用多行 JSON：

```md
<!-- chapter: v01.c01 kind: chapter title: "第一章 试探" -->
<!-- block: v01.c01.b0001 kind: paragraph -->
<!-- scene: start v01.c01.s001 title: "教室里的通知" -->
<!-- scene: end v01.c01.s001 -->
<!-- asset: v01_img_001 anchor: after v01.c01.b0002 alt: "教室插图" -->
<!-- alignment: v01.c01.a001 blocks: v01.c01.b0002 -->
```

复杂结构不塞进 Markdown 注释，放到 JSONL。

## 3. Scene 定义

scene 是“场景”，不是防剧透边界，也不是复核最小单位。

它表示一段连续 block 构成的语义场景，例如教室对话、宿舍谈话、特别考试规则说明、小组行动、学生会会议、独白、回忆片段等。

scene 的作用：

- 辅助 AI 判断说话人。
- 辅助工作台显示上下文。
- 辅助右侧面板识别当前场景人物。
- 辅助事件抽取和关系变化判断。

scene 第一阶段允许但不强制：

- 有 scene 标记时生成 `parsed/scenes.jsonl`。
- 没有 scene 标记时，阅读器和 block 校验仍可正常工作。
- scene 不跨章节，不嵌套，不交叉。
- 一个 block 默认只归属一个主 scene。

## 4. 中日对照

中文是唯一主轴。日文只作为参考资源，不进入主操作链路。

- 只有中文 block 进入解析、候选生成、人工复核、Accepted、Compiled、防剧透查询和阅读进度系统。
- 日文不建立独立 block。
- 日文不参与 `current_block`、`read_boundary`、`visible_from`、`source_span` 的主判定。
- 清洗阶段完成中日对照，生成 `parsed/alignments.jsonl`。
- 最终阅读器根据开关渲染中文或中文 + 日文参考。
- AI 操作阶段默认只处理中文；除非任务明确是修复/复核中日对齐。

## 5. manifest

`manifest.json` 是数据包的身份证和装箱单，不存正文，也不存人物事件。

第一阶段不拆 `series_config.json`，少量系列信息放在 manifest 内。manifest 负责：

- 标识数据包。
- 标识系列。
- 列出卷和主文本入口。
- 列出章节目录和顺序。
- 声明包类型。
- 声明是否包含正文、图片、日文参考。
- 声明权利/使用范围。
- 声明 schema 版本。

章节顺序在 manifest 中声明，parser 反过来校验 Markdown 中的章节是否匹配。

## 6. Parsed JSONL

Parsed 数据区包含：

```text
parsed/
  volumes/
    v01.md
  blocks.jsonl
  scenes.jsonl
  assets.jsonl
  asset_anchors.jsonl
  alignments.jsonl
```

`blocks.jsonl` 保存 block 正文副本。Markdown 仍是人类可编辑主文本，但 `blocks.jsonl` 可以直接作为结构化正文，方便 AI 切片、搜索、工作台复核和阅读包携带。

`block.kind` 第一阶段只要求少量类型：

- `paragraph`
- `dialogue`
- `separator`
- `note`

省略 `kind` 时视为 `paragraph`。

图片拆成三层：

- `parsed/assets.jsonl`：图片文件本体。
- `parsed/asset_anchors.jsonl`：图片出现位置。
- `accepted/asset_subjects.jsonl`：人工确认后的图片内容标注。

“图里是谁”属于知识判断，不属于纯解析结果。AI 或视觉模型只能提出候选，人工确认后进入 Accepted。

## 7. Accepted 数据

实体 ID 使用人工可读 slug，例如：

```text
entity_horikita
entity_d_class
term_oaa
```

不使用 UUID 作为主 ID。重名或歧义时加稳定后缀。

Fact 支持文本值和实体引用：

- `value_type: "string"` 时 `value` 为文本。
- `value_type: "entity"` 时同时提供 `value` 和 `value_entity_id`。

`valid_from`、`valid_until`、`visible_from`、`source_span` 分开建模。

Event 的摘要可以由 AI 起草，人工确认或修改后进入 Accepted。摘要必须受 `source_span` 和 `visible_from` 约束。

关系变化不强制 `relation_type`。第一阶段只记录 `entities`、`before`、`after`、`event_id`、时间线和来源。关系描述保留自然语言，因为关系判断带有主观性。

数值数据单独建模：

- `accepted/metrics.jsonl`
- `accepted/metric_changes.jsonl`

数值不允许推测。只知道发生变化但不知道具体值时，不生成精确当前值。

角色卡第一阶段进入 Accepted。角色卡可以由 AI 起草，人工确认；按稳定阶段生成，不按每个 block 生成。可用边界包括卷末、学期末、年级末等。

术语卡是轻量解释卡，术语本身仍是 Entity。

说话人标注允许一个 block 多条，但推荐清洗时一人一句拆 block。

## 8. 来源边界

第一阶段 Accepted 正式增强数据以正文为准。

- `source_span` 只引用中文正文 block。
- 官方说明书、附录、设定集暂不作为 Accepted 主来源。
- 说明书可以作为人工参考，形成 Review 备注或 OpenQuestion。
- 正文和说明书冲突时，第一阶段不自动吸收说明书内容。

## 9. Candidates 和 AI 输出

第一阶段统一一个文件：

```text
candidates/candidates.jsonl
```

AI 默认按 block 或 block 范围批处理，但输出按候选拆行。每条候选必须绑定到具体 block 或 block range。

AI 可以提出新实体 ID，但只作为候选。人工可以接受、改 ID、合并或拒绝。

Candidate 的 `payload` 应尽量贴近目标 Accepted 对象结构，方便工作台直接转换。

AI 不直接输出 Change。Change 由工作台在人类操作后生成。

## 10. 校验报告

校验器不仅判定失败，还要给清洗 AI 提供返工清单。

`reports/validation_report.json` 中每条问题尽量包含：

- `code`
- `severity`
- `message`
- `file`
- `line`
- `block_id` / `chapter_id` / `object_id`
- `suggested_action`

`error` 阻断下一阶段，`warning` 不阻断但进入报告。

清洗流程形成“生成 -> 校验 -> 修复 -> 再校验”的闭环。

## 11. 数据工作台

人工复核最小单位是 block。scene 只是上下文提示和聚合视图。

工作台主视图：

- 左侧：卷、章节、复核进度、候选队列。
- 中间：当前 block 正文和前后上下文。
- 右侧：当前 block 相关候选。

操作包括接受、修改后接受、拒绝、合并实体、转为未决问题、跳过、标记 block 已复核。

block 复核状态可包括：

- `unreviewed`
- `ai_generated`
- `reviewing`
- `reviewed`
- `has_open_question`
- `skipped`

## 12. 阅读器进度

第一阶段阅读器做自动推进 + 右侧手动确认/返回边界。

- `current_block`：当前视口阅读标尺附近的 block。
- `read_boundary`：防剧透查询使用的已读边界。
- 正常连续阅读时，系统自动推进 `read_boundary`。
- 目录跳转、搜索跳转、大幅拖动、快速跳很多时，只更新 `current_block`，不自动推进 `read_boundary`。
- 当 `current_block` 超过 `read_boundary`，右侧增强面板仍按 `read_boundary` 查询。
- 右侧提供“标记至当前 block 为已读”和“返回已读边界”。
- 停留时间阈值做成可调参数，用测试书调默认值。

## 13. Compiled

第一阶段 Compiled 先用 JSON 查询产物，不急着上 SQLite：

```text
compiled/reader_index.json
```

源数据仍是 Markdown + JSONL。Compiled 用于验证阅读器查询、防剧透过滤和右侧面板展示。

最小查询概念：

```text
getVisibleContext(current_block, read_boundary, options)
```

所有增强数据按 `read_boundary` 过滤，`current_block` 只用于判断当前位置相关内容。

## 14. 测试书

第一阶段测试书使用原创校园特殊考试题材，暂定名：

```text
《灰塔学院测试卷》
```

用途：

- 避免版权文本。
- 模拟长篇轻小说/校园考试/人物关系密集作品。
- 覆盖数据结构和阅读器行为。
- 用来调自动推进、跳读、右侧确认和剧透过滤。

暂定结构：

```text
v01.prologue  序章：灰塔学院
v01.c01       第一章：点数公告
v01.c02       第二章：沉默的小组
v01.c03       第三章：白卡测试
v01.epilogue  终章：未寄出的名单
```

## 15. 阶段 5-8 操作逻辑回滚与重构决定

2026-06-30 后续实现尝试中，曾基于现有文档实现清洗后数据操作阶段的 Agent、DeepSeek 候选生成和 Web 工作台原型。原型覆盖了候选预览、写入 Candidates、候选详情、人工接受/拒绝/转未决/转复核项、实体合并、block 标记等操作。

交互验证后发现，若按“AI 生成大量候选 -> 人工逐条点选接受/拒绝/转换”的方式处理真实长篇小说，制作工作量会非常夸张，且工作台操作会集中在低层候选微决策上。即使补充 preview、候选详情、上下文预算摘要和按钮说明，核心流程仍不够清晰，也不适合作为真实制作主流程。

因此，本次原型已回滚。项目决定暂停阶段 5-8 的直接实现，先重构清洗后数据操作逻辑。

保留结论：

- AI 不能绕过人工确认写 Accepted。
- Accepted 必须可追溯并生成 Change。
- Candidate JSONL 仍可作为中间格式、fixture 和校验对象。
- 数据工作台仍需要 Agent 协调上下文、工具接口和受控写入。

需要重构的问题：

- 人工复核单位应从 candidate 微操作上移到 block、scene、range 或任务包。
- AI 输出应先聚合为可裁决摘要、异常队列和差异建议，而不是直接堆成大量候选卡片。
- 上下文预算应展示为可读决策信息，而不是调试 JSON。
- 工作台应围绕批处理确认、人工批注、异常处理、回查和结构化落盘设计。
- `docs/project-prompts-v0.1.md` 中的 0.x 独立提示词和阶段提示词需要明确选用规则，避免后续模型拿到 0.3 Agent 提示词或阶段八提示词后继续实现旧方案。

正式记录见：

```text
docs/phase-5-8-operation-redesign-note.md
```
