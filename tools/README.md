# novel-companion tools

第一阶段 bookpack 工具链（Node + TypeScript）。实现 `docs/agent-operation-spec-v0.1.md`
第 4 节定义的工具接口，逐个补齐第一阶段闭环。

## 环境

- Node >= 18
- 安装依赖：`npm install`

## 数据包闭环（不含 AI Agent）

完整跑一遍 gray-tower：

```bash
npx tsx src/cli.ts parse ../samples/gray-tower            # 1. Markdown -> Parsed JSONL
npx tsx scripts/gray-tower-fixture.ts ../samples/gray-tower  # 2. 候选 + 人工复核（夹具）
npx tsx src/cli.ts validate ../samples/gray-tower         # 3. 硬校验
npx tsx src/cli.ts compile ../samples/gray-tower          # 4. 编译 reader_index
npx tsx src/cli.ts query ../samples/gray-tower <current_block> <read_boundary> [--ja]  # 5. 防剧透查询
```

### Parser（§4.2）

Markdown 卷文件 → `parsed/{blocks,scenes,assets,asset_anchors,alignments}.jsonl` + `reports/cleaning_report.json`。可重复生成，不保存复核进度。

- 识别 `chapter` / `block` / `scene` / `asset` / `alignment` 五种单行 HTML 注释 marker。
- `block.order` / `scene.order` 每章从 1 重新计数；`kind` 省略按 `paragraph`。
- asset 路径通过 `assets/images/{asset_id}.*` 解析。
- alignment 只携带 zh block 引用与 status；日文 `ja_refs` 单独编写，默认空数组。

### Validator（§4.3）

`validate` 跑 manifest / Markdown / Parsed / Accepted / Candidates / Review / Compiled 全套硬校验，写 `reports/validation_report.json`。`error` 阻断 compile，`warning` 不阻断。

### AcceptedStore + ReviewQueue + WorkRunStore（§4.5–4.8，见 `src/stores.ts`）

受控写入路径：人工确认后才写 `accepted/*.jsonl` 并同步 `accepted/changes.jsonl`；候选状态、ReviewItem、OpenQuestion、block 进度、work_runs 一并维护。不调用任何模型。

### Compiler + 查询（§4.7）

`compile` 从 manifest + Parsed + Accepted 生成 `compiled/reader_index.json`（仅当 validation `passed`）。`query` 调用 `getVisibleContext(current_block, read_boundary, options)`：所有增强数据按 `read_boundary` 过滤，`current_block` 只决定当前位置相关性，越界返回 `is_ahead_of_boundary: true` 但不放宽可见边界。

### gray-tower 夹具（`scripts/gray-tower-fixture.ts`）

替代第一阶段尚未实现的 AI 制作 Agent：编写候选集并通过真实写入接口重放一次人工复核，确定性地生成 candidates + accepted + review + work_runs。满足测试书 §10.4/§10.5 计数与 §10.6/§10.10 防剧透用例。

## 待实现

CandidateGenerator、内置制作 Agent（AI 起草层）、最低限度 Markdown 阅读器（UI）。日文 `ja_refs` 来源接入（解析器合并 ja 源）。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test 单元测试
```
