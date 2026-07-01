# 模块：长程制作测试（跨卷上下文）

> 这份文档是留给接手者（codex）的**测试执行手册**。目标不是让阅读器更好看，而是回答一个工程问题：
> **当 agent 处理完第一卷、再喂第二卷时，它能不能把握前文脉络？要提供多少前文信息才够？**
>
> 当前结论：Phase A 已在 `v01`-`v04` 四卷完整跑通，结果见 [long-range-test-phase-a-2026-07-01](long-range-test-phase-a-2026-07-01.md)。下面仍保留为复跑手册和 Phase B 设计入口。

## 1. 精确问题

灰塔学院测试卷现在有 4 卷（`samples/gray-tower`，见 [test-fixture](test-fixture.md)）。卷与卷之间**刻意埋了跨卷依赖**（见 §4）。测试要量化：

- **实体去重**：起草 vol2 时，agent 是否复用 vol1 已确认实体的 ID（`entity_linche` 等），而不是重造一个 `entity_linche_2` 或同名不同 ID 的重复实体。
- **伏笔 / 身份延续**：vol1 埋的「许映白隐藏点数」「她不是普通学生」，agent 在 vol2 是否仍能识别为异常并升级（而非当成新信息平铺）。
- **数值连续**：D 班点数 vol1 收在 150，vol2 应演变到 190。agent 产出的 `metric_change` 是否与 vol1 已确认数值衔接。
- **成本 / 信息量权衡**：达到上面这些，最少要喂多少前文？只喂已确认结构化数据够不够，还是要加梗概、甚至回喂前卷原文。

## 2. 当前上下文机制（已实现，先读懂再测）

看 `tools/src/agent/pipeline.ts` 的 `runDraft` / `runReview`：

- 目标：**按章**（`chapter_id`）。
- 背景正文：`volumeSections(data, volumeForChapter(...))` —— 只喂**目标章所属那一卷**的整卷正文。所以起草 vol2 某章时，**vol1 的原文不在上下文里**。
- 已确认数据：`data.accepted()` —— 读**整个 bookpack** 的 `accepted/*.jsonl`，不按卷过滤。所以 **vol1 的已确认实体 / 事实 / 数值，在起草 vol2 时本来就会进上下文**。

**推论（重要）**：当前实现天然就是「结构化记忆（全局 accepted）＋ 当前卷原文」这一档。也就是说：

> **基线实验（下面 Phase A）不需要写任何新功能**，直接用现有 pipeline 跑 vol1→vol4 就是「只喂已确认结构化记忆」这一档。梗概 / 回喂原文是增强档（Phase B）。

已新增 `tools/scripts/long-range-phase-a.ts` 做批量复跑与报告。尚未实现、需要 Phase B 补的：卷 / 章级 AI 梗概、token 预算器、可选 RAG 检索。`work_runs.context_estimate` 现在只记 block 数，不是 token 预算；真实模型调用的 `token_usage` 已写入 `reports/work_runs.jsonl` 并由 Phase A 脚本汇总。

## 3. 环境与配置

```bash
cd tools
npm install                 # Node >= 20
```

**模型配置**在 `tools/.workbench-config.json`（已 gitignore，**不要提交**）。形状：

```json
{
  "bookpack_dir": "<绝对路径>/samples/gray-tower",
  "drafter":  { "base_url": "https://api.deepseek.com/v1", "api_key": "<KEY>", "model": "deepseek-chat" },
  "reviewer": { "base_url": "https://api.deepseek.com/v1", "api_key": "<KEY>", "model": "deepseek-reasoner" }
}
```

- 采用 OpenAI 通用协议（`/chat/completions`），DeepSeek 直接可用。
- 起草与复核**必须用不同模型**（双 AI 制衡）。这里 drafter=`deepseek-chat`、reviewer=`deepseek-reasoner`。
- 本机可能已有一份配了 key 的该文件；若没有或换 key，按上面形状填。**key 只留本地，别写进任何提交文件（包括本文档）。**

## 4. 语料里埋的跨卷线索（测试靶点）

| 线索 | 埋设（vol1/vol2） | 回收 | 测什么 |
|---|---|---|---|
| 许映白隐藏身份 | 卷1 隐藏点数 → 卷2「有些人从一开始就不是真正的学生」 | 卷3 揭底：创始人后人 / 观察员 | 跨卷伏笔识别、隐藏身份升级 |
| 沈砚「未寄出的名单」 | 卷1 神秘纸条 | 卷3 创始章程、卷4 作为证据送达 | 长跨度实体 / 物品连续性 |
| D 班点数弧线 | 100(卷1)→150→190(卷2)→160(卷3)→130→**200透明**(卷4) | 全程 | 数值连续、`metric_change` 一致 |
| 林澈–许映白关系 | 陌生 → 谨慎合作(卷2) → 裂痕(卷3) → 真正结盟(卷3末) | 全程 | `relation_change` 追踪 |
| 全员复用 | 林澈 / 许映白 / 周弥 / 白川遥 / 沈砚 / 秦昭(卷2起) | 全程 | **实体去重**（复用 ID 不重造） |

卷 1→2 这一跳能直接测的：**实体去重**、**D 班点数 150→190 连续**、**林澈–许映白 relation_change 谨慎合作**、**许映白异常是否被升级**。伏笔的最终回收在卷 3，做完 1→2 后可继续 2→3 复用同一套脚本。

## 5. 运行步骤

### 通则：在工作副本上跑，别脏化提交态样例

提交态 `samples/gray-tower` 必须保持 accepted / candidates / review / work_runs 为空基线（见 [status](../status.md)）。所以：

```bash
# 从仓库根目录
WORK=/tmp/gt-longrange
rm -rf "$WORK" && cp -r samples/gray-tower "$WORK"
# 把 .workbench-config.json 的 bookpack_dir 指到 $WORK，或直接用 CLI 传 $WORK
```

跑 agent 的三种方式，任选：

- **Phase A 脚本（推荐复跑整轮）**：
  `cd tools && npx tsx scripts/long-range-phase-a.ts --run-model --work /tmp/gt-longrange-4vol --volumes v01,v02,v03,v04 --force`
  脚本会复制提交态样例包到 `$WORK`、逐章 draft/review、每卷后 validate+compile，并写 `reports/long-range-phase-a.{md,json}`。

- **HTTP（和界面同一条路径）**：`cd tools && npm run workbench`，然后
  `curl -X POST localhost:4173/api/draft  -H 'content-type: application/json' -d '{"chapter_id":"v01.prologue"}'`
  `curl -X POST localhost:4173/api/review -H 'content-type: application/json' -d '{"chapter_id":"v01.prologue"}'`
  （注意：HTTP 用的是配置文件里的 `bookpack_dir`，跑前把它指向 `$WORK`。）
- **直接调 pipeline**：写个 tsx 脚本 `import { runDraft, runReview } from "./src/agent/pipeline.js"`，对 `new FileStore("$WORK")` 循环各章。更适合批量与打点。

### Phase A：基线（只喂全局 accepted，无需新代码）

1. 顺序处理每卷全部章节（每章先 draft 再 review）。
2. 每卷结束跑 `npx tsx src/cli.ts validate "$WORK" && npx tsx src/cli.ts compile "$WORK"`。
3. 记录每卷结束态：accepted / candidates / review item 数、核心实体 ID、D 班点数最新值、许映白相关项、累计 token。
4. 按 §6 计算指标。这一档就是「只喂已确认结构化记忆」的答案。

2026-07-01 已完成一次 DeepSeek `v01`-`v04` 实跑：每卷 validate + compile 通过，最终 accepted=225、candidates=258、review_items=20，核心实体无重复；D 班点数主弧线跑通。详见结果文档。

### Phase B：增强档对比（要写代码）

目标：在 Phase A 之上加前文信息，看指标能提升多少、成本涨多少。Phase A 结果显示 gray-tower 主线暂不急需 Phase B；下一步更优先的是 review item 批量裁决 / 批量转 OpenQuestion。等需要真实书籍或质量 / 成本对照时，再做成**可插拔的上下文档位**，三档扫一遍：

- **L0＝Phase A**：现状（全局 accepted）。
- **L1**：L0 ＋ **前卷梗概**。新增：一个「梗概生成」步骤（对 vol1 逐卷/逐章用起草模型生成 recap，本身走复核落盘存成 artifact，例如 `reports/synopsis.jsonl`），起草 vol2 时把 vol1 梗概拼进 user prompt。
- **L2**：L1 ＋ **回喂 vol1 原文**（或其压缩），作为成本上限对照。

配套要补的模块（作者建议的落点）：

- `tools/src/agent/priorContext.ts`：前文上下文组装器。分层拼装：实体名册（所有 accepted 实体的 id/名/别名/类型/重要度＋最新角色卡一句话）→ 世界状态快照（最新 fact / relation_change / 最新数值）→ 未决伏笔（open_questions ＋ 隐藏身份标记）→ 卷·章梗概。
- token 预算器：给定上限，按优先级（名册 > 目标章原文 > 近章梗概 > 世界快照 > 远章梗概）裁剪，替换 `work_runs.context_estimate` 现在的 block 计数。
- `Retriever` 接口（RAG 留成**未来可选项**，先给个默认实现：按名字/别名字符串匹配 ＋ 重要度排序召回相关前文条目；embedding 版留空实现，接口先占位）。
- 把 `buildDrafterUser` / `buildReviewerUser`（`tools/src/agent/prompts.ts`）改成接受组装好的 priorContext 段。

Phase B 属于**新功能**，可以改 `agent/*` 和 prompts；但不要动 parser / validator / compiler / query 的对外语义，也不要把生成数据提交进样例包。

## 6. 指标与判定

跑完后对 `$WORK` 的 `accepted/*.jsonl` + `candidates/candidates.jsonl` 做统计：

1. **实体去重率**：vol2 处理后，`accepted/entities.jsonl` 里 vol1 的 6 个核心实体（林澈/灰塔学院/班级点数制度/许映白/周弥/白川遥）应各只有 1 条，ID 不变；vol2 只新增 `秦昭`、`影子分组` 等新实体。判定：**同名实体是否出现多个不同 ID**（这是最关键的失败模式）。
2. **数值连续**：找 D 班点数的 `metric` / `metric_change`。vol1 应留下 150；vol2 应产出承接 150→190 的变化；vol3 / vol4 应继续到 160→130→200，而不是从 0/100 重新开始。
3. **关系追踪**：应出现或升级林澈–许映白关系变化（陌生→谨慎合作→裂痕→结盟）。Phase A 中 `relation_change` 因高风险路由保持在 review item，流程安全但需要批量裁决补收口。
4. **伏笔升级**：许映白在 vol2「掌握非公开数据 / 不是真正学生」，理想情况复核把它升级成 `review/review_items.jsonl` 里的 open 项或 open_question，而不是静默 auto 落盘。
5. **成本**：累计模型调用次数与 token（`chat()` 返回的 `usage`；可在 pipeline 打点）。L0/L1/L2 各记一份，做质量–成本曲线。

产出一份对照表（L0/L1/L2 × 上面 1–5），就是「要喂多少前文才够」的答案。当前已有 L0/Phase A 结果，尚未做 L1/L2。

## 7. 历史试跑观察（预期对照）

早期作者只跑了 vol1 的 `prologue` 和 `c01`（然后回滚了数据），观察到：

- 起草（deepseek-chat）产出结构规整：实体用**语义稳定 ID**（`entity_linche`、`entity_xuyingbai`），类型 / `first_seen` 正确。
- **章内去重成立**：c01 只为新人物（周弥、白川遥）建实体，事实 / 说话人**复用**了 accepted 里的 `entity_linche` / `entity_xuyingbai`，没有重造。
- 复核（deepseek-reasoner）把干净低风险项全部 auto 落盘，0 升级。
- 一个**待观察的风险**：c01 重新抽了一次「班级点数制度」，但用了**相同 ID**，AgentStore 按 id upsert，所以没产生重复。**但复核并没有展示出「同名不同 ID → 合并」的甄别**——如果起草对同一概念换了 ID，当前流程不一定拦得住。跨卷时这个风险更大，指标 §6.1 要重点盯。
- 防剧透闭环 OK：validate+compile 后阅读器右栏按 `read_boundary` 出实体，越界隐藏未读实体。

最终 Phase A 四卷实跑已验证：实体去重成立，数值主弧线成立，伏笔能在卷 3 回收；关系变化主要被安全升级到 review item。后续重点不是证明 L0 能不能跑，而是补 review item 的批量裁决入口。

## 8. 注意事项

- **别提交试跑数据**：所有 agent 产出都在 `$WORK`，不要 `git add` 进 `samples/gray-tower`。提交态样例包 accepted 恒为空基线。
- **别提交 key**：`tools/.workbench-config.json` 已 gitignore；本文档、脚本里都不要出现明文 key。
- **额度**：整轮 v01-v04 约二十多章 × 起草+复核；DeepSeek 最终实跑累计约 335k tokens。先复核 Phase A 结果和 review items，再决定是否做 Phase B 三档扫。
- 界面：`npm run workbench` 现在同时提供工作台（`/`）和阅读器（`/reader/`），共用同一份配置，方便边跑边看落盘效果。
