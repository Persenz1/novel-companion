# novel-companion 工具链

第一阶段 bookpack 工具链（Node + TypeScript）。

当前工具链覆盖解析器、校验器、测试夹具、编译器、查询器、EPUB 清洗最小可用版本，以及清洗后制作阶段的数据工作台（`npm run workbench`）。工作台按 `docs/modules/ai-workbench.md` 实现：AI 起草 + 独立 AI 复核自动落盘 + 人审计异常。

状态边界：工作台、最低限度阅读器界面和 `/cleaning/` 一键清洗已实现；gray-tower 4 卷 DeepSeek A 阶段长程压力已跑通；真实 COTE v01-v03 的清洗、v01 日文匹配、DeepSeek 起草/复核已经合并为本机结果包 `~/nc-workpack/cote-bilingual-v1`。仓库自动测试不调用模型、不需要 API 密钥；复杂 EPUB 兼容性、阅读器制作作业、DeepSeek/MiMo usage 对账与缓存成本优化，以及 B 阶段前卷上下文压缩 / 检索仍未完成。

## 环境

- Node >= 20
- 安装依赖：`npm install`

## 数据包闭环（不含 AI 代理）

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

受控写入路径：人工确认后才写 `accepted/*.jsonl` 并同步 `accepted/changes.jsonl`；候选状态、复核项、未决问题、段落块进度、工作运行记录一并维护。不调用任何模型。当前主要由 gray-tower 测试夹具使用，不代表最终工作台交互。

### Compiler + 查询（§4.7）

`compile` 从 manifest + Parsed + Accepted 生成 `compiled/reader_index.json`（仅当 validation `passed`）。`query` 调用 `getVisibleContext(current_block, read_boundary, options)`：所有增强数据按 `read_boundary` 过滤，`current_block` 只决定当前位置相关性，越界返回 `is_ahead_of_boundary: true` 但不放宽可见边界。

### gray-tower 夹具（`scripts/gray-tower-fixture.ts`）

替代模型调用参与自动化测试：编写候选集并通过真实写入接口重放一次人工复核，确定性地生成候选、已确认数据、复核队列和工作运行记录。满足测试书 §10.4/§10.5 计数与 §10.6/§10.10 防剧透用例。它不证明真实大模型长程质量，只保证数据格式、写入链路和查询语义可复现。

## 数据工作台（清洗后制作阶段）

图形化三栏工作台，AI 全程驱动 + AI 复核 + 人审计异常：

```bash
npm run workbench          # 默认 http://localhost:4173，可用 NC_PORT 覆盖
```

浏览器打开后：

1. **设置**（左栏）：填数据包目录（含 manifest.json）、起草模型、复核模型。采用 OpenAI 通用协议（`/chat/completions`），DeepSeek / MiMo 等兼容供应商直接可用；复核模型应不同于起草模型。API 密钥只存本地 `tools/.workbench-config.json`（已 gitignore，不提交、不进数据包、不回传给前端明文）。
2. **左栏**：按章节选择 AI 生成范围（起草/复核以整章为单位）。
3. **中栏**：逐 block 展示正文，每段带「确认 / 候选 / 异常」标识数。
4. **右栏**：点开某 block 看它身上的全部标识；另有「异常队列」（人工裁决升级项）和「审计 / 回滚」（按 Change 撤销）两个标签页。

流水线：`起草`（起草模型抽候选）→ `复核`（复核模型独立路由：低风险自动落盘 + Change、高风险升级进异常队列、无依据拒绝）。每次自动写入都生成可回滚 Change（单 Change / 整批 work_run；完整 update/merge 历史恢复仍需补 before 快照）。

模块：`src/server.ts`（HTTP）、`src/agent/{config,llm,providers,prompts,pipeline,agentStore,workbenchData}.ts`、`web/`（原生 ESM 前端，无构建步骤）。

## EPUB 清洗最小可用版本

清洗入口在同一个工作台服务器：

```bash
npm run workbench
# 浏览器打开 /cleaning/
```

当前界面支持填一个或多个 EPUB 路径；多本时一行一本，系统会自动导入到 `/tmp/novel-companion-cleaning/{epub-stem}`，解析 + 校验，生成全书 MiMo 章节任务，并逐章调用视觉模型展示清洗建议。受控测试夹具可用以下命令复现：

```bash
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v01.epub v01
npx tsx src/cli.ts export-epub ../samples/gray-tower /tmp/gray-tower-v02.epub v02
npx tsx src/cli.ts import-epub /tmp/gray-tower-v01.epub /tmp/gray-tower-imported --volume-id v01 --force
npx tsx src/cli.ts import-epub /tmp/gray-tower-v02.epub /tmp/gray-tower-imported --volume-id v02 --append
npx tsx src/cli.ts prepare-mimo /tmp/gray-tower-imported
npx tsx src/cli.ts run-mimo-cleaning /tmp/gray-tower-imported reports/cleaning_mimo_inputs/v01.c01.json
```

当前限制：MiMo 通用建议可通过 ingest/apply 批量写回 Markdown / manifest，并带快照回滚；split_block / merge_blocks 仍需人工处理。真实 EPUB 的复杂目录、脚注和跨文件章节合并仍需增强。

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

四卷 A 阶段脚本：

```bash
cd tools
npx tsx scripts/long-range-phase-a.ts --run-model --work /tmp/gt-longrange-4vol --volumes v01,v02,v03,v04 --force
```

已完成 gray-tower 结果见 `docs/modules/long-range-test-phase-a-2026-07-01.md`。真实 COTE v01-v03 结果见 `docs/modules/real-book-bilingual-long-range-test.md`，当前主数据包为 `~/nc-workpack/cote-bilingual-v1`，后续不再重复清洗 / 匹配 / 起草 / 复核。

## 待实现

阅读器制作作业（角色卡 / 时间线 / 说话人）、复杂 EPUB 兼容性、DeepSeek/MiMo usage 对账与缓存成本优化、批量合并同名实体、B 阶段跨卷前文上下文的梗概 / 预算器 / 可选 RAG、`AgentStore` 的更新 / 合并 / 废弃完整回滚语义。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test 单元测试
```
