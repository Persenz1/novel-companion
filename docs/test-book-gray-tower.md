# 原创测试书设计：《灰塔学院测试卷》

## 1. 用途

《灰塔学院测试卷》是第一阶段原创测试书，用于验证数据格式、制作流程、AI 候选、人工复核、Compiled 查询和 Markdown 阅读器。

它不追求文学完成度，优先服务测试覆盖。

目标：

- 避免使用版权文本。
- 模拟长篇校园群像、特殊考试、人物关系和数值变化。
- 用可控小文本压测防剧透边界。
- 调整阅读器自动推进、跳读、手动确认和返回边界。

## 2. 结构

```text
v01.prologue  序章：灰塔学院
v01.c01       第一章：点数公告
v01.c02       第二章：沉默的小组
v01.c03       第三章：白卡测试
v01.epilogue  终章：未寄出的名单
```

## 3. 核心设定

灰塔学院是一所封闭式学校。学生以班级为单位竞争资源，班级点数影响生活条件和考试优势。

学校每学期公布一次综合评价，部分规则只在考试开始后逐步揭示。

测试书使用原创规则，不引用真实作品设定。

## 4. 主要实体

示例人物：

- 林澈：主角，表面普通，观察力强。
- 许映白：同班学生，成绩优秀，社交冷淡。
- 周弥：消息灵通，喜欢插话。
- 白川遥：学生会记录员，常出现在公告现场。
- 沈砚：隔壁班学生，第一次出现时身份不完全明确。

示例组织：

- 灰塔学院
- 一年 D 班
- 一年 B 班
- 学生会

示例术语：

- 班级点数
- 白卡测试
- 静默名单
- 综合评定

## 5. 测试覆盖

### 5.1 Markdown 和 Parsed

覆盖：

- 普通章节和特殊章节。
- block 切分。
- scene start/end。
- dialogue / paragraph / separator / note。
- 图片锚点。
- 中日对照 alignment。

### 5.2 Accepted 数据

覆盖：

- entity
- fact
- event
- relation_change
- metric
- metric_change
- character_card
- term_card
- speaker_label
- asset_subject

### 5.3 Candidates 和工作台

覆盖：

- AI 提出新实体。
- AI 提出说话人候选。
- AI 提出事件摘要。
- AI 提出关系变化。
- AI 提出数值变化。
- AI 提出未决问题。
- 人工接受、修改、拒绝、合并、转为 OpenQuestion。

### 5.4 防剧透

设计一个后文揭示：

- 前文某个“未寄出的名单”初读时只是普通物品。
- 终章揭示它对应一次暗中分组。
- 前文相关伏笔的解释 `visible_from` 必须设到终章之后。

阅读器测试：

- 慢速连续阅读自动推进 read_boundary。
- 快速跳到终章不推进 read_boundary。
- 右侧面板不显示终章揭示。
- 点击“标记至当前 block 为已读”后才显示相应增强信息。
- 点击“返回已读边界”回到原位置。

## 6. 图片测试

至少准备或占位三类图片：

- 单人图：用于 `asset_subjects` 关联单个人物。
- 合照：用于同一图片关联多个人物。
- 场景图：用于只锚定正文，不关联人物。

第一阶段图片可以用占位文件，不要求最终美术。

## 7. 中日对照测试

日文仅作为参考渲染内容。

至少覆盖：

- 一个中文 block 对一段日文。
- 一个中文 block 对多段日文。
- 多个中文 block 对一段日文。
- 一个 pending_review alignment，不在普通阅读中默认展示。

## 8. 数值测试

覆盖：

- 班级点数初始值。
- 班级点数变化。
- 个人点数变化。
- 只知道变化但不知道具体值的情况。
- 缺失值不插值、不推测。

## 9. 后续产物

后续可在 `samples/gray-tower/` 下创建完整 bookpack：

```text
samples/gray-tower/
  manifest.json
  parsed/
  accepted/
  candidates/
  review/
  reports/
  compiled/
  assets/
```

## 10. 第一阶段硬验收指标

《灰塔学院测试卷》是第一阶段验收夹具，不追求文学完成度，但必须覆盖工具链最容易出错的边界。

### 10.1 正文结构

- 1 卷。
- 5 个章节：`v01.prologue`、`v01.c01`、`v01.c02`、`v01.c03`、`v01.epilogue`。
- 每章至少 5 个 block。
- 全卷至少 35 个 block。
- 至少 8 个 dialogue block。
- 至少 4 个 scene。
- 至少 1 个 scene 跨 5 个以上 block。
- 至少 1 个 separator 或 note block。
- 至少 1 个章节标题和 manifest 标题可用于一致性校验。

### 10.2 Markdown 标记

- 每个章节都有 `chapter` 注释。
- 每个 block 都有 `block` 注释。
- 至少 4 组 `scene action: start/end`。
- 至少 3 个 `asset` 注释。
- 至少 4 个 `alignment` 注释。
- 至少 1 个多 block alignment，例如 `blocks: v01.c01.b0002,v01.c01.b0003`。
- 使用 `tag: primary key: value` 注释格式。

### 10.3 人物、组织与术语

- 至少 5 个人物实体。
- 至少 3 个组织或班级实体。
- 至少 2 个术语实体。
- 至少 1 个人物首次身份不明，后文再揭示。
- 至少 1 个疑似同一实体或别名候选，用于测试合并不自动发生。

### 10.4 Candidates 与复核

- 至少 25 条 Candidate。
- 覆盖 `entity`、`fact`、`event`、`relation_change`、`speaker_label`、`metric`、`metric_change`、`term_card`、`character_card`、`asset_subject`、`review_item`、`open_question`。
- 至少 3 条低置信候选。
- 至少 2 条冲突或疑似重复候选。
- 至少 1 条候选转 ReviewItem。
- 至少 1 条候选转 OpenQuestion。
- 至少 1 条修改后接受。

### 10.5 Accepted 数据

- 至少 15 条 Accepted 对象。
- 至少包含 5 个 entities、3 个 facts、2 个 events、2 个 relation_changes、2 个 speaker_labels、1 个 metric、2 个 metric_changes、1 个 term_card、1 个 character_card。
- 每条 Accepted 都有 `source_span`，或符合 `character_card.source_refs` / `asset_subject.asset_anchor_id` 例外规则。
- 每条 Accepted 都有 `created_change_id`。
- `accepted/changes.jsonl` 至少 10 条，覆盖 `accept_candidate`、`accept_candidate_with_edit`、`manual_create`。

### 10.6 防剧透

必须包含一个明确伏笔链：

- 前文出现“未寄出的名单”，初读时只能作为物品或异常现象。
- 终章揭示它和暗中分组有关。
- 前文伏笔解释的 `source_span` 可以指向前文，但 `visible_from` 必须是终章揭示位置或 `v01.epilogue.end`。
- 当 `read_boundary` 在第一章时，查询不到解释。
- 当 `current_block` 跳到终章但 `read_boundary` 仍在第一章时，也查询不到解释。
- 手动确认 `read_boundary` 到终章后，才能查询到解释。

### 10.7 数值

- 至少一个班级点数初始值。
- 至少一次班级点数变化。
- 至少一次个人点数变化。
- 至少一次“知道变化但不知道具体值”的情况，必须进入 OpenQuestion 或 ReviewItem，不生成精确 MetricChange。
- 缺失值不插值、不推测。

### 10.8 图片

- 至少 3 个占位图片：单人图、合照、场景图。
- 至少 1 个 `asset_subject` 人工确认。
- 至少 1 个图片人物识别候选进入 Review，不自动 Accepted。

### 10.9 中日对照

- 至少 4 个 alignment：一对一、一对多、多对一、pending_review。
- 普通阅读默认只显示 reviewed alignment。
- pending_review 不默认展示。

### 10.10 Reader / Compiled

`getVisibleContext()` 必须通过：

- 早期 `read_boundary` 不返回后文事件、伏笔解释、后文身份揭示。
- `current_block` 超过 `read_boundary` 时，`is_ahead_of_boundary = true`，但增强数据仍按 `read_boundary` 过滤。
- 终章 `read_boundary` 返回伏笔解释。
- 当前 block 能返回 speaker label、term card、asset。
- 当前 scene 能返回相关人物和事件。
- 角色卡返回 `read_boundary` 前最新可见版本。
