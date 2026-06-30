# 项目进度审计 2026-06-30

本审计以当前代码和样例数据为准，不以旧文档承诺为准。目的不是重写需求，而是给下一轮实现留下一个不自欺的接手入口。

## 1. 当前代码事实

### 已实现并有自动化验证

- `tools/src/cli.ts` 提供 `parse` / `validate` / `compile` / `query`。
- `tools/src/parser.ts` 可从 `manifest.json` 和 `parsed/volumes/*.md` 生成 `parsed/*.jsonl` 与 `reports/cleaning_report.json`；支持多卷按 manifest 顺序解析，日文参考从 `source/ja/{volume}.json` 合入 alignment。
- `tools/src/validator.ts` 校验 manifest、Markdown marker、Parsed、Accepted、Candidates、Review 和 Compiled，错误阻断 compile。
- `tools/src/compiler.ts` 从 manifest + Parsed + Accepted 编译 `compiled/reader_index.json`，且要求 `reports/validation_report.json` 为 `passed`。
- `tools/src/query.ts` 实现 `getVisibleContext(current_block, read_boundary, options)`：增强数据按 `read_boundary` 过滤，`current_block` 只决定当前位置相关性。
- `tools/scripts/gray-tower-fixture.ts` 在临时 bookpack 中确定性生成 Candidates / Review / Accepted / work_runs，不调用模型。
- `tools/src/query.gray-tower.test.ts` 复制提交态样例包到临时目录，重放 fixture，再验证防剧透、speaker label、term card、asset、日文参考和数值边界。

### 已实现但尚未完成真实长篇验证

- `tools/src/server.ts` + `tools/web/*` 提供三栏数据工作台：左侧配置与章节选择，中间逐 block，右侧标识 / 异常队列 / 审计回滚。
- `tools/src/agent/pipeline.ts` 实现 `runDraft` / `runReview` / `resolveException`：
  - 起草与复核以章节为目标范围。
  - 起草和复核都会把目标章节所属的整卷正文作为背景。
  - 候选写入 `candidates/candidates.jsonl`。
  - 复核模型路由为 auto / escalate / reject。
  - auto 通过 `AgentStore.write()` 写 Accepted + Change。
  - escalate 写 `review/review_items.jsonl`。
  - 人工裁决可接受、拒绝或转 OpenQuestion。
- `tools/src/agent/config.ts` 把 bookpack 路径、base_url、model、api_key 存到 `tools/.workbench-config.json`；该文件已 gitignore。`/api/state` 只返回 `api_key_set`，不返回 key 明文。

这些工作台代码已有本地真实 LLM 试跑反馈，但该验证依赖制作者本机 API key，没有进入仓库可复现自动测试。仓库内可重复验证的部分仍是无 key 的 fixture / typecheck / test / validate / compile；API key 不应提交进仓库。

## 2. 当前样例包事实

`samples/gray-tower` 的提交态是清洗后样例包，不保存 AI 后处理结果：

- `accepted/*.jsonl`：空。
- `candidates/candidates.jsonl`：空。
- `review/*.jsonl`：空。
- `reports/work_runs.jsonl`：空。
- `compiled/reader_index.json`：由空 Accepted 编译得到，仍可作为清洗后 reader_index 基线。

测试需要的分析数据由 fixture 在临时目录生成。以后不要把测试期间的大模型输出、fixture 输出或人工试跑后的 Accepted 混回提交态样例包，除非明确决定改变样例包基线。

## 3. 与需求的对照

### 阶段 1-4

清洗 Markdown、Parsed 生成、硬校验已落地。代码路径是 parser、validator 和 CLI。gray-tower 覆盖一卷、五章、图片锚点、中日 alignment 和 Markdown marker。

### 阶段 5-8

AI 起草、独立 AI 复核、Accepted 写入、异常队列、Change 审计和回滚已实现为工作台雏形。当前实现不是旧的逐候选人工点击工作台。制作者已用真实 LLM 在本地试跑过该流程，但尚未拿真实书籍进行长程测试，也没有形成可提交的脱敏验收记录。

但需要注意以下边界：

- 当前作业粒度是章节，不是任意 scene / block range / 整卷。
- 当前上下文策略是“目标章节 + 所属整卷正文 + 已确认实体列表”。`prompts.ts` 只把 Accepted 中的 entity 列表渲染进提示词；事实、事件、关系、数值、角色卡、OpenQuestion 等尚未作为压缩历史上下文注入。
- 尚未测试输入第二卷时，如何提供第一卷前文信息且不过度占据上下文空间。当前代码会给第二卷任务喂第二卷整卷正文，但不会自动生成“前卷压缩记忆”或按需检索历史 Accepted。
- `work_runs.context_estimate` 目前只记录 target/background block 数，不是 token 预算器。
- 文档中“复核模型必须不同于起草模型”目前是操作要求和 UI/文档建议，代码没有硬性拒绝同模型配置。

### Compiled / Query

Compiled 查询层已经比阅读器先完成。它能验证防剧透语义，但它不是阅读器 UI。

### 阅读器

最低限度 Markdown 阅读器尚未进入实现。当前没有用户阅读界面、自动推进 `read_boundary`、跳读检测、返回已读边界、右侧增强面板等 UI。现有 `getVisibleContext()` 是阅读器将来要调用的数据接口。

## 4. 实现风险和技术债

- `AgentStore.write()` 对同 id Accepted 会替换当前行，但 Change 的 `before` 仍为 `null`；`revertChange()` 会删除目标对象而不是恢复旧版本。因此当前回滚适合“自动接受新对象”场景，不足以支撑真正的 `manual_update` / `merge_entities` / `deprecate_object` 历史恢复。
- 工作台的回滚 API 支持按 `change_id` 或 `work_run_id` 撤销；尚无“按对象 id 独立回滚”的专门接口。
- 复核判定没有单独 `review_runs` 或 decision log；目前只通过 candidate status、review_item、changes 和 work_runs 留痕。
- `tools/src/stores.ts` 是 fixture 用的覆盖式写入模型；`tools/src/agent/agentStore.ts` 是工作台增量写入模型。两者用途不同，后续不要混用。
- 真实 LLM 输出 JSON 的健壮性只做了 `extractJson()` 级别处理，还没有 schema-level 修复循环或失败重试策略。
- 工作台未自动触发 validate / compile；自动落盘后需要人或后续 Agent 调用 CLI 重新验证和编译。

## 5. 下一步建议

1. 先设计并实现“前卷上下文压缩 / 检索”最小方案，再拿双卷样例测试第二卷输入。
2. 为已完成的真实 LLM 本地试跑补脱敏验收记录，并继续保持 API key 只放本地配置、不进 git；下一轮重点是实书长程和多卷压力测试。
3. 补 `AgentStore` 的真实更新语义：Change 写入 `before` 快照，回滚能恢复旧对象；再开放 update / merge / deprecate。
4. 进入最小 Markdown 阅读器：只读 manifest、Markdown、Parsed、Compiled，不改 schema；先验证 `current_block`、`read_boundary` 和右侧面板。
5. 等阅读器跑通后，再回头做 scene digest、token 预算器、更多作业范围和批量异常处理。
