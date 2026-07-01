# 长程制作测试 Phase A 结果（2026-07-01）

本次测试按 `long-range-test.md` 的 Phase A 执行：全局 Accepted 结构化记忆 + 当前卷整卷正文，不加入前卷梗概、不回喂前卷原文。模型配置使用本地 `tools/.workbench-config.json`，报告不记录 API key。

最终工作副本：`/tmp/gt-longrange-4vol-final2`

命令：

```bash
cd tools
npx tsx scripts/long-range-phase-a.ts --run-model --work /tmp/gt-longrange-4vol-final2 --volumes v01,v02,v03,v04 --force
```

生成报告：

- `/tmp/gt-longrange-4vol-final2/reports/long-range-phase-a.md`
- `/tmp/gt-longrange-4vol-final2/reports/long-range-phase-a.json`

## 过程修复

长程压力测试暴露出几类硬校验不一定能发现、但会污染数据的问题，已修复：

- `tools/src/agent/pipeline.ts`：记录模型 `token_usage`；在 `route=auto` 写 Accepted 前做引用兜底校验；缺失或非法引用转 review item，不自动落盘。
- `tools/src/agent/pipeline.ts`：非实体 / 非 metric 的同 ID 不同内容不再自动覆盖，避免后卷 `metric_change` 覆盖前卷历史。
- `tools/src/agent/prompts.ts`：明确 `fact.subject_id`、`metric_change.metric_id`、`term_card.term_entity_id` 等引用规则；要求 `metric_change` ID 带变化或位置。
- `tools/src/agent/agentStore.ts`：Accepted 的 `series_id` 统一由 manifest 写入，不信模型草案；同 ID 实体更新保留最早 `first_seen/source_span`；metric 更新保留首次定义。
- `tools/scripts/long-range-phase-a.ts`：新增四卷批量 runner、每卷 validate/compile、指标汇总和 token 成本统计。

## 结果汇总

| 检查项 | after v01 | after v02 | after v03 | after v04 |
|---|---:|---:|---:|---:|
| Accepted 总数（不含 changes） | 59 | 112 | 169 | 225 |
| Candidates | 61 | 121 | 190 | 258 |
| Review items | 1 | 6 | 16 | 20 |
| duplicate entity names/aliases | 0 | 0 | 0 | 0 |
| validation errors | 0 | 0 | 0 | 0 |
| validation warnings | 2 | 4 | 6 | 6 |
| total tokens | 67,804 | 146,064 | 242,113 | 335,546 |

最终 `validate` / `compile` 均通过。所有 Accepted `series_id` 均为 `gray_tower`。

## 指标判断

实体去重：通过。核心实体均保持单一 ID，且 `first_seen` 未被后卷覆盖：`entity_linche@v01.prologue.b0001`、`entity_xuyingbai@v01.prologue.b0005`、`entity_zhoumi@v01.c01.b0002`、`entity_bai_chuanyao@v01.c01.b0009`。卷 2 正确新增 `entity_qinzhao`、`entity_shadow_grouping`。

数值连续：通过。D 班点数链路进入 `accepted/metric_changes.jsonl`：`null -> 100`、`100 -> 150`、`150 -> 190`、`190 -> 160`、`160 -> 130`、最终 `200`。最终 `200` 的 old_value 未被模型填出，但事实和最终 metric_change 均已记录。

伏笔 / 身份延续：通过。许映白隐藏点数、无入学记录、观察员、创始人后人、观察结束后留下等线索均被识别；其中较早的推断类候选仍会进入 review item，直接揭示后可自动落盘。

长跨度物件：通过。`entity_unmailed_list` 从卷 1 建立，卷 3 与空白档案关联，卷 4 作为公开证据送达。

关系追踪：流程安全但未自动落盘。`relation_change` 候选按高风险规则升级为 review item，因此 `accepted/relation_changes.jsonl` 仍为 0。关系信息部分进入 event/fact，但如果阅读器强依赖 relation_change，需要补批量裁决。

## 结论

Phase A（全局 Accepted 结构化记忆 + 当前卷正文）已经能支撑 4 卷长程制作：实体复用、关键伏笔回收、D 班点数弧线、未寄出的名单长线都能跑通。不加前卷原文也能保持主要跨卷结构。

当前下一步不急着做 Phase B 前卷梗概；更优先的是补 review item 批量裁决 / 批量转 open_question，让高风险关系变化和伏笔推断有一个可审计的半自动收口。
