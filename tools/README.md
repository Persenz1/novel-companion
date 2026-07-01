# novel-companion tools

第一阶段 bookpack 工具链（Node + TypeScript）。

当前工具链覆盖 parser、validator、fixture、compiler、query，以及清洗后制作阶段的数据工作台（`npm run workbench`）。工作台按 `docs/modules/ai-workbench.md` 实现：AI 起草 + 独立 AI 复核自动落盘 + 人审计异常。

状态边界：工作台和最低限度阅读器 UI 已实现；gray-tower 4 卷 DeepSeek Phase A 长程压力已跑通。仓库自动测试不调用模型、不需要 API key；真实（版权）书籍长程制作、review item 批量裁决，以及 Phase B 前卷上下文压缩 / 检索仍未完成。

## 环境

- Node >= 20
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

### AcceptedStore + ReviewQueue + WorkRunStore（夹具用受控写入路径，见 `src/stores.ts`）

受控写入路径：人工确认后才写 `accepted/*.jsonl` 并同步 `accepted/changes.jsonl`；候选状态、ReviewItem、OpenQuestion、block 进度、work_runs 一并维护。不调用任何模型。当前主要由 gray-tower fixture 使用，不代表最终工作台交互。

### Compiler + 查询（§4.7）

`compile` 从 manifest + Parsed + Accepted 生成 `compiled/reader_index.json`（仅当 validation `passed`）。`query` 调用 `getVisibleContext(current_block, read_boundary, options)`：所有增强数据按 `read_boundary` 过滤，`current_block` 只决定当前位置相关性，越界返回 `is_ahead_of_boundary: true` 但不放宽可见边界。

### gray-tower 夹具（`scripts/gray-tower-fixture.ts`）

替代模型调用参与自动化测试：编写候选集并通过真实写入接口重放一次人工复核，确定性地生成 candidates + accepted + review + work_runs。满足测试书 §10.4/§10.5 计数与 §10.6/§10.10 防剧透用例。它不证明真实 LLM 长程质量，只保证数据格式、写入链路和查询语义可复现。

## 数据工作台（清洗后制作阶段）

图形化三栏工作台，AI 全程驱动 + AI 复核 + 人审计异常：

```bash
npm run workbench          # 默认 http://localhost:4173，可用 NC_PORT 覆盖
```

浏览器打开后：

1. **设置**（左栏）：填数据包目录（含 manifest.json）、起草模型、复核模型。采用 OpenAI 通用协议（`/chat/completions`），DeepSeek / MiMo 等兼容供应商直接可用；复核模型应不同于起草模型。API key 只存本地 `tools/.workbench-config.json`（已 gitignore，不提交、不进数据包、不回传给前端明文）。
2. **左栏**：按章节选择 AI 生成范围（起草/复核以整章为单位）。
3. **中栏**：逐 block 展示正文，每段带「确认 / 候选 / 异常」标识数。
4. **右栏**：点开某 block 看它身上的全部标识；另有「异常队列」（人工裁决升级项）和「审计 / 回滚」（按 Change 撤销）两个标签页。

流水线：`起草`（起草模型抽候选）→ `复核`（复核模型独立路由：低风险自动落盘 + Change、高风险升级进异常队列、无依据拒绝）。每次自动写入都生成可回滚 Change（单 Change / 整批 work_run；完整 update/merge 历史恢复仍需补 before 快照）。

模块：`src/server.ts`（HTTP）、`src/agent/{config,llm,prompts,drafter…pipeline,agentStore,workbenchData}.ts`、`web/`（原生 ESM 前端，无构建步骤）。

## 阅读器（只读，防剧透 + 中日双语）

只读 manifest / Parsed / Compiled 的阅读器，完全复用 `CompiledQuery.getVisibleContext`。两种起法：

```bash
npm run workbench   # 推荐：工作台 + 阅读器合并，阅读器在 /reader/（共用工作台配置的 bookpack）
npm run reader      # 独立只读阅读器，默认读 ../samples/gray-tower，端口 4174（NC_PORT 可覆盖）
npx tsx src/reader.ts <bookpack-dir>
```

中文正文为唯一主轴：阅读标尺推算 `current_block`，连续阅读自动推进 `read_boundary`，跳读 / 目录跳转 / 大幅拖动不推进，也可鼠标点选 block；右侧增强面板始终按 `read_boundary` 过滤，`current_block` 越界时提示预览。**中日双语为逐段交替显示**（真正双语），可切 中日双语 / 仅中文 / 仅日文——日文按 block 存于 `source/ja/{vol}.blocks.json`。读侧视图逻辑 `src/readerView.ts`（工作台与独立阅读器共用），前端 `web/reader/`。详见 `docs/modules/reader.md`。

## 长程测试

跨卷上下文「要喂多少前文才够」的执行手册见 `docs/modules/long-range-test.md`（在工作副本上跑，勿脏化提交态样例）。

四卷 Phase A 脚本：

```bash
cd tools
npx tsx scripts/long-range-phase-a.ts --run-model --work /tmp/gt-longrange-4vol --volumes v01,v02,v03,v04 --force
```

已完成结果见 `docs/modules/long-range-test-phase-a-2026-07-01.md`。该结果证明 gray-tower 上「全局 Accepted + 当前卷正文」足以支撑主线连续性；下一步优先清理高风险 review item，而不是先做 Phase B。

## 待实现

review item 批量裁决 / 批量转 OpenQuestion、真实书籍长程压测、Phase B 跨卷前文上下文的梗概 / 预算器 / 可选 RAG、`AgentStore` 的 update/merge/deprecate 完整回滚语义。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test 单元测试
```
