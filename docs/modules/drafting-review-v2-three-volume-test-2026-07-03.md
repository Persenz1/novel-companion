# 起草/复核 v2 三卷真实全量测试（2026-07-03）

本次测试是 `docs/modules/drafting-review-v2-design.md` §10 待测清单的执行：对真实 COTE（欢迎来到实力至上主义教室）三卷正文跑 entities / knowledge / narrative 三个 pass 的 draft + review，全量、不抽样。目标是验证 v2 分 pass 架构在真实多卷数据上是否稳定、跨卷记忆传递是否有效，并借真实数据暴露 v1 单测覆盖不到的问题。

工作包：

```text
~/nc-workpack/cote-cleaning-panel-recovered-2026-07-02
```

命令（模型配置读 `tools/.workbench-config.json`，不记录 API key）：

```bash
cd tools
npx tsx src/cli.ts draft-pass  "$BOOKPACK" v01 entities
npx tsx src/cli.ts review-pass "$BOOKPACK" v01 entities
# ……knowledge / narrative 同样顺序，v02 / v03 重复
npx tsx src/cli.ts validate "$BOOKPACK"
npx tsx src/cli.ts compile  "$BOOKPACK"
```

## speakers pass：中途放弃

四个设计 pass 里的 speakers（说话人标注）在 v01 实跑后放弃，未对 v02/v03 执行：

- v01 draft 跑满 22 窗，覆盖率只有 **81.3%**（2154 个 dialogue 块中 402 个 3 轮补跑后仍无判定），比 `drafting-review-v2-design.md` 此前记录的「76→9」改善样本更差——说明「整章放弃」模式不是靠 3 轮补跑就能稳定收敛的。
- token 成本对比悬殊：v01 单卷 speakers 消耗 prompt 6,656,894 + completion 345,334 tokens，比同卷 entities+knowledge+narrative 三个 pass 加起来还多（836,064+2,626,160+2,191,244 prompt tokens）。
- 用户按性价比/实用性判断放弃该功能。已产出的 1479 条候选、242 条 accepted change、11 条 review item 全部用 `AgentStore.revertWorkRun` + 手动清理 `candidates.jsonl`/`review_items.jsonl` 回滚干净（详细步骤见下方「回滚记录」）。
- `prompts.ts`/`pipeline.ts` 里的 speakers pass 代码原样保留，未删除，供以后重新评估。

## 过程修复

三卷全量真实数据暴露了 6 个 v1 单测和小样本实跑都没触发的真实 bug，全部在 `tools/src/agent/` 下：

1. **entities pass 系统性空跑（`prompts.ts`）**：候选信封要求最外层 `"type"` 是字面量 `"entity"`（供 `runDraftPass` 的 `allowedTypes` 过滤），但 instruction 没有把这一点和 `draft.type`（细分类别 character/organization/…）的区别讲清楚，模型统一把细分类别填进了最外层 `type`。表现：v01 首次在**完全空白记忆**上跑 entities（此前所有实跑都是在已有名册基础上增量跑，天然掩盖了这个 bug），`created=0`、`bad_lines=1`，但直接调模型验证能看到内容其实是对的、只是信封字段填错位置。加了一句明确约束后重跑，55 条全部正确产出。
2. **实体 id 偶发带空格（`prompts.ts`）**：55 条里 10 条 id 是 `entity_horikit suzune` 这种空格分隔而非下划线（罗马音人名多词未正确 slugify）。加了显式格式约束（小写字母/数字/下划线，禁止空格），并手工回填了已落盘的 10 条。
3. **`ACCEPTED_POSITION_INVALID`：visible_from/source_span 缺失或幻觉（`pipeline.ts` `backfillPositionFields`）**：draft schema 里 `visible_from`/`source_span` 与候选信封的同名字段是重复设计——信封那份在起草时已经过 `makeRefNormalizer` 校验（缺失或非法引用会回退到窗口边界，保证合法），但 `draft` 内部那份是模型自由输出、完全未经校验。v01 首次全量 validate 时炸出 120 条（facts 86、events 21、metrics 10、term_cards 3）缺失记录，且部分不仅缺失还引用了**超出章节实际长度**的幻觉 block id（如引用 `v02.c17.b0662`，该章实际只到 `b0521`，差 140+）。修复：写入前用信封值**无条件覆盖** draft 同名字段（不只是补缺）。已落盘的 120+6 条记录通过「Change → candidate_id → 候选信封」链路回填修正，未丢失任何实际证据。
4. **`edited_draft` 偶尔是 JSON 字符串而非对象（`pipeline.ts` `asDraftRec`）**：复核模型（deepseek-v4-pro）在给出修正草案时，偶尔把 `edited_draft` 输出成一整个 JSON 字符串而不是嵌套对象（schema 漂移）。v02 entities 复核在处理到第 4 条时因此崩溃：`Cannot create property 'visible_from' on string '...'"`。加了 `asDraftRec` helper：优先按对象处理，是字符串则尝试 `JSON.parse` 挽救，都不行才判定为无效草案（走「缺少 id」升级路径，而不是直接抛异常）。
5. **`metric_change` 数值字段带引号（`pipeline.ts` `coerceMetricChangeNumbers`）**：`old_value`/`new_value`/`delta` 应为 `number`，v02 有一条被模型输出成字符串 `"0"`/`"87"`/`"87"`，validate 报 `METRIC_CHANGE_VALUE_TYPE`。加了数值型字符串的强制转换。
6. **fact 的 `valid_from`/`valid_until` 幻觉 block id（`pipeline.ts` `backfillPositionFields`）**：与第 3 点同类但不能同样处理——`valid_from` 语义独立于 `visible_from`（231 条 fact 里 15 条两者合理不同，都在同章节内且是有效 block，不能被无条件覆盖抹掉）。改为：只在能拿到卷内合法 block id 集合时才校验，非法引用（如 v03 一批引用了超出章节 300+ 的幻觉 id）才替换为 `visible_from`；合法的独立值原样保留。v02/v03 合计 7 条被此规则命中修正。

另外补上了一个已知工程缺口：

7. **draft-pass resume-skip（`pipeline.ts` `runDraftPass`）**：`drafting-review-v2-design.md` §10 早就记录「重跑同一 pass 不会自动跳过已完成窗口，会重复产候选」。本轮实测连续两次真中断（v01 speakers 阶段 DeepSeek 官方 503；v03 knowledge 阶段用户本地网络中断）都撞上了这个缺口。修复：`runDraftPass` 起跑前读 `work_runs.jsonl`，跳过同 volume/pass/stage=draft 已有 `status:"completed"` 记录的窗口，只续跑真正未完成的窗口，不再需要人工清理旧候选。v03 knowledge 中断后用这个机制续跑，窗口 1 的 31 条候选正确跳过、未重复。

## 结果汇总

| 检查项 | v01 | v02 | v03 | 合计 |
|---|---:|---:|---:|---:|
| Candidates | 322 | 275 | 286 | 883 |
| 自动 Accepted | 262 | 200 | 195 | 657\* |
| 升级为 review item | 47 | 64 | 81 | 192 |
| 复核拒绝 | 13 | 11 | 10 | 34 |
| relation_change 自动落盘 | 0 | 0 | 0 | 0 |
| 缓存命中率（entities/knowledge/narrative，不含 speakers） | 96–98% | 50–98%\*\* | 0–98%\*\* | 均值 95.9% |
| validate errors（最终） | 0 | 0 | 0 | 0 |

\* 与最终 `accepted/*.jsonl` 646 条（entities 83、facts 349、events 173、metrics 31、metric_changes 4、term_cards 6）的差额来自极少数同 id 更新（如实体别名合并）未产生新记录，属预期。
\*\* entities pass 只有 1-5 次调用，冷启动（首调 0% 命中）在小样本里对均值影响更明显；knowledge/narrative 稳定命中 97–98%，与设计文档记录的 99.5%+ 量级一致。

relation_change 候选全部被代码级强制升级（`forcedEscalation`），三卷合计 66 条全部进入 review item，0 条自动落盘，符合设计——高风险类别不依赖模型自觉，必须人审。

## 指标判断

**跨卷记忆传递：通过。** v01 建立 55 实体名册；v02 在此基础上正确复用全部 55 个（无重复注册），新增 12 个（如 `entity_sakura_airi`、`entity_ryuuen_kakeru`），累计 68；v03 同样复用 68、新增 8（如新地点/新配角），最终 75（另有约 8 个通过 knowledge/narrative pass 的「临时实体」机制补充注册，最终 83）。已确认名册在 `【已确认记忆】` prompt 前缀里正确生效——"已在名册中的实体不要重复输出" 指令没有产生误判性重复。

**密度不随章节数衰减：通过。** knowledge pass 三卷分别 14/15/15 窗、created 169/162/191，narrative 三卷 14/15/14 窗、created 98/101/87，长短卷密度基本持平，延续了 v01 早前小样本验证的结论。

**强制升级：通过。** relation_change 三卷合计 66 条 100% 升级，无一条绕过人审自动落盘。

**复核有真实判断力：通过。** 三卷 auto/escalate/reject 三态都有真实分布（不是全 auto 或全 reject），knowledge/narrative 复核触发过因数值/引用不合法的 reject，也触发过因伏笔/身份不确定的 escalate。

**validate/compile：最终通过，过程中暴露的问题已如实记录，不是"一次性蒙对"。** 三卷合计经历 2 次真实中断（均已按 work_run 记录妥善续跑，0 数据丢失）、120+7 条位置字段被回填修正、1 次复核阶段崩溃。这些问题都被诊断到具体成因并在代码层修复，不是靠手工掩盖症状。

## 结论

起草/复核 v2 的分 pass + 稳定前缀缓存架构，在真实三卷、883 个候选、192 个待裁决 review item 的规模下跑通，validate/compile 全绿。speakers pass 因覆盖率和成本都不理想被放弃；其余三个 pass（entities/knowledge/narrative）加上本轮修的 6 个数据完整性 bug 和 1 个 resume-skip 缺口后，可以认为进入了可重复使用的稳定状态。

下一步不是继续测起草/复核，而是：192 条 review item 的人工裁决（这是本轮唯一还没做的环节）、阅读器制作侧 UI（角色卡/时间线）、以及用本轮 work_runs 的真实 token_usage 做一次 DeepSeek 官网控制台对账。详见 `docs/modules/next-session-cleaning-and-multivolume.md`。
