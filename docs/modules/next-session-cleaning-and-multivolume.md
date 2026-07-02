# 下一轮：阅读器作业与结果包验收

## 本轮已收口（2026-07-03，全三卷起草/复核 v2 真实跑通）

工作包：

```text
~/nc-workpack/cote-cleaning-panel-recovered-2026-07-02
```

v01/v02/v03 三卷 entities/knowledge/narrative 三个 pass（draft+review）全部真实跑完，全包 `validate` + `compile` passed。最终 accepted：entities 83、facts 349、events 173、metrics 31、metric_changes 4、term_cards 6（relation_change 恒被强制升级，0 自动落盘，全部在 review item 里）。缓存命中率均值 95.9%（含每卷首窗冷启动 0%，命中窗口稳定在 95%+）。review item 待人工裁决 192 条（fact 69 / relation_change 66 / event 32 / metric 11 / term_card 10 / entity 3 / metric_change 1），全部 status=open，尚未处理。

**speakers pass 已放弃**：性价比/实用性判断（用户决定），draft 覆盖率实测只有 81.3%（402/2154 对话块 3 轮补跑后仍缺，比设计文档记录的更差），已把本轮产出的候选/accepted/review item 全部回滚清除，`prompts.ts`/`pipeline.ts` 里的 speakers pass 代码保留但不再运行。是否要连代码一起删掉，留给用户决定。

本轮过程中发现并修复的真实 bug（都在 `tools/src/agent/`）：

1. **entities pass 空跑 0 产出**：prompt 要求信封 `type` 写细分类别（如 `character`），与「信封 type 必须是字面量 `entity`」的路由约定冲突，模型学的是前者，候选被过滤器静默丢弃。修了 `prompts.ts` 的 entities instruction。
2. **实体 id 偶发带空格**（如 `entity_horikit suzune`）：加了 slug 格式的显式约束。
3. **`ACCEPTED_POSITION_INVALID`（visible_from 缺失/幻觉）**：draft schema 里 `visible_from`/`source_span` 与信封字段重复，模型经常漏填或填出超出章节实际长度的幻觉 block id。改为接受前用信封值（已做过 `makeRefNormalizer` 校验，保证有效）无条件覆盖 draft 同名字段——`pipeline.ts` 的 `backfillPositionFields`。
4. **`edited_draft` 偶尔是 JSON 字符串而非对象**：复核模型 schema 漂移导致 `Cannot create property on string` 崩溃；加了 `asDraftRec` 兼容字符串解析。
5. **`metric_change` 数值字段带引号**（`"87"` 而非 `87`）：加了 `coerceMetricChangeNumbers`。
6. **fact 的 `valid_from`/`valid_until` 幻觉 block id**（如引用超出章节实际长度 300+ 的 block）：这个字段语义独立于 `visible_from`（15/231 样本里两者合理不同，不能无条件覆盖），改为有校验集合时才替换非法引用，退回 `visible_from`。
7. **draft-pass 无 resume-skip**：本轮连续两次网络/服务中断在长 pass 中途暴露了这个已知缺口（设计文档 §10 早有记录），现已实现——重跑同一 pass 会跳过已有 `completed` work_run 的窗口，不再重复产候选。

日文对照仍是之前的状态（v01 `3857/3857`，v02/v03 未做实体级匹配，只有章节级 alignment 审计项 12 条），本轮没有触碰。

## 下一步重点

清洗/起草/复核这条主线到此可以认为闭环跑通过一次；下一轮建议：

1. **192 条 review item 人工裁决**——这是本轮唯一还没做的环节，建议先做，才能看到"人审计"闭环下真正稳定的 accepted 数据。
2. 角色卡显示、审阅与必要编辑。
3. 时间线 / 事件线显示与审阅。
4. review item 人工裁决入口打磨（配合第 1 条一起打磨交互，而不是先做交互再测）。
5. 阅读器右栏信息密度、排序、跳转和防剧透验证（说话人展示已经没有数据，相关 UI 若还在，要么隐藏要么等用户决定是否连功能一起砍）。
6. usage audit：DeepSeek / MiMo 官网控制台与本地 `/api/usage` 按 request_id / 时间窗口对账（本轮 work_runs 里的 token_usage 已经是真实三卷全量数据，可以直接拿来对账）。
7. （更远期）多本不同 EPUB 验证清洗层通用性。

---

以下是本轮开始前的需求记录，保留为历史上下文。

## 用户明确需求

1. 清洗入口要是一整本书的 EPUB / 文本，而不是让用户手动分卷、填内部 ID。
2. 系统内部可以分卷、分章节处理；用户只应感知“一本书 -> 自动清洗”。
3. 清洗后文本处理也应统一为“整本书输入，按卷处理”。不要让起草 / 复核阶段和清洗阶段采用两套割裂逻辑。
4. 下一轮要测试：
   - 多个单卷 EPUB 汇入同一 bookpack，以及真实多卷 EPUB 解包与清洗。
   - DeepSeek 对多卷数据的起草 / 复核操作。
   - 多卷操作时，后卷是否能接收到前一卷信息。
5. DeepSeek cache 命中率当前约 20%，成本不可接受。后续要排查提示词前缀稳定性、请求组织方式和 agent 架构。
6. 可参考 deepseektui 等开源 agent 的请求组织 / cache 友好设计，但不要直接照搬；目标是降低整本书制作成本。

## 本轮收束后的测试主线

本轮优先级从“泛多卷能力”收束为真实书籍主线，详见 `real-book-bilingual-long-range-test.md`：

```text
第 1 卷中文清洗
-> 第 1 卷日文原版只做中日匹配与阅读器渲染
-> 第 1 卷起草 / 复核 / 裁决 / compile
-> 第 2/3 卷中文清洗
-> 带前文 Accepted 结构化记忆跑第 2/3 卷起草 / 复核
```

关键边界：

- 中文故事正文是唯一结构化主轴。
- 日文不参与实体 / 事实 / 事件 / 关系抽取。
- 翻译组信息、广告、版权、目录、奥付等场外信息不参与故事匹配和后续 agent 处理。
- 如果第 2/3 卷日文原版暂缺，长程处理仍先用中文清洗 + 前文 Accepted 验证。

## 当前代码事实

### 清洗阶段

当前清洗 UI 已是一键入口：

```text
EPUB 路径 -> 开始自动清洗
```

系统自动：

- 生成目标 bookpack。
- 导入 EPUB。
- parse + validate。
- 生成 MiMo 章节任务。
- 逐章调用 MiMo。
- 展示进度和建议。

当前 importer MVP 已能处理受控 EPUB fixture；真实多卷 EPUB 的 nav / spine / 多文件合并仍需测试。

### 起草 / 复核阶段

当前 `runDraft` / `runReview` 的作业粒度仍是章节，但背景上下文是“目标章节所属整卷正文”。两者逻辑已统一为整卷背景：

```text
target chapter + current volume body + accepted memory
```

这还不是“整本书正文一次性输入”。跨卷连续性当前主要依赖 Accepted 结构化记忆，而不是前卷原文全文。

下一轮要决定是否升级为：

```text
whole book source
-> volume jobs
-> chapter subjobs
-> stable shared prefix for DeepSeek cache
```

## DeepSeek cache 排查方向

DeepSeek 缓存命中依赖完整前缀单元复用。当前命中低可能来自：

- 每章请求的 user prompt 前缀不稳定。
- 当前卷正文和目标章节混排，导致公共前缀不足。
- Accepted 记忆顺序或内容每章变化。
- 起草与复核 prompt 结构不同，无法共享缓存。
- 每章 JSON 候选/复核输入插入位置太靠前，破坏长文本公共前缀。

建议下一步做请求结构重排：

```text
system prompt（稳定）
book/volume stable context（稳定）
accepted memory snapshot（稳定排序）
task instruction（稳定）
target chapter / candidate payload（最后变化）
```

工作台和清洗页的「用量」页签已经有仪表盘入口，会聚合 `reports/work_runs.jsonl` 与 `reports/cleaning_mimo_outputs/*.json`，按清洗 / 起草 / 复核阶段展示 token、缓存命中、输出、推理和图片 token。后续 cache 排查应以这个仪表盘为主要观察面，再按章节细查原始 JSONL。

## 下一轮验收建议

1. 用真实中文 EPUB 建立第 1 卷清洗工作副本，先不跑模型，确认故事正文 / 非故事页 / 图片 / readiness 的边界。
2. 导入日文原版第 1 卷，只做 story block 抽取与中日匹配，不生成 Accepted。
3. 阅读器检查第 1 卷：中文主轴、日文逐段显示、缺失匹配、图片页、非故事页过滤、防剧透右栏。
4. 对第 1 卷跑 DeepSeek 起草 + 复核 + 人工裁决 + compile，形成前文 Accepted 记忆。
5. 对第 2/3 卷跑中文清洗；如果日文原版未齐，先跳过日文匹配，不阻塞长程处理验证。
6. 对第 2/3 卷跑起草 + 复核，检查是否复用第 1 卷实体、术语、关系、数值和伏笔。
7. 检查 `reports/work_runs.jsonl` 的 token 与 cache hit/miss，把成本问题归因到清洗、匹配、起草或复核阶段。
8. 根据失败点决定先打磨清洗交互、匹配裁决交互，还是 agent 上下文组织。
