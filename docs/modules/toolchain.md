# 模块：工具链

## 需求

工具链负责把清洗后的 bookpack 变成可校验、可查询、可测试的本地数据包。所有生成产物应可重复生成，不靠手工维护。

## CLI

入口在 `tools/src/cli.ts`：

```bash
npx tsx src/cli.ts parse <bookpack-dir> [volume_id]
npx tsx src/cli.ts validate <bookpack-dir>
npx tsx src/cli.ts compile <bookpack-dir>
npx tsx src/cli.ts query <bookpack-dir> <current_block> <read_boundary> [--ja]
npx tsx src/cli.ts describe-image <image-path> [prompt]
npx tsx src/cli.ts export-epub <bookpack-dir> <out.epub> [volume_id]
npx tsx src/cli.ts import-epub <epub-path> <bookpack-dir> [--volume-id v01] [--series-id id] [--pack-id id] [--pack-name name] [--force] [--no-validate]
npx tsx src/cli.ts prepare-mimo <bookpack-dir> [volume_id]
npx tsx src/cli.ts run-mimo-cleaning <bookpack-dir> <task-json>
```

## Parser

实现：`tools/src/parser.ts`

职责：

- 读取 manifest 和 Markdown。
- 解析 chapter / block / scene / asset / alignment marker。
- 生成 Parsed JSONL。
- 生成 `reports/cleaning_report.json`。
- 合并 `source/ja/{volume}.json` 中的日文参考。

Parsed 是可再生成产物，不保存复核进度。

## Validator

实现：`tools/src/validator.ts`

职责：

- 校验 manifest 必填字段、章节、正文路径。
- 校验 Markdown marker、block、scene、asset、alignment。
- 校验 Accepted / Candidate / Review 引用。
- 校验 Compiled 基础状态。
- 写 `reports/validation_report.json`。

`error` 阻断 compile；`warning` 不阻断。

## Compiler

实现：`tools/src/compiler.ts`

职责：

- 要求 validation report 为 `passed`。
- 读取 manifest、Parsed、Accepted。
- 构建中文正文时间线。
- 生成 `compiled/reader_index.json`。

Compiled 是查询产物，不是人工维护源数据。

## EPUB Export Fixture

实现：`tools/src/cleaning/bookpackToEpub.ts`

职责：

- 从已清洗 bookpack 反向生成 EPUB 3。
- 保留章节顺序、正文段落和图片资源。
- 作为 EPUB importer 的可控测试输入。

常用命令：

```bash
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v01.epub v01
```

## EPUB Import MVP

实现：`tools/src/cleaning/epubImport.ts`

职责：

- 读取 EPUB zip、`container.xml`、OPF manifest / spine。
- 按 spine 解析 XHTML。
- 抽取章节标题、段落、分隔线和 figure 图片。
- 生成 `manifest.json`、`parsed/volumes/{volume}.md`、`assets/images/*`。
- 默认串联 `parse` + `validate`。

常用命令：

```bash
npx tsx src/cli.ts import-epub /tmp/gray-tower-v01.epub /tmp/gray-tower-imported \
  --series-id gray_tower_imported \
  --pack-id gray_tower_imported_project_v1
```

当前 MVP 优先验证受控 EPUB fixture；真实 EPUB 的复杂样式、脚注、跨文件章节合并、目录异常和图片锚点修正交给后续清洗增强。

## MiMo Feed Preparation

实现：`tools/src/cleaning/mimoFeed.ts`

职责：

- 读取已 parse 的 bookpack。
- 按章节生成 MiMo 清洗任务包。
- 每个任务包包含 block、图片锚点、本地图片路径、提示词、约束和期望输出 schema。
- 不调用模型、不写回 Markdown；正式清洗界面读取任务包后再把 `image_ref` 转成 `imagePart()`。

常用命令：

```bash
npx tsx src/cli.ts prepare-mimo /tmp/gray-tower-imported v01
```

输出位置：

```text
reports/cleaning_mimo_inputs/index.json
reports/cleaning_mimo_inputs/{chapter_id}.json
```

## MiMo Headless Run

实现：`tools/src/cleaning/mimoRun.ts`

职责：

- 读取 `prepare-mimo` 生成的章节任务包。
- 将 `image_ref` 的本地图片路径转成 OpenAI-compatible `imagePart()`。
- 调用配置中的 `vision` 模型。
- 解析模型 JSON 输出。
- 写入 `reports/cleaning_mimo_outputs/{task_id}.json`。

常用命令：

```bash
npx tsx src/cli.ts run-mimo-cleaning /tmp/gray-tower-imported \
  reports/cleaning_mimo_inputs/v01.c01.json
```

该命令会读取 `tools/.workbench-config.json` 中的 `vision` 配置；不会打印 API key。

## Vision Describe

实现：`tools/src/cli.ts` + `tools/src/agent/llm.ts`

职责：

- 读取本地图片。
- 使用配置中的 `vision` 模型做一次图文调用。
- 用于验证 MiMo / 其他多模态供应商配置是否可用。

常用命令：

```bash
npx tsx src/cli.ts describe-image ../samples/gray-tower/assets/images/v01_img_001.png
```

## 测试与验证

常用命令：

```bash
cd tools
npm run typecheck
npm test
npx tsx src/cli.ts validate ../samples/gray-tower
npx tsx src/cli.ts compile ../samples/gray-tower
```

当前自动测试不调用真实模型，不需要 API key。

## 未完成

- 编译产物过期检测只预留 `source_fingerprint`。
- validator 的 schema 校验还不是完整 JSON Schema。
- draft / review 后不会自动 validate / compile；工作台已有 `POST /api/compile`，可在阶段收口时一键 validate + compile。
