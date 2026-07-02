# 模块：EPUB 清洗流水线

## 目标

清洗模块的用户入口是用户本地合法持有的整本 EPUB。系统负责把 EPUB 转成下游 bookpack，并把多模态模型的清洗建议留在可审计报告里。

当前实现是 MVP：受控 EPUB fixture 可以导入、校验、生成 MiMo 章节任务并逐章调用模型；真实多卷书、复杂 EPUB 版式和通用建议写回仍是下一步。

## 当前代码事实

实现文件：

- `tools/src/cleaning/bookpackToEpub.ts`
- `tools/src/cleaning/epubImport.ts`
- `tools/src/cleaning/mimoFeed.ts`
- `tools/src/cleaning/mimoRun.ts`
- `tools/src/cleaning/imageAnnotate.ts`
- `tools/src/server.ts`
- `tools/web/cleaning/*`

CLI：

```bash
cd tools
npx tsx src/cli.ts export-epub <bookpack-dir> <out.epub> [volume_id]
npx tsx src/cli.ts import-epub <epub-path> <bookpack-dir> [--volume-id v01] [--series-id id] [--pack-id id] [--pack-name name] [--force] [--no-validate]
npx tsx src/cli.ts prepare-mimo <bookpack-dir> [volume_id]
npx tsx src/cli.ts run-mimo-cleaning <bookpack-dir> <task-json>
```

HTTP / UI：

- `/cleaning/`：一键清洗界面。
- `POST /api/cleaning/auto-start`：只传 `epub_path`，自动导入、parse、validate、生成 MiMo 任务。
- `POST /api/cleaning/run-mimo`：执行单个 MiMo 章节任务。
- `GET /api/cleaning/mimo-output`：查看模型输出报告。
- 图片 alt 旧路径仍保留：`/api/cleaning/assets`、`/api/cleaning/annotate`、`/api/cleaning/set-alt`。

## 当前一键流程

```text
EPUB 路径
-> /tmp/novel-companion-cleaning/{epub-stem}
-> import-epub 写 manifest + parsed/volumes/{volume}.md + assets/images
-> Parser.parseBookpack()
-> Validator.validateBookpack()
-> prepare-mimo 生成每章任务包
-> run-mimo-cleaning 逐章调用 vision 模型
-> reports/cleaning_mimo_outputs/*.json
-> 前端展示章节进度和建议
```

界面现在支持填写一个或多个 EPUB 路径；多个单卷 EPUB 按“一行一本”提交，系统会按文件名里的 `v01` / `v02` 等卷号或输入顺序导入到同一个 bookpack。`series_id`、`pack_id` 和目标目录由系统自动生成。失败章节会标红并继续后续章节，便于定位模型或 EPUB 问题。

## 反向 EPUB Fixture

命令：

```bash
cd tools
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v01.epub v01
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v02.epub v02
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v03.epub v03
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v04.epub v04
```

这些命令从已清洗的 bookpack 反向生成每卷一个标准 EPUB 3：

- `mimetype`
- `META-INF/container.xml`
- `OEBPS/content.opf`
- `OEBPS/nav.xhtml`
- `OEBPS/text/{chapter}.xhtml`
- `OEBPS/images/...`

用途是给 importer 提供可控输入：先用已知合格的 `gray-tower` 生成 EPUB，再解析回 bookpack，比较章节数、正文段落、图片锚点和校验结果。

## EPUB Import MVP

单卷导入命令：

```bash
cd tools
npx tsx src/cli.ts import-epub /tmp/gray-tower-v01.epub /tmp/gray-tower-imported \
  --volume-id v01 \
  --series-id gray_tower_imported \
  --pack-id gray_tower_imported_project_v1 \
  --force
```

多卷模拟测试使用多个单卷 EPUB 追加到同一个 bookpack：

```bash
npx tsx src/cli.ts import-epub /tmp/gray-tower-v01.epub /tmp/gray-tower-imported --volume-id v01 --force
npx tsx src/cli.ts import-epub /tmp/gray-tower-v02.epub /tmp/gray-tower-imported --volume-id v02 --append
npx tsx src/cli.ts import-epub /tmp/gray-tower-v03.epub /tmp/gray-tower-imported --volume-id v03 --append
npx tsx src/cli.ts import-epub /tmp/gray-tower-v04.epub /tmp/gray-tower-imported --volume-id v04 --append
```

当前实现：

- 读取 EPUB zip。
- 读取 `META-INF/container.xml`。
- 解析 `.opf` 的 manifest / spine。
- 按 spine 顺序读取 XHTML。
- 抽取 `h1`、`p`、`hr`、`figure/img`。
- 生成或追加 `manifest.json`、`parsed/volumes/{volume}.md`、`assets/images/*`。
- 默认执行 `Parser.parseBookpack()` 和 `Validator.validateBookpack()`。

受控 fixture 验证结果：

- `volumes=4`
- `chapters=25`
- `blocks=181`
- `images=5`
- `validation=passed`

说明：反向 EPUB 不携带 Markdown 的 `alignment` marker，因此导入后 `alignments=0` 是预期行为。真实 EPUB 的日文对照或翻译对齐后续应作为单独清洗步骤进入 `source/ja/`。

## MiMo 任务与输出

`prepare-mimo` 输出：

```text
reports/cleaning_mimo_inputs/index.json
reports/cleaning_mimo_inputs/{chapter_id}.json
```

每个章节任务包含：

- `constraints`：模型必须遵守的清洗约束。
- `expected_output_schema`：要求模型输出的 `suggestions[]` 结构。
- `blocks[]`：章节内 block ID、kind、order、正文。
- `local_images[]`：图片 asset ID、锚点 block、本地相对路径和绝对路径。
- `messages[]`：可转成 OpenAI-compatible chat messages 的文本部分。

`run-mimo-cleaning` 会读取本地 `tools/.workbench-config.json` 的 `vision` 配置，把任务包里的 `image_ref` 转成真实图片输入，调用模型并写出：

```text
reports/cleaning_mimo_outputs/{task_id}.json
```

当前策略：

- 不打印 API key。
- 使用 `jsonMode: true`。
- 使用 `thinking: "enabled"`，只读取最终 `content`，不展示、不写入 `reasoning_content`。
- 空输出不做幻觉式 JSON 修复。
- 过滤无效 target，避免模型编造 asset/block ID。

## 数据边界

清洗模块可以写：

- `manifest.json`
- `parsed/volumes/*.md`
- `assets/images/*`
- `parsed/*.jsonl`（通过 Parser 再生成）
- `reports/cleaning_*`

清洗模块不直接写：

- `accepted/`
- `candidates/`
- `review/`
- `compiled/`

这些仍由 AI 数据工作台、Parser、Validator 和 Compiler 负责。图片 alt 是例外路径：人工确认后 `set-alt` 只改 Markdown asset marker，然后重解析。

## 未完成

- 多卷真实 EPUB：受控测试路径已支持多个单卷 EPUB append 汇入同一 bookpack；真实 EPUB 内部目录 / 标题 / 用户规则拆卷仍需增强。
- 真实 EPUB 兼容性：脚注、诗歌、短信体、表格、跨文件章节合并、异常 nav/ncx、非正文广告页等尚未系统测试。
- 通用建议写回：MiMo 的 `suggestions[]` 当前只入报告和界面展示；还没有通用应用器把低风险建议安全写回 Markdown / manifest。
- 人工确认队列：高风险清洗建议还没有独立队列，不能像 review item 那样批量裁决。
- 整本书到分卷任务：清洗入口已是一本 EPUB，但下游起草 / 复核仍是章节作业 + 当前卷正文 + Accepted 记忆。是否升级为“整本书输入 -> 卷任务 -> 章子任务”需在多卷测试后定。
- 日文源：`source/ja/{volume}.blocks.json` 当前不是 EPUB importer 产物。

## 下一轮验收

1. 准备多个单卷 EPUB fixture，优先用 `gray-tower` 反向合成。
2. `/cleaning/` 多行路径一键导入，确认 manifest 能表达多卷。
3. 每卷 parse + validate 通过。
4. 每章生成 MiMo 任务并能展示进度。
5. 明确 `suggestions[]` 的哪些类型可自动写回，哪些必须进人工确认。
6. 跑 v01/v02 DeepSeek 起草 + 复核，验证 v02 是否拿到 v01 的 Accepted 记忆。
