# 模块：EPUB 清洗流水线

## 目标

清洗模块的真正入口是用户本地合法持有的整本 EPUB。模块负责把 EPUB 转成下游已支持的 bookpack 清洗产物：

```text
manifest.json
parsed/volumes/{volume}.md
assets/images/...
source/ja/...            # 可选，后续阶段再做
```

清洗模块不直接写 `parsed/*.jsonl`、`accepted/`、`compiled/`。这些仍由现有 Parser、Validator、Agent、Compiler 生成。

## 反向 EPUB Fixture

已新增命令：

```bash
cd tools
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v01.epub v01
```

该命令从已清洗的 bookpack 反向生成标准 EPUB 3：

- `mimetype`
- `META-INF/container.xml`
- `OEBPS/content.opf`
- `OEBPS/nav.xhtml`
- `OEBPS/text/{chapter}.xhtml`
- `OEBPS/images/...`

用途是给 importer 提供可控输入：先用已知合格的 `gray-tower` 生成 EPUB，再解析回 bookpack，比较章节数、正文段落、图片锚点和校验结果。

## EPUB Import MVP

已新增命令：

```bash
cd tools
npx tsx src/cli.ts import-epub /tmp/gray-tower-v01.epub /tmp/gray-tower-imported \
  --series-id gray_tower_imported \
  --pack-id gray_tower_imported_project_v1
```

当前实现：

- 读取 EPUB zip。
- 读取 `META-INF/container.xml`。
- 解析 `.opf` 的 manifest / spine。
- 按 spine 顺序读取 XHTML。
- 抽取 `h1`、`p`、`hr`、`figure/img`。
- 生成 `manifest.json`、`parsed/volumes/v01.md`、`assets/images/*`。
- 默认执行 `Parser.parseBookpack()` 和 `Validator.validateBookpack()`。

受控 fixture 验证结果：

- `chapters=5`
- `blocks=41`
- `images=5`
- `validation=passed`

说明：反向 EPUB 不携带 Markdown 的 `alignment` marker，因此导入后 `alignments=0` 是预期行为。真实 EPUB 的日文对照或翻译对齐后续应作为单独清洗步骤进入 `source/ja/`。

## MiMo 前置任务包

已新增命令：

```bash
cd tools
npx tsx src/cli.ts prepare-mimo /tmp/gray-tower-imported v01
```

输出：

```text
reports/cleaning_mimo_inputs/index.json
reports/cleaning_mimo_inputs/v01.prologue.json
reports/cleaning_mimo_inputs/v01.c01.json
...
```

每个章节任务包含：

- `constraints`：模型必须遵守的清洗约束。
- `expected_output_schema`：要求模型输出的 `suggestions[]` 结构。
- `blocks[]`：章节内 block ID、kind、order、正文。
- `local_images[]`：图片 asset ID、锚点 block、本地相对路径和绝对路径。
- `messages[]`：正式调用 MiMo 时可转换成 OpenAI-compatible chat messages 的文本部分。

当前任务包刻意停在“可喂给 MiMo 之前”：

- 不读取 API key。
- 不调用模型。
- 不把图片转成 base64 写进报告。
- 不自动写回 Markdown。

正式清洗界面只需要读取任务包，把 `image_ref.absolute_path` 读成字节并调用现有 `imagePart(bytes, mime)`，即可得到 MiMo 需要的图片输入。

受控 fixture 验证结果：

- `tasks=5`
- `images=5`
- 每章一个任务包。
- v01.c01 任务包包含 9 个 block 和 1 张锚定图片。

## MiMo 无界面实喂

已新增命令：

```bash
cd tools
npx tsx src/cli.ts run-mimo-cleaning /tmp/gray-tower-imported \
  reports/cleaning_mimo_inputs/v01.c01.json
```

输出：

```text
reports/cleaning_mimo_outputs/clean_v01.c01.json
```

该命令只用于界面前的连通性测试：

- 读取本地 `tools/.workbench-config.json` 的 `vision` 配置。
- 不打印 API key。
- 将任务包里的 `image_ref` 转成真实图片输入。
- 调用 MiMo。
- 解析 JSON 并落盘，暂不写回 Markdown。

已用 `mimo-v2.5` 对 v01.c01 跑通：

- 模型能读取章节正文和锚定图片。
- 输出能被解析为 JSON。
- 收紧 prompt 后，输出字段符合 `id/type/target/confidence/risk/reason/patch` 约定。

## 流水线

```text
EPUB
-> Unpack
-> OPF / spine / nav 解析
-> XHTML DOM 抽取
-> 确定性 draft bookpack
-> AI 清洗建议
-> 人工确认 / 批量采纳
-> 写回 manifest + Markdown + assets
-> parse
-> validate
-> 清洗报告与返工闭环
```

## 1. EPUB Unpack

实现位置建议：`tools/src/cleaning/epubImport.ts`

职责：

- 校验 EPUB zip。
- 读取 `META-INF/container.xml`，定位 `.opf`。
- 解析 `.opf` 的 metadata、manifest、spine。
- 解析 nav / ncx，获得目录标题和层级。
- 按 spine 顺序取 XHTML 正文资源。
- 抽出图片资源，保留原始二进制。

输出中间结构：

```ts
interface EpubPackage {
  title: string;
  language: string | null;
  spine: EpubSpineItem[];
  resources: EpubResource[];
}
```

此阶段不调用 AI，不判断正文质量。

## 2. XHTML DOM 抽取

实现位置建议：`tools/src/cleaning/htmlExtract.ts`

职责：

- 将 XHTML 转为线性节点流：标题、段落、分隔线、图片。
- 去掉明显非正文节点：`script`、`style`、隐藏节点、nav、toc、landmarks。
- 保留图片出现位置，用最近的正文 block 作为初始锚点。
- 记录来源：spine item、href、DOM 路径或节点序号，供报告和返工定位。

输出：

```ts
interface ExtractedChapter {
  source_href: string;
  title: string;
  nodes: Array<TextNode | ImageNode | SeparatorNode>;
}
```

第一版不做复杂版式理解。脚注、诗歌、短信体、表格等先按普通段落或 `note` 保守落盘，交给 AI 清洗建议阶段处理。

## 3. Draft Bookpack Writer

实现位置建议：`tools/src/cleaning/bookpackWriter.ts`

职责：

- 生成 `manifest.json`。
- 生成 `parsed/volumes/{volume}.md`。
- 复制图片到 `assets/images/{volume}_img_001.ext`。
- 生成 `asset` marker，`alt` 可为空。
- 生成稳定 block ID：`v01.c01.b0001`。

初版规则：

- 章节来自 nav；nav 缺失时按 spine XHTML 或 h1/h2 推断。
- 自然段就是 block。
- 含中文/日文/英文引号开头的段落可标为 `dialogue`，否则 `paragraph`。
- 图片默认 `anchor_type: after_block`，锚到前一个正文 block；没有前文则锚到下一 block。
- scene 初版可以每章一个 scene，后续由 AI 建议细分。

## 4. AI 清洗建议

实现位置建议：`tools/src/cleaning/cleaningAi.ts`

AI 不直接改正文文件，只产出结构化建议：

```ts
interface CleaningSuggestion {
  id: string;
  type:
    | "split_block"
    | "merge_blocks"
    | "drop_noise"
    | "retitle_chapter"
    | "set_block_kind"
    | "set_scene"
    | "set_asset_alt"
    | "move_asset_anchor";
  target: string;
  confidence: number;
  reason: string;
  patch: Record<string, unknown>;
  risk: "low" | "medium" | "high";
}
```

模型输入：

- 当前章节的 draft Markdown。
- XHTML 抽取来源摘要。
- 图片缩略图或原图（仅 vision 角色）。
- 现有清洗规范摘要。

模型约束：

- 不重写小说正文。
- 只能提出结构修改、锚点修正和图注。
- 删除内容必须标记为 `drop_noise`，由人确认。
- 章节重排、正文删除、跨章移动、图片人物身份均视为高风险。

低风险建议可批量采纳；高风险建议进入人工队列。

## 5. 写回与校验

实现位置建议：`tools/src/cleaning/cleaningApply.ts`

写回只改清洗源：

- `manifest.json`
- `parsed/volumes/*.md`
- `assets/images/*`
- `reports/cleaning_import_report.json`

写回后立即执行：

```text
Parser.parseBookpack()
Validator.validateBookpack()
```

校验错误必须能回到清洗 UI：章节、block、asset、Markdown 行号或 EPUB 来源节点。

## 6. UI 形态

现有 `/cleaning/` 现在只覆盖图片标注。后续扩展为五个视图：

- 导入：选择 EPUB、目标 bookpack、series/volume 元数据。
- 章节：目录、spine、章节标题和合并/拆分。
- 正文：逐 block 查看、拆合段、噪声标记。
- 图片：沿用现有 MiMo 标注，增加锚点调整。
- 校验：parse/validate 报告、错误定位、重新生成。

## 验收

MVP 验收顺序：

1. `export-epub` 从 `samples/gray-tower` 生成 `/tmp/gray-tower-v01.epub`。
2. `import-epub` 解析该 EPUB 到临时 bookpack。
3. `parse` 通过。
4. `validate` 无 error。
5. 章节数、图片数、正文 block 数与源 bookpack 基本一致。
6. `prepare-mimo` 生成每章清洗任务包。
7. 图片可在后续正式 `/cleaning/` 页面继续识别并写回 `alt`。

真实书籍验收在 MVP 之后做；先用反向 EPUB fixture 打稳闭环。
