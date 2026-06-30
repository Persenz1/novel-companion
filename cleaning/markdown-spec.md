# 清洗后 Markdown 规范

清洗后的正文采用**一卷一个 Markdown 文件**（如 `parsed/volumes/v01.md`）。文件由可见正文与单行 HTML 注释 marker 交替组成。阅读器渲染时隐藏注释。

## 1. 注释 marker 通用格式

所有结构信息通过**单行 HTML 注释**表达，格式统一为：

```text
<!-- tag: primary key: value key: "quoted value" -->
```

规则：

- 注释必须**单行**，以 `<!--` 开头、`-->` 结尾。
- 第一个 `tag: primary` 中，`tag` 是 marker 类型，`primary` 统一表示对象 ID。
- 其后是任意多个 `key: value` 对。
- 不带空格的值直接写；**多值字段用逗号分隔且不加空格**（如 `blocks: a,b`）。
- **带空格、冒号或复杂标点的值必须用双引号**包裹（如 `title: "第一章：试探"`）。
- 不支持复杂转义；需要引号时优先改写文本或使用中文引号 `「」`。
- 已识别的 marker tag：`chapter`、`block`、`scene`、`asset`、`alignment`。
- 未识别 tag 或未知 key 记 **warning**（不阻断）；已识别 marker 但格式非法记 **error**（阻断）。

## 2. chapter

每个章节以一条 `chapter` 注释开头，紧跟一行可见标题。

```md
<!-- chapter: v01.c01 kind: chapter title: "第一章：点数公告" -->
# 第一章：点数公告
```

- `primary` 是章节 ID，必须在 manifest 的章节列表中声明。
- `kind`：`prologue` / `chapter` / `epilogue` / `interlude` / `extra` 等。
- `title` 建议与 manifest 一致（不一致记 warning）。

## 3. block

正文最小单位。**自然段优先，人工可例外拆分**：默认一个自然段一个 block；对话段、旁白段、独立说明段通常各自成 block；不切到句子级。

```md
<!-- block: v01.c01.b0001 kind: paragraph -->
上午的教室有些嘈杂。林澈坐在靠窗的位置，目光扫过教室里的每一张脸。

<!-- block: v01.c01.b0002 kind: dialogue -->
「听说今天要公布班级点数了，你紧张吗？」坐在斜前方的男生探过头来。
```

- block 文本是注释**下一段**直到空行/下一个注释/标题为止的内容。
- `kind`：`paragraph` / `dialogue` / `separator` / `note`，省略按 `paragraph`。
- 同一自然段里若有多个需要独立防剧透定位的事实、数值变化、身份揭示或说话人切换，可人工拆成多个 block。

### block ID 规则

```text
v01.c03.b0042      普通章节：卷.章.块，块号每章从 b0001 重置
v01.prologue.b0001 特殊章节用语义 ID（prologue/epilogue/interlude01...）
v01.c03.b0042a     插入补块用可排序后缀
```

block ID 前缀必须与所在 chapter 匹配（不匹配记 error）。

## 4. scene

scene 是「场景」，**不是防剧透边界，也不是复核单位**，只辅助上下文与说话人判断。用成对的 start/end 包裹一段连续 block。

```md
<!-- scene: v01.c01.s001 action: start title: "点数公告" -->
... 若干 block ...
<!-- scene: v01.c01.s001 action: end -->
```

- 必须有 `action: start` 或 `action: end`（缺失记 error）。
- scene **不跨章节、不嵌套、不交叉**（违反记 error）。
- 一个 block 默认只归属一个主 scene。

## 5. asset（图片）

图片用 `asset` 注释锚定到某个 block。图片内容标注（图里是谁）属于知识判断，由下游人工确认，**清洗阶段只负责锚点**。

```md
<!-- asset: v01_img_001 anchor_type: after_block block: v01.prologue.b0007 alt: "林澈站在校门前的背影" -->
```

- 必须有 `anchor_type` 和 `block`（缺失记 error）；`block` 必须指向存在的 block。
- `anchor_type`：`after_block` / `before_block` / `replace_block`。
- 图片文件按 `assets/images/{asset_id}.*` 命名，解析器自动按 ID 匹配文件（找不到记 warning）。第一阶段允许占位文件。
- 可选 `![alt](path)` 渲染行可写在注释下方，会被解析器跳过、不计入 block 文本。

## 6. alignment（中日对照锚点）

`alignment` 只标记**哪些中文 block 与日文参考对齐**，日文文本本身写在 [japanese-reference-spec.md](japanese-reference-spec.md) 描述的 `source/ja/` 中，不写进 Markdown。

```md
<!-- alignment: v01.c01.a001 blocks: v01.c01.b0002 -->
<!-- alignment: v01.c02.a001 blocks: v01.c02.b0001,v01.c02.b0002 -->
<!-- alignment: v01.c03.a001 blocks: v01.c03.b0007 status: pending_review -->
```

- `blocks` 是逗号分隔的中文 block ID 列表（不加空格），必须都存在。
- 可选 `status`：`reviewed`（默认）/ `pending_review` / `parsed`。`pending_review` 的对照默认不在阅读器展示。
- 一对一、一对多由 `source/ja/` 中日文条目数量决定；多对一由 `blocks` 列出多个中文 block 实现。

## 7. 完整片段示例

```md
<!-- chapter: v01.c01 kind: chapter title: "第一章：点数公告" -->
# 第一章：点数公告

<!-- scene: v01.c01.s001 action: start title: "点数公告" -->

<!-- block: v01.c01.b0001 kind: paragraph -->
上午的教室有些嘈杂。

<!-- block: v01.c01.b0002 kind: dialogue -->
「听说今天要公布班级点数了，你紧张吗？」坐在斜前方的男生探过头来。

<!-- alignment: v01.c01.a001 blocks: v01.c01.b0002 -->

<!-- asset: v01_img_002 anchor_type: after_block block: v01.c01.b0002 alt: "D班教室全景" -->

<!-- scene: v01.c01.s001 action: end -->
```
