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
- validate / compile 尚未由工作台自动串联触发。
