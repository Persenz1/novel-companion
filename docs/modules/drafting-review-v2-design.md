# 模块：起草 / 复核 v2（分 pass 抽取 + 稳定前缀缓存）

状态：已实现（含无模型单测 10 例），2026-07-03 用 DeepSeek 对 v01/v02/v03 三卷 entities/knowledge/narrative 全量实跑验证通过（详见 §10 实测进展）。speakers pass 代码保留但已放弃使用（覆盖率实测不理想 + 用户性价比判断）。取代旧的「每章一次调用、全类型混抽、最多 15 条」起草复核形态。

## 1. 为什么重构：v1 的三个结构性缺陷（有实测数据）

对真实 COTE 三卷（`~/nc-workpack/cote-bilingual-v1`，12296 blocks）的 v1 实跑账本分析：

**缺陷 1：输出预算绑在「章」上，抽取密度跟章节数走，不跟文本量走。**
三卷块数几乎相同（4223/4142/3931），正文章节数 12/7/7，候选产出 157/99/82——产出严格随调用次数（=章节数）衰减。长章饿死：v02.c15 有 1406 块只产出 16 条（88 块 1 条），v01.c13 586 块产出 25 条（23 块 1 条），同书内密度差 4 倍。

**缺陷 2：全类型混抽一个 JSON，15 个坑位互相排挤。**
work_runs 显示大量调用 completion_tokens 顶到 7.3k-7.7k（上限 8192），模型被「最多 15 条」压住；prompt 又让实体/事件优先、明示「不要逐句标注 speaker_label」。结果：6143 个对话块只有 1 条说话人，relation_change 为 0。说话人和关系是制度性出局，不是模型抽不出来。

**缺陷 3：变化内容在 prompt 最前，前缀缓存全废。**
v1 的 user 消息第一行是 `本次目标章节：${title}`，整卷正文跟在后面。前缀缓存按前缀匹配，第一行就变 → 每章 5-9 万 token 的整卷正文全价重算。这是缓存命中率过低的直接原因，也是当初不敢多调用、被迫全类型混抽的经济根源。三个缺陷一根绳。

## 2. 设计原则

1. **两种任务形状分开**：稀疏抽取（实体/事件/事实/关系，全文低密度、需全局视野、输出少）与密集标注（说话人，逐对话块判定、输出与文本量线性、覆盖率可机械度量）不能共用一个调用形状。
2. **输出预算与文本量线性**：按 block 窗口切输出，不按章。窗口对齐场景分隔符（separator）与章节边界。
3. **稳定前缀最大化**：同卷所有调用共享「系统提示 + 整卷正文 + 已确认记忆」大前缀，变化部分（本次窗口 + 本 pass 指令）放最后。多 pass 的成本由缓存命中支付。
4. **一次喂一卷**：即使 1M 上下文也不跨卷喂原文——正文只喂当前卷，保证注意力密度与可控性。跨卷连续性靠「已确认记忆摘要」传递（比 v1 只传实体名册放宽：带事实/事件/关系/数值的压缩摘要），兼顾连续性与准确性。
5. **输出协议容截断**：JSONL（一行一条候选），截断只丢最后一行；`finish_reason=length` 时自动续写。废除「最多 15 条」全局上限，改为窗口自然限量。
6. **复核同构**：复核复用同一前缀布局，按 pass 分 checklist；高风险类别（关系变化、歧义说话人等）代码级强制升级，不依赖模型自觉。

## 3. Prompt 布局（缓存友好）

```text
system（所有 pass 共用一份，短且不变）:
  通用角色说明；真正的任务指令在用户消息末尾【本次任务】。

user:
  【全卷正文】          ← 巨大、卷内所有调用完全一致（缓存主体）
    [block_id | kind] 正文…（含章节标题行）
  【已确认记忆】        ← 跨卷记忆摘要 + 实体名册；pass 内冻结
  【本次任务】          ← 唯一变化区：pass 指令 + 类型 schema + 窗口范围 + 输出格式
```

关键点：
- 窗口只传 **block id 范围**（如 `v01.c13.b0042 → v01.c14.b0074`），不重复正文——正文在前缀里，模型按 id 定位。变化区非常小。
- 【已确认记忆】在 pass 之间可以更新（如实体 pass 裁决后名册冻结），pass 内部保持不变，保证 pass 内所有窗口调用命中同一前缀。
- 起草与复核模型不同（缓存本就不互通），但各自卷内多次调用充分命中。

## 4. 起草：4 个 pass（按依赖排序）

| pass | 类型 | 窗口 | 说明 |
|---|---|---|---|
| 1 `entities` | entity | 整卷 1 窗 | 建名册。输出量小；产出经复核+人工合并裁决后**冻结**，供后续 pass 引用 |
| 2 `knowledge` | fact / metric / metric_change / term_card | ~250 块/窗 | 引用冻结名册；数值链（metric→metric_change）同窗给出 |
| 3 `narrative` | event / relation_change | ~250 块/窗 | 可引用名册与已确认事件；relation_change 复核必升级 |
| 4 `speakers` | speaker_label | ~80 对话块/窗 | 密集标注，**全覆盖契约**（见 §5） |

- pass 2-4 遇到名册外新人物：输出 provisional entity 候选（进异常队列），不得直接引用未注册 id。
- 窗口切分：顺序累积 block，达到目标量的 80% 后遇 separator 或章节边界即切；硬上限 140%。
- 每窗给出**密度指引**而非上限：「本窗口约 N 块，预计产出 X~Y 条；有依据就抽，不设条数上限」。

## 5. 说话人 pass：密集标注协议

- 目标：对话块逐块判定，供阅读器逐句显示说话人。
- **全覆盖契约**：窗口内每个 `dialogue` 块必须输出一行判定（`entity` / `narrator` / `group` / `system` / `unknown` / `ambiguous`）。覆盖率 = 输出块数 / 窗口对话块数，机械校验；缺块自动补跑（只列缺失 id），**最多 3 轮、某轮无进展即止**；仍缺则记入 work_run 覆盖缺口。实跑教训：单轮补跑不够——模型可能整段放弃一个章节（某窗 92 块缺 76 块全在同一章），改多轮后同窗缺失降到个位数。
- `unknown` 判定用于满足覆盖，但**不生成候选**（无信息量，不进 accepted）。`ambiguous` 生成候选并由复核升级人裁决。
- **防剧透**：display_name 必须用「该位置正文已揭示的称呼」（名字未揭示前用"红发学生"这类正文称呼），visible_from = 该对话块本身。
- 输出为紧凑 JSONL 行：`{"block_id":"...","speaker_type":"entity","speaker_entity_id":"entity_xxx","display_name":"...","confidence":0.9}`。

## 6. 输出协议与截断恢复

- 所有 pass 输出 JSONL：一行一个 JSON 对象，无外层数组/对象包裹。
- 解析器逐行 parse，坏行（多为截断尾行）丢弃并计数。
- `finish_reason == "length"` 时：把已收到文本作为 assistant 消息回喂，追加「继续输出剩余行，不要重复」，最多续 2 轮（前缀缓存使续写便宜）。
- block 引用修复保留 v1 机制并升级为卷级：短 id（`b0058`）在窗口章节内唯一可展开则展开，否则回退窗口起点。
- **逐窗增量落盘**：起草每完成一窗、复核每完成一批立即写盘（候选 / accepted / change / work_run），不等整个 pass 结束。某窗调用失败时写 `status:"failed"` 的 work_run 并立即报错「第 N/M 窗失败：…（此前 N-1 窗已落盘，无需重跑）」。实跑教训：DeepSeek 一次 503 曾让整 pass 31 分钟成果全丢；改增量落盘后再遇 503 只损失当前窗。已知缺口：重跑同一 pass **不会**自动跳过已完成窗口（无 resume-skip），会重复产候选，续跑前需先清理或补跳过逻辑（见 §10 待办）。

## 7. 复核：按 pass 分 checklist，同一前缀

复核输入 = 同一【全卷正文】前缀 + 该 pass 的待复核候选批（稀疏类 ~25 条/批，说话人 ~60 条/批）。输出 JSONL 决定行：`{"candidate_id","route","reason","recommended_action","edited_draft"}`。

各 pass 专用 checklist：
- `entities`：查重（与名册/本批疑似同一实体 → 升级合并）、依据核对。
- `knowledge`：数值/事实逐点回文核对；引用合法性（沿用 autoAcceptBlockers 机械校验）。
- `narrative`：事件摘要逐点落定；**relation_change 代码级强制升级**（即使模型给 auto 也降级 escalate）。
- `speakers`：抽查归因是否与叙述线索一致；清晰归因 → auto；`ambiguous`/多候选/拿不准 → 升级；错误 → reject。**不再一刀切升级说话人**，只升级歧义项。

自动落盘仍走 AgentStore.write（带 Change、可回滚），机械校验（autoAcceptBlockers）不变。

## 8. 跨卷记忆（放宽的传递）

v1 只传实体名册。v2 的【已确认记忆】按类型压缩传递（1M 上下文允许放宽，但仍摘要化保准确）：
- 实体：id + 名 + 别名 + 类型（全量）。
- 事实：每 subject+predicate 取最新一条（valid_until=null 的现行事实）。
- 事件：importance 为 critical/major 的 title+summary。
- 关系：每实体对最新状态（最后一条 relation_change 的 after）。
- 数值：每 metric 最新值。
- 术语卡：title 列表。

## 9. 兼容与迁移

- 旧的每章 `runDraft`/`runReview` 与 `DRAFTER_SYSTEM`/`REVIEWER_SYSTEM` 删除，`/api/draft`、`/api/review` 改收 `{volume_id, pass}`；工作台 UI 起草/复核按钮改为「当前卷 + pass 选择」。
- CLI 新增 `draft-pass <bookpack> <volume> <pass>` 与 `review-pass <bookpack> <volume> <pass>`，便于脚本化跑便宜模型测试。
- 候选/Accepted/Change/异常队列/裁决/回滚的数据格式不变；候选新增 `pass` 字段。
- work_runs 记录 pass、窗口数、覆盖率、token_usage（含缓存命中率，验证前缀设计是否生效）。

## 10. 验证计划与实测进展

计划三层：① 无模型单测（窗口切分 / JSONL 容截断 / 覆盖率计算）；② 真实模型实跑一卷四 pass；③ 与 v1 同卷产出对比。

### 实测进展（2026-07-02，DeepSeek，v01）

① 单测 10 例全过（`tools/src/agent/passes.test.ts`）。② 实跑至 speakers 中段时 DeepSeek 服务故障（503，官方级故障）中断；**当日全部 v2 测试产出已从数据包回滚**，数据包回到测试前基线（v1 accepted 283 + 清洗修复），明日重跑从干净状态开始。中断前已验证的结论（记录自当日 work_runs，回滚不影响结论成立）：

- **缓存命中**：卷内第 2 次调用起 `prompt_cache_hit_ratio` 稳定 99.5%+（首调冷启动 0%），DeepSeek 控制台侧也观察到明显命中提升。稳定前缀设计成立，v1 的全价重算问题消除。
- **密度**：knowledge 14 窗产出 147 条、narrative 14 窗 95 条，长短章密度持平，远超 v1 章绑定形态；entities 在已有名册（v1 accepted 53 实体）之上跑出 0 新增候选，符合「名册已建则不重复注册」预期。
- **强制升级**：narrative 复核 28 条升级（含全部 relation_change），代码级强制升级生效；knowledge 复核 147 条中 124 auto / 18 reject / 5 升级，复核有真实判断力（回文核对、引用合法性均触发过 reject）。
- **speakers 全覆盖契约**：首轮单次补跑只到 85.7% 覆盖，暴露「整章放弃」模式 → 改 3 轮补跑后同窗缺失从 76 降到 9；增量落盘在第二次 503 时正确止损（12 秒失败、0 窗损失，对照修复前 31 分钟全丢）。

### 待测清单（服务恢复后执行）

1. ~~v01 四 pass 全量重跑~~ → 已完成，见下方「2026-07-03 全三卷实测」，但四 pass 收窄为三 pass（speakers 已放弃，见下）。
2. ~~speakers 完整 22 窗 + 覆盖率终值~~ → 已放弃。22 窗实测覆盖率 81.3%（402/2154 缺，3 轮补跑后仍缺，比本文档此前记录的更差），用户判断性价比/实用性不划算，功能整体放弃，产出已回滚清除。
3. ~~v01 整体评估~~ → 已完成，见下方。
4. ~~v02、v03 各三 pass draft + review~~ → 已完成，见下方，跨卷记忆传递验证有效（v01 55 实体 → v02 复用 55+新增 12 → v03 复用 67+新增 8，无重复注册）。
5. ~~工程补强：pass 级 resume-skip~~ → 已实现（`pipeline.ts` `runDraftPass`：重跑跳过已有 `completed` work_run 的窗口）。本轮连续两次中断（DeepSeek 503、用户网络问题）都靠这个機制干净续跑，没有产生重复候选。
6. （更远期，用户已排序）起草复核修稳后，扩多本不同 EPUB 验证清洗层通用性。

### 实测进展（2026-07-03，DeepSeek，三卷全量）

v01/v02/v03 三卷 entities/knowledge/narrative（speakers 放弃，见上）draft+review 全部真实跑完，全包 validate+compile passed。过程中额外发现并修复 6 个真实 bug（entities 信封 type 冲突、实体 id 空格、visible_from/source_span 幻觉与重复字段、`edited_draft` 字符串化崩溃、metric_change 数值字符串化、fact.valid_from 幻觉），详见 `docs/modules/next-session-cleaning-and-multivolume.md` 的收口记录。缓存命中率均值 95.9%（含冷启动），与 §10 此前记录的 99.5%+ 稳定命中一致（冷启动拉低均值属预期）。relation_change 全部强制升级，0 自动落盘，符合设计。最终三卷 accepted：entities 83、facts 349、events 173、metrics 31、metric_changes 4、term_cards 6；review item 待人工裁决 192 条。
