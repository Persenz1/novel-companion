# 长篇系列小说交互式阅读增强系统需求定义 v0.2

> 说明：本文档为历史需求草案，保留讨论脉络。
> 当前实现以 `requirements-v0.3.md` 及各分规格文档为准。
> 如本文档与后续规格冲突，以后续规格为准。

## 1. 项目定位

本项目定位为面向长篇系列小说的本地交互式阅读增强系统。

它不是普通 EPUB 阅读器、在线书城、百科站或单作品专用工具。基础阅读器只是入口，核心价值是围绕长篇叙事文本提供防剧透上下文、人物卡、说话人标注、事件与关系记忆、剧情线回顾、数值变化追踪和 AI 辅助数据整理。

系统当前以《欢迎来到实力至上主义的教室》作为复杂样本压测对象，但设计目标是通用增强阅读器。作品特有能力应通过系列配置、实体子类型、字段模板或可选模块实现。

## 2. 当前阶段目标

第一阶段目标不是完整桌面应用，也不是发布打包优化，而是跑通完整制作闭环：

1. 规定清洗后数据接受形式。
2. 用自造测试文段验证清洗、解析、候选、复核、入库、编译和阅读展示。
3. 实现最低限度 Markdown 阅读器。
4. 实现最小数据工作台。
5. 验证防剧透查询、block 阅读标尺、右侧增强面板和变化记录。

第一阶段按流程分段测试，不跳过前置接口：

1. 清洗输出模板。
2. Markdown block / asset / alignment 标记。
3. Parsed JSONL 生成。
4. 硬校验。
5. AI Candidates JSONL 模板。
6. 按 block 复核工作台。
7. Accepted / Change / OpenQuestion 入库。
8. Compiled 查询。
9. 最低限度 Markdown 阅读器。

每一段都用自造样例验证后再进入下一段，避免后期才发现前置接口缺失。

## 3. 产品形态与技术边界

系统长期定位为本地桌面 App，但第一阶段可以先以文件夹工程、脚本、最小 Web/桌面阅读器和数据工作台验证流程。

长期不优先考虑：

- 账号系统
- 云同步
- 在线内容平台
- 自动下载数据包
- 移动端优先
- 浏览器插件优先
- EPUB 原版渲染优先

当前阅读端优先使用 Markdown 私有正文格式。EPUB 保留为原始 Source 和未来二期方向。等 Markdown 路线跑通、数据模型稳定、工作台和防剧透查询验证完成后，再考虑 EPUB DOM 到 block 的映射、CFI/XPath、原排版渲染和外部 EPUB 匹配。

## 4. 包类型

系统区分工程包和阅读包。

工程包用于数据制作、AI 清洗、人工复核和后续维护，可以包含：

- Source
- Parsed
- Candidates
- Review
- OpenQuestions
- Reports
- Accepted
- Compiled

阅读包用于普通阅读，只包含稳定阅读数据：

- manifest
- Parsed / 正文资源
- Accepted
- Compiled
- 必要 assets

阅读包默认不包含 Candidates、Review、OpenQuestions 或 AI 中间产物，避免剧透、噪音和误用。

当前阶段优先支持包含正文和必要资源的完整阅读包。注释型阅读包和“匹配用户本地 EPUB”的能力长期保留为可能方向，但不是早期目标。

完整阅读包是否可以公开分发取决于文本和资源权利状态。manifest 必须明确 contains_text、contains_assets、rights_note、usage_scope 等字段。

## 5. 工程目录与落盘格式

工程期采用文件夹形式组织，交换和导入时可以打包为 zip。源工程格式采用 Markdown + JSON/JSONL；SQLite、全文索引、向量索引或其他高性能结构只作为 Compiled 编译产物。

推荐目录：

```text
bookpack/
  manifest.json
  source/
  parsed/
    volumes/
      v01.md
    blocks.jsonl
    scenes.jsonl
    assets.jsonl
    asset_anchors.jsonl
    alignments.jsonl
  assets/
    images/
  accepted/
    entities.jsonl
    facts.jsonl
    events.jsonl
    relations.jsonl
    arcs.jsonl
    metrics.jsonl
    metric_changes.jsonl
    character_cards.jsonl
    term_cards.jsonl
    speaker_labels.jsonl
    changes.jsonl
  candidates/
    candidates.jsonl
  review/
    review_items.jsonl
    open_questions.jsonl
  compiled/
  reports/
    cleaning_report.json
    validation_report.json
```

Markdown 用于清洗后的主文本。JSONL 用于大量结构化对象，一行一个对象，便于人工检查、git diff、脚本处理、AI 生成、增量追加和后续导入数据库。

## 6. 清洗输出接口

清洗阶段强制规定输出接口，不强制规定输入来源或清洗方法。

上游可以是 EPUB、TXT、OCR、复制文本、外部大模型、Codex/GPT、脚本或人工整理。系统只要求交付物符合清洗后接口。

第一阶段最低交付物：

```text
manifest.json
parsed/volumes/v01.md
```

如果有图片：

```text
assets/images/...
```

可由工具生成：

```text
parsed/blocks.jsonl
parsed/assets.jsonl
parsed/asset_anchors.jsonl
parsed/alignments.jsonl
reports/cleaning_report.json
```

清洗端必须形成“生成 + 验证”闭环。Codex、脚本或校验器应检查清洗输出是否完全合格，包括 block 标记完整、block ID 唯一且有序、章节结构可解析、图片锚点有效、中日对齐组引用有效 block、生成的 JSONL 通过硬校验。只有清洗端验证通过后，才进入 AI 候选生成和人工复核。

## 7. Markdown 主文本格式

清洗后的正文第一阶段采用一卷一个 Markdown 文件：

```text
parsed/volumes/v01.md
parsed/volumes/v02.md
```

Markdown 标记采用通用 HTML 注释，不设计额外私有语法。

示例：

```md
# 第一章

<!-- block: v01.c01.b0001 -->
今天的教室有些安静。

<!-- block: v01.c01.b0002 -->
「你知道今天要公布什么吗？」她问。

<!-- asset: v01_img_001 anchor: after v01.c01.b0002 alt: 教室插图 -->
![教室插图](../../assets/images/v01_img_001.jpg)
```

Block 切分以自然段落为主。对话、旁白段落、独立说明段落通常各自成为一个 block；不默认切到句子级，也不把整章作为单个 block。

block ID 在清洗输出阶段直接写入 Markdown。解析器可以校验、补全缺失标记、检查顺序和报告冲突，但不应每次根据段落重新生成正式 ID。

清洗过程中、进入 AI 候选生成和人工复核前，可以重新切分段落并重排 block ID。一旦进入评估/复核流程，或已有 Candidates、Review、Accepted 数据引用这些 block，旧 block ID 即视为冻结。后续如必须插入新 block，应使用可排序后缀 ID，并在 changes 中说明插入位置、原因、影响范围和是否需要重新校验。

## 8. 图片与资源

插图、封面、地图、人物图等资源不依赖运行时重新解析原始 EPUB。

原始 EPUB 或导入文件作为 Source 保留；清洗阶段提取资源、生成稳定 Asset ID，并把图片位置锚定到章节、block 或 block 间位置。

完整阅读包可以保存图片资源和锚点。注释型数据包长期可只保存资源指纹、位置锚点、替代说明或用户本地资源匹配信息，但这不是第一阶段目标。

图片不建立独立阅读进度体系，统一绑定到中文主轴。单模态 AI 处理正文时，可以只看到图片占位符、人工标题、OCR 文本或说明文字；图片本体保留在资源区，供阅读器展示、未来多模态模型处理或人工复核使用。

## 9. 中日对照

系统以中文文本为唯一主轴。

- block、章节、当前位置、防剧透边界、实体来源、事件来源、关系来源均以中文文本为准。
- 日文不建立独立 block 体系。
- 日文只是绑定到中文 block 上的参考内容。
- 阅读时提供开关：只显示中文，或中文 + 日文参考。
- 如果某个中文 block 没有可靠日文对应，则不显示日文参考。

中日对照允许一对一、一对多和多对一绑定。清洗阶段采用 alignment_id 对齐组，让中文段落组和日文段落组共享同一个 ID。

示例：

```json
{
  "alignment_id": "v01.c01.a001",
  "zh_block_ids": ["v01.c01.b0002"],
  "ja_refs": [
    {
      "id": "v01.c01.j0002",
      "text": "「今日、何が発表されるか知ってる？」"
    }
  ],
  "confidence": 0.92,
  "status": "pending_review"
}
```

普通阅读只显示可靠对齐。对齐失败不影响中文阅读。

## 10. 统一叙事时间线

所有涉及剧透、阅读进度、状态变化和有效范围的数据共享同一套叙事时间线。

时间线以中文主文本的 series / volume / chapter / block 顺序为基础，必要时允许 scene、volume_end、chapter_end、external、manual 等辅助节点。

可读位置 ID 示例：

```text
v01.c03.b0042
series_id:v01.c03.b0042
v01.start
v01.end
v01.c03.start
v01.c03.end
external:guidebook01:p012
manual:note_001
```

visible_from、valid_from、valid_until、source_span、关系变化位置、事件发生位置、角色卡卷末版本、回顾触发位置都引用这套统一时间线。

## 11. 防剧透边界

防剧透不是 UI 功能，而是数据查询层的硬约束。

系统区分：

- current_block：用户现在看到哪里，用于当前场景、当前人物和当前位置相关展示。
- read_boundary：系统确认读者已经安全读完哪里，用于防剧透查询。

visible_from 采用“读完该位置后可见”的语义。查询时以 read_boundary 为准，而不是直接使用 current_block。

正常连续滚动阅读时，read_boundary 可以随阅读标尺推进。目录跳转、搜索跳转、大幅拖动或跳到超过已读边界的位置时，只更新 current_block，不自动扩展 read_boundary。

read_boundary 的自动推进只在普通连续滚动中触发。第一阶段可以采用中庸停留时间阈值：当某个 block 正常越过内部阅读标尺，并且没有被高速滚动跳过时，才认为该 block 已读完。具体时长属于交互手感参数，开发时先设置保守默认值，再通过实际阅读测试调整。

当用户跳转到超过 read_boundary 的未读后文时，右侧增强面板仍以 read_boundary 作为防剧透过滤边界。界面可以显示当前位置和基础导航信息，但不展示该位置之后才可见的增强内容，并提供“标记至此为已读”或切换回顾/二刷模式的入口。

## 12. 阅读模式

系统长期包含三种阅读模式：

1. 初读模式：默认模式，严格只显示 read_boundary 之前的信息。
2. 回顾模式：用户指定已读范围，例如读第 8 卷前回顾第 1-7 卷。
3. 二刷模式：明确开启后允许显示全系列信息，包括伏笔回收、真相解释、未来关系变化。

二刷模式使用独立可见边界，不受初读 read_boundary 限制。默认可以显示全系列已整理信息，也可以让用户选择只看到某卷末或某个指定边界。二刷模式必须由用户明确开启，并给出清晰提示；关闭后恢复初读模式的 read_boundary 和防剧透过滤。

## 13. 核心数据对象

第一阶段核心对象：

- Block
- Entity
- Fact
- Event
- RelationChange
- Candidate
- CharacterCard
- Metric
- MetricChange
- Change
- ReviewItem
- OpenQuestion
- Asset
- AssetAnchor
- SourceSpan

不设置独立 Mention 对象。不记录每个人物、术语或地点在每个 block 中的所有出现。系统只记录有知识价值或交互价值的内容，例如首次登场、说话人标注、事件参与、关系变化、事实更新、术语解释入口和需要复核的出现。普通全文搜索、点击索引和临时高亮可作为编译产物或解析索引处理。

第一阶段 SourceSpan 精度到 block 或连续 block range，不支持也不要求 block 内字符范围。

## 14. 最小字段模板

第一阶段字段采用最小可用模板，不追求一次性覆盖所有未来需求。

Block：

```json
{
  "id": "v01.c03.b0042",
  "volume_id": "v01",
  "chapter_id": "v01.c03",
  "order": 42,
  "kind": "paragraph",
  "text": "正文段落",
  "review_status": "unreviewed"
}
```

Entity：

```json
{
  "id": "entity_ayanokouji",
  "type": "character",
  "name": "绫小路清隆",
  "aliases": ["绫小路", "清隆"],
  "first_seen": "v01.c01.b0003",
  "tags": ["main_character"],
  "status": "accepted"
}
```

Fact：

```json
{
  "id": "fact_001",
  "subject_id": "entity_horikita",
  "predicate": "class",
  "value": "D班",
  "valid_from": "v01.c01.b0001",
  "valid_until": null,
  "visible_from": "v01.c01.b0001",
  "source_span": {
    "start_block": "v01.c01.b0001",
    "end_block": "v01.c01.b0001"
  }
}
```

Event：

```json
{
  "id": "event_v01_c03_001",
  "type": "exam_rule_announced",
  "title": "特别考试规则公布",
  "summary": "某次考试规则被说明。",
  "position": "v01.c03.b0042",
  "participants": ["entity_ayanokouji", "entity_horikita"],
  "related_entities": ["entity_d_class"],
  "importance": "major",
  "visible_from": "v01.c03.b0042",
  "source_span": {
    "start_block": "v01.c03.b0040",
    "end_block": "v01.c03.b0048"
  }
}
```

RelationChange：

```json
{
  "id": "relation_change_001",
  "relation_id": "relation_ayanokouji_horikita",
  "entities": ["entity_ayanokouji", "entity_horikita"],
  "relation_type": "cooperation",
  "before": "互相试探",
  "after": "有限合作",
  "event_id": "event_v01_c03_001",
  "valid_from": "v01.c03.b0048",
  "visible_from": "v01.c03.b0048",
  "source_span": {
    "start_block": "v01.c03.b0040",
    "end_block": "v01.c03.b0048"
  }
}
```

Candidate：

```json
{
  "id": "cand_001",
  "type": "event",
  "source_span": {
    "start_block": "v01.c03.b0040",
    "end_block": "v01.c03.b0048"
  },
  "visible_from": "v01.c03.b0048",
  "confidence": 0.82,
  "status": "pending_review",
  "model": "deepseek-v4",
  "task_id": "task_v01_event_extract",
  "payload": {}
}
```

CharacterCard：

```json
{
  "id": "card_ayanokouji_v01_end",
  "entity_id": "entity_ayanokouji",
  "volume_id": "v01",
  "version_position": "v01.end",
  "short_summary": "表面低调的D班学生。",
  "reader_memory": "读者此时应该记得的背景。",
  "source_refs": ["fact_001", "event_v01_c03_001"],
  "visible_from": "v01.end"
}
```

Metric：

```json
{
  "id": "metric_d_class_points",
  "subject_id": "entity_d_class",
  "metric_type": "class_points",
  "unit": "points",
  "value_type": "integer",
  "status": "accepted"
}
```

MetricChange：

```json
{
  "id": "metric_change_001",
  "metric_id": "metric_d_class_points",
  "old_value": 0,
  "new_value": 100,
  "delta": 100,
  "reason_event_id": "event_v01_c03_001",
  "valid_from": "v01.c03.b0048",
  "visible_from": "v01.c03.b0048",
  "source_span": {
    "start_block": "v01.c03.b0048",
    "end_block": "v01.c03.b0048"
  }
}
```

Change：

```json
{
  "id": "change_001",
  "operation": "accept_candidate",
  "candidate_id": "cand_001",
  "target_type": "event",
  "target_id": "event_v01_c03_001",
  "before": null,
  "after": {},
  "reason": "人工确认",
  "source_span": {
    "start_block": "v01.c03.b0040",
    "end_block": "v01.c03.b0048"
  }
}
```

所有正式对象应尽量包含 schema_version、series_id、status、source_span、visible_from、created_by、updated_at 等通用字段；第一阶段允许按对象性质裁剪。

## 15. 实体与合并

系统内置基础实体类型，但允许按作品或系列动态扩充。

基础类型包括：

- 人物
- 组织
- 地点
- 术语
- 能力
- 道具
- 事件
- 阵营
- 世界观设定

每个系列可以只启用自己需要的类型。未启用类型不出现在该系列的数据整理、AI 提示词、复核界面和阅读展示中。

实体合并必须保守。AI 可以提出“疑似同一实体”候选，但不能自动合并正式实体。自动归一只适用于来源明确、无歧义的别名或简称。

人物重名、称呼模糊、代称归属不清、身份伪装或隐藏身份相关内容必须进入 Review。

合并后保留 aliases、来源、变更记录和 merged_into 标记；被合并实体不物理删除，避免破坏历史引用和审计链路。

## 16. Fact、Event 与 Relation

Fact 不表示永恒真理，而表示在某段叙事时间内成立的已确认陈述。人物所属、身份状态、数值、组织成员关系、已知/未知状态等不通过覆盖旧值表达，而通过新事实或变化记录表达。

Event 是长篇记忆骨架。事件用于记录发生过什么、影响了谁、关系如何变化、剧情线推进到哪里。

Relation 不只存当前关系，而记录关系状态和变化历史。每次关系变化应关联 Event，并带 source_span、valid_from、visible_from。当前关系由时间线查询或 Compiled 产物计算。

事件重要性第一阶段采用四档：

- critical：主线推进、身份揭示、重大考试结果、核心关系变化等。
- major：对人物、关系、数值或剧情线有明确影响的重要事件。
- minor：局部有记录价值但普通阅读不一定展示的事件。
- background：背景信息、日常补充或低优先级依据。

重要性等级用于展示、回顾和整理优先级，不作为文学价值评价。AI 可以建议等级，但人工可以修改。

## 17. Arc 与伏笔

剧情线记录应尽量基于可验证事实，避免把“成长”“动机”“伏笔意义”等高度主观解释提前写成正式结论。

人物成长线、伏笔线、谜团线可以作为追踪容器存在，但节点应绑定到明确事件、关系变化、状态变化、文本暗示或后续揭示。

伏笔和谜团通常以后记前：只有读到后文确认某处是伏笔或某个谜团被揭示后，才能回填前文对应位置，并严格设置 visible_from，避免初读时提前暴露解释。

## 18. 数值数据

数值类客观数据单独建模，不只作为普通 Fact 附带文本保存。

第一阶段设置 Metric 和 MetricChange 数据区，用于记录：

- OAA
- 班级点数
- 个人点数
- 考试分数
- 排名
- 金额
- 人数
- 其他明确给出的量化数据

规则：

- 不允许 AI 推测。
- 不是所有角色或组织都必须拥有数值数据。
- 文本、附录或官方资料明确给出的数值应尽量记录。
- 每次数值记录或变化都必须有来源、可见边界、发生位置、关联事件或原因说明。
- 能确定 old_value、new_value、delta 时结构化记录。
- 如果只知道发生变化但无法确定具体值，则只记录变化事实或待复核项，不生成精确当前值。

数值数据应支持基础可视化，例如个人点数变化折线图、班级点数折线图、OAA/能力评分雷达图或分项趋势图。图表只展示当前阅读边界内可见、来源明确的数据；缺失值不插值、不推测。

## 19. 角色卡与术语卡

角色卡采用混合式：默认是当前阅读辅助，展开后是防剧透百科。

角色卡内容分为展示摘要和结构化依据两层。

展示摘要可以由 AI 起草，也可以由人工编辑，用于提供一句话印象、当前读者应该记得的背景、阅读提示和简短人物说明。生成时必须受可见边界控制，只能基于截至目标阅读位置可见的 Accepted 数据、角色相关事实、事件、关系、剧情线和来源摘要。

AI 生成角色卡摘要时，不直接读取全系列自由发挥，而通过结构化检索获得人物上下文，包括当前可见状态、别名、所属组织、重要事件、关系变化、相关剧情线、未解决问题和风险提示。

生成结果进入 Candidate 或 Review，经人工确认后才能成为正式角色卡内容。

角色卡展示摘要原则上按卷更新，不按每个 block 生成独立版本，避免数据量失控。人物变化、剧透事实、关系变化和事件仍可以按 block 记录可见边界。

卷内阅读时，角色卡默认显示上一稳定节点摘要，通常是上一卷末或已确认的当前卷阶段摘要。当前卷内新增事件、关系变化、身份变化和重要提示在“本卷新增”“最近变化”或当前相关事件模块中展示。当前卷整理完成并复核后，再生成新的卷末角色卡摘要。

术语卡定位为轻量解释卡，主要在正文里术语出现时可点击查看。术语可以有解释、别名、首次出现、来源、可见边界，但不需要像角色卡那样持续追踪关系和事件。

## 20. 说话人标注

阅读界面只提供简洁标注：

- 名字模式
- 头像模式
- 头像 + 名字模式

说话人标注支持人物实体，也支持旁白、未知、群体发言、系统文本、歧义候选等基础类型。

普通阅读界面只显示人工确认或高置信的简洁标注。未知、歧义和多候选信息只进入数据工作台复核。

随着作品推进，如果出现基础类型无法覆盖的新说话来源，可以由 AI 或人工提出新增 speaker 类型候选，但必须经人工确认后进入系列配置，不能自动修改正式 schema。

## 21. 关系图

关系图是实体关系图，不只限于人际关系图。

第一版阅读面板中的关系图应控制为当前上下文局部图，默认包含：

- 当前场景人物
- 这些人物的一跳关系
- 当前相关事件
- 相关组织、班级、小组、阵营
- 必要时的考试/规则节点

复杂多方关系优先通过 Event 节点表达，不强行压成两两人物关系。

全系列大图、全量人物关系网和复杂自动布局不作为第一阶段目标。

人物详情页可以提供两人关系视图，用于查看当前客观关系、历史变化、相关事件，以及受防剧透控制的主观视角、误解、隐藏动机等信息。

## 22. AI 数据生产

AI 不直接修改正式数据。AI 输出全部进入 Candidates 候选区。

AI 输出必须带来源、证据、置信度、可见边界、任务类型、模型信息。拿不准时允许输出不确定，不能硬编。

AI 工作流不要求全部发生在应用内嵌 AI 中。数据清洗、格式修复、中日对照预处理、章节结构整理、block 切分校正等前置工作，可以由用户在外部使用更强的通用 AI 工具、脚本或人工流程完成。

候选阶段直接输出规范 JSONL 或可无损转换为 JSONL 的结构化结果。人工不直接阅读候选 JSON，而是在数据工作台中通过图形化界面查看候选、相关 block、来源证据、历史上下文和可执行操作。

Candidates JSONL 按 source_span 或 block 时间线顺序存储。即使存在倒叙、回忆或插叙，也以正文 block 顺序作为复核顺序。

AI 数据整理默认按单卷或用户指定局部范围执行。为了控制上下文长度，AI 不假设能够看到全系列全文；一次任务通常只读取当前卷、当前章节、当前 block/scene 范围，以及由系统提供的过往整理结果。

## 23. 整理上下文

过往整理结果作为可检索、可压缩的工作记忆提供给 AI，包括已确认实体、别名、角色简档、关系当前状态、重要事件摘要、剧情线进度、术语解释、数值状态和未解决问题。

整理上下文不是无限增长的全系列摘要，而是可编译、可检索、可裁剪的分层记忆系统。

对于类似《实教》这种已出版全文约数百万字、单卷约十万字量级的系列，目标是将截至当前卷前的历史整理背景压缩到约 100k-150k 的上下文量级，再与当前卷正文、当前任务范围和必要证据片段组合使用。

即使使用长上下文模型，系统仍应保留结构化索引、语义检索补充和 SourceSpan 证据回查能力。

整理上下文检索采用：

1. 结构化索引优先。
2. 语义检索补充。
3. SourceSpan 证据回查。

## 24. 数据工作台

数据工作台是给制作者跟读整理用的可视化 Agent 界面，不是普通阅读模式，也不是纯聊天框。

人工复核主流程按 block 顺序推进，保证制作者的阅读记忆和正文上下文连续。每个 block 或 scene 展示与当前位置相关的候选、来源、历史上下文和可执行操作；处理完成后再前进到后续 block。

按候选类型筛选、批量查看说话人/事件/关系/术语等队列可以作为辅助视图，但不能替代按正文顺序跟读复核的主流程。高风险候选必须回到对应 block 上下文中确认。

每个 block、scene、章节和卷都应支持复核状态和进度断点：

- 未处理
- AI 已生成候选
- 人工复核中
- 已复核
- 有未决问题
- 跳过/暂不处理

系统应能从上次断点继续，统计当前卷复核进度，并清楚区分已可信区域和仍需处理区域。

人工当下无法判断的问题不强行写入正式事实，而进入未决问题或复核项。后续读到新信息时，可以回到未决问题进行确认、关闭、升级为正式数据或标记为误判。

## 25. 变化记录

Accepted 数据的变更必须有记录。

AI 候选经人工接受后，不以无痕覆盖方式直接改写正式数据，而应生成类似 git diff 的变更记录，说明新增、修改、合并、弃用、冲突解决或状态变化的内容、原因、来源、操作者和时间。

对于关系、状态、点数、身份揭示、剧情线进度等会随阅读位置变化的数据，应优先以追加变化记录的方式保存，当前状态由查询或 Compiled 产物根据可见边界计算得出。

删除正式数据时默认采用弃用或 tombstone 标记，避免破坏历史追溯。角色卡等人工摘要允许更新，但也应保留修订记录、来源和可见边界。

## 26. 校验机制

校验分为硬校验和软校验。

硬校验用于数据格式、引用完整性和系统安全边界，失败时阻止导入、编译或发布。硬校验包括：

- manifest 是否完整
- Markdown 文件是否存在
- block ID 是否唯一、可排序
- JSONL 每行是否合法
- 对象 ID 是否唯一
- 引用的 entity/event/relation/arc/metric 是否存在
- visible_from / valid_from / valid_until / source_span 是否引用有效位置
- 图片锚点是否能找到 asset 和 block
- 中日 alignment 是否引用有效 block
- Candidate 是否有 type/status/source/confidence/model/task
- Accepted 数据是否有来源和变更记录

软校验用于内容质量、事实一致性、摘要完整性、疑似遗漏、剧透风险和冲突提示。软校验不替代人工判断，结果进入 Reports 或 Review。

文本事实正确性主要由逐 block 的人工跟读和复核流程保证。制作者如果对整理结果不放心，可以在人工核查后的 Accepted 数据和 Compiled 数据基础上，再运行 AI 复查任务生成疑点报告，但 AI 复查结果仍只能作为候选或报告，不能自动改写正式数据。

## 27. 阅读界面

第一阶段实现最低限度 Markdown 阅读器：

- 渲染 Markdown 正文。
- 隐藏 HTML 注释标记。
- 根据内部阅读标尺定位 current_block。
- 维护 read_boundary。
- 按 visible_from 查询右侧增强数据。
- 支持右侧增强面板。
- 支持跳到未读后文时的保守提示。

右侧增强面板默认展示当前上下文相关内容，而不是全量百科：

- 当前场景人物
- 当前人物卡
- 当前相关事件
- 当前关系
- 当前术语
- 本卷新增/最近变化
- 人物回顾、事件回顾、剧情线回顾
- 数值变化与基础图表

人物重新登场回顾以人工标记为主，系统和 AI 可以提出候选，但不应仅凭机械间隔自动打扰阅读。

## 28. 样例数据

第一阶段样例数据优先使用自造测试文段，而不是直接使用正式版权文本。

测试文段应刻意覆盖：

- 章节
- block
- scene
- 人物
- 组织
- 对话说话人
- 事件
- 关系变化
- 数值变化
- 角色卡
- 术语解释
- 图片锚点
- 中日对照
- 未决问题
- 候选复核
- 变更记录
- 防剧透边界
- read_boundary/current_block

目标是用小样例完整跑通清洗、解析、AI 候选、人工复核、Accepted 入库、Compiled 查询和 Markdown 阅读展示，再进入正式文本制作。

## 29. 后续分块讨论

后续可以按以下主题继续细化：

1. 清洗输出模板与样例 Markdown。
2. JSONL schema 文件。
3. 自造测试文段。
4. Markdown parser 与硬校验器。
5. Candidates JSONL 模板。
6. 数据工作台最小交互。
7. Markdown 阅读器原型。
8. Compiled 查询结构。
9. 整理上下文生成器。
10. 数值图表展示。
