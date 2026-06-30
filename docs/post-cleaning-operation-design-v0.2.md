# 清洗后文本操作设计 v0.2（AI 驱动 + AI 复核）

状态：现行设计。本文取代 2026-06-30 回滚的「逐候选卡片式工作台」方案，作为阶段 5-8 清洗后数据操作的操作逻辑定案，供后续实施规格和提示词对齐。

相关历史：
- `docs/phase-5-8-operation-redesign-note.md`：记录旧方案回滚与待讨论问题（本文是其结论）。
- `docs/discussion-archive-2026-06-30.md` §15：旧方案回滚记录。
- `docs/agent-operation-spec-v0.1.md`、`docs/workflow-spec-v0.1.md`：职责边界与数据流仍有效，但其中「逐候选复核」相关章节由本文取代。

## 1. 这次重构改了什么

旧方案的失败不是信息不够，而是**把人放在了错误的决策层级**：AI 生成大量候选，人逐条 接受/拒绝/转未决。真实长篇 block 数以千计，候选数以万计，制作沦为逐条点击。

v0.2 的核心转变：

> **AI 全程驱动制作，独立 AI 复核后自动落盘；人的角色从「逐条确认写入」上移到「事后审计 + 异常裁决」。**

人不再是每次写入的闸门，而是审计员和高风险裁决者。AI 不再只是「第一起草者」，而是「起草者 + 复核者」的双角色流水线。

### 1.1 被本次修订的旧硬边界

旧文档（`agent-operation-spec-v0.1.md` §2、`workflow-spec-v0.1.md`、`project-prompts-v0.1.md` 通用提示词）规定：

> 「AI 不能绕过人工确认写 Accepted。」

本文**有意识地修订**这条边界为：

> AI 经独立复核后**可以自动写 Accepted**，但每次写入必须是可追溯、可回滚的 Change；AI 必须把一组规定的高风险类别升级给人。

这是项目主人的明确决定，理由：对绝大多数「正文直述型」数据，AI 抽取的准确度高于人工逐条点击的边际价值；把人留在闸门位置只会拖慢制作而不提升质量。

### 1.2 仍然保留的硬边界（不可妥协）

- **可追溯**：每个 Accepted 对象都来自一条 Change，能回到中文正文 block（图片主体经 asset anchor 回到正文位置）。
- **可回滚**：任何自动写入都能按对象、按 Change、按 work_run 整批撤销。AI 会错，所以自动写入的前提是撤销成本足够低。
- **防剧透按既有机制轻量保留**：`visible_from` / `read_boundary` 字段照常生成，但不作为自动化的主要关卡。分卷逐本录入已天然把剧透风险限制在本卷范围内，不对每条草案做严格剧透闸门（见 §5）。
- **中文正文是唯一主轴**，日文只作参考。
- **第一阶段仍用 JSON/JSONL + Markdown**，不绑定数据库。
- **reader 包不含 AI 中间产物**（candidates / review / open_questions / 复核日志）。

## 2. 为什么不是「AI 静默全自动」

「文本内容 AI 几乎不会错」对一类数据成立，对另一类不成立，自动化要为不成立的那类留兜底：

| 风险类别 | AI 表现 | 为什么 |
|---|---|---|
| 直述事实、明确数值、专有名词实体、单说话人对话标注 | 高准确，可自动 | 正文有明确依据 |
| 伏笔 / 隐藏身份 / 误导叙述 | **可能自信地错** | 作者故意误导读者，AI 可能被骗，或把后文揭示的真相写进早期数据当成事实 |
| 跨卷指代、疑似同一实体合并 | 易过度合并或漏合并 | 别名、化名、视角差异 |
| 主观关系判定 | 因人而异 | 本身无唯一正解 |

结论：自动化的安全性不靠「相信 AI 不会错」，而靠**独立复核关卡 + 升级清单 + 可回滚审计**这三层兜底。防剧透不在此列——它由分卷录入天然约束（§5），不是自动化的主要风险点。

## 3. 角色模型

| 角色 | 职责 | 不做 |
|---|---|---|
| **起草 Agent（Drafter）** | 按 range 读正文，调用 AI 生成结构化草案（候选），打初步 `confidence` 和 `risk_flags` | 不直接写 Accepted |
| **复核 Agent（Reviewer）** | **独立**重新核对每条草案：正文依据、与已有 Accepted 的一致性、叙述正确性；判定自动落盘或升级 | 不创作新数据，只核对与裁决路由 |
| **人（裁决者/审计员）** | 清空异常队列、抽查 Change 日志、对升级项做最终判断 | 不需要逐条确认低风险写入 |

复核 Agent 必须是**独立的一次推理**（独立 prompt、独立上下文、**独立模型**），不是起草同一次调用顺手自查——自查等于没查。Drafter 负责「尽量抽全」，Reviewer 负责「挑刺与核对依据」，两者目标相反才有制衡。模型选择见 §8。

注：草案上的 `confidence` 只是 AI 的自评标注，**不作为自动落盘的数值闸门**。路由完全交给复核 Agent 的自然语言判断（证据是否充分 + 是否属高风险类别），不设置信阈值。

## 4. 核心流程：双 AI 流水线

```text
选定作业范围（scene / 章 / 固定 block 段）
  → 起草 Agent：读正文 + 受控上下文 → 写 Candidates（草案 + confidence + risk_flags）
  → 复核 Agent：逐条独立核对
        ├─ 通过且低风险      → 自动写 Accepted + Change（标记 auto_accepted）
        ├─ 通过但属升级清单  → 进异常队列（escalated），等人裁决
        └─ 不通过            → 拒绝或退回起草（记录原因）
  → 写 work_run（范围、上下文预算、产出计数、自动/升级/拒绝分布）
  → 人：清异常队列 + 抽查 Change 日志（可整批回滚 work_run）
  → 触发 compiler 重新生成 reader_index
```

候选（candidates.jsonl）仍然保留，但**降格为内部中间格式**：它是起草到复核之间的传送带、fixture 和审计前置，不再是人工逐条操作的对象。

## 5. 防剧透处理（轻量，由分卷录入天然约束）

防剧透不是本项目核心卖点，本设计**不对每条草案做严格剧透闸门**。原因：

- **分卷逐本录入**：AI 处理第 N 卷时，上下文不含后续卷，跨卷剧透天然被限制在已录入范围内。
- 在「需求讲清楚 + 严格 agent 流程」下，卷内越界的概率本就很低；即便偶发，影响也有限，可由后续回滚/修正吸收。

保留的轻量约束（属于数据正确性，不是专门的防剧透关卡）：

- `visible_from` 仍按草案在正文中的**自身位置**正常生成，供阅读器右侧面板按 `read_boundary` 过滤。起草时默认 `visible_from = source_span` 揭示点，不刻意提前。
- 涉及**误导叙述 / 伏笔 / 隐藏身份**时，草案如实记录「正文当前所呈现的状态」，而不是 AI 已知的「真相」；真相留给 OpenQuestion，在后文揭示点再补 Accepted + Change。这条进升级清单（§6.2）的理由是**叙述正确性**，不是防剧透。

复核 Agent 不再为防剧透单设强制升级红线。

## 6. 风险分层与升级清单

复核 Agent 的路由依据。复核 Agent 按「证据是否充分 + 是否落在高风险类别」做自然语言判断，不靠数值阈值。

### 6.1 默认可自动落盘（低风险）

- 专有名词清晰的**新实体**（character / organization / location / term）。
- 单说话人、无歧义对话 block 的 **speaker_label**。
- 正文直述的 **fact**（string / entity / number / boolean，有明确 source_span 依据）。
- 正文给出明确数值的 **metric / metric_change**。
- 依据充分的 **term_card**。

### 6.2 必须升级给人（高风险 / 主观 / 叙述正确性）

- **实体合并 / 疑似同一实体**（永远人裁决）。
- **歧义说话人**（speaker_type=ambiguous，或一个 block 多候选说话人）。
- **relation_change**（带主观性）。
- **event 摘要**中任何无法在正文逐点落定的判断。
- **伏笔 / 隐藏身份 / 误导叙述**相关（理由是叙述正确性，见 §5）。
- **数值矛盾**、与已有 Accepted 冲突（数值、身份、关系、时间线）。
- **图片中人物身份识别**（asset_subject 的 entity 判定）。
- 复核 Agent 自身判断**证据不足或拿不准**的任何草案（宁可升级，不要硬塞自动）。

### 6.3 升级项的呈现要求

进异常队列的每一项必须带**人话决策信息**，不是 raw JSON：

- 一句话说清「为什么需要你看」（冲突点 / 歧义点 / 叙述正确性疑点）。
- 涉及的正文片段（source_span 对应原文）。
- 复核 Agent 的判断和推荐操作（接受 / 改后接受 / 合并到 X / 转 OpenQuestion / 拒绝）。
- 与之冲突的已有 Accepted 对象（若有）。

## 7. 可追溯与可回滚

自动化的安全网。

- 每个自动写入的 Accepted 对象都生成一条 Change，新增 `decided_by: "reviewer_agent"`、`auto_accepted: true`、`reviewer_model`、`work_run_id` 字段（在 `changes.jsonl` 既有结构上扩展，operation 复用 `accept_candidate`；人工裁决的升级项写 `decided_by: "user"`）。
- **三级回滚**：
  - 单对象：撤销某个 Accepted + 其 Change。
  - 单 Change：定点撤销。
  - 整批 work_run：发现起草 Agent 在某段跑偏时，一键回滚该范围全部自动写入，重做。
- Change 日志是人的**主审计面**：人不看每条候选，而是抽查「这批自动落盘里有没有离谱的」，按 work_run 维度看分布（自动 N 条 / 升级 M 条 / 拒绝 K 条）。
- OpenQuestion 在后文揭示点 resolved 时，仍必须写 Accepted + Change，并把 `resolved_by_change_id` 指向它。

## 8. 模型配置（起草与复核分离、可插拔）

起草和复核各自配置一个模型，彼此独立，可同厂不同型号、也可跨厂商。**复核模型必须不同于起草模型**——这是双 AI 制衡的前提，同模型自查约等于没查。

- **典型搭配**：起草用便宜快的主力（例如 DeepSeek `ds4flash`），复核用更强或不同视角的模型（例如 DeepSeek `dsv4pro`，或接 MiMo 的 `mimov2.5`）。不同厂商的模型盲点不一样，复核更能挑出起草的系统性偏差。
- **配置形态**：每个角色一组 `{ provider / base_url, api_key, model }`，第一阶段放本地配置（工具配置文件或环境变量），不写进 bookpack，不提交到 git；前端状态接口只返回是否已配置 key，不返回明文。
- **可换不改流程**：换模型、换厂商只改配置，不改流水线语义。`changes.jsonl` 的 `reviewer_model` 字段记录实际复核模型，便于审计追溯「这批是谁复核的」。
- 不再有信任档位 / 数值阈值（已砍）。自动 vs 升级完全由 §6 类别 + 复核 Agent 判断决定，制作者只在异常队列和审计面参与。

## 9. 两遍制作（与稳定节点摘要衔接）

数据类型的成熟时机不同，分两遍降低重复返工：

- **第一遍 · 客观结构层**（scene 级推进）：实体、说话人、直述事实、数值。AI 起草 + 复核自动落盘为主，人清少量异常。
- **第二遍 · 解释层**（章末 / 卷末 / 学期末等稳定节点）：事件摘要、关系变化、角色卡、卷总结。数量少、主观性高、每个都值得人看一眼；角色卡按既有规格在稳定节点生成，不按 block 重写。

这与 `workflow-spec-v0.1.md` §9「角色卡按稳定节点生成」一致。

## 10. 工作台形态（不是候选卡片列表）

工作台围绕四件事，不是候选逐条按钮：

1. **作业控制台**：选范围、起草、看 work_run 进度与自动/升级/拒绝分布、整批回滚。
2. **异常队列**：§6.2 升级项，带 §6.3 决策信息；人在这里做真正的判断，这是人的主操作面。
3. **审计 / 差异视图**：按 work_run 或时间看自动落盘的 Change，抽查、定点回滚。
4. **scene digest（可选钻取）**：把一段范围的产出聚合成人话摘要（「本场景新增 3 实体、8 说话人、1 事件、1 处点数变化」），供想通读校对时用，但不是必经步骤。

已实现为图形化三栏 Web 工作台（`tools/`，`npm run workbench`）：左栏按**章节**选生成范围 + 面板配置 API/供应商（OpenAI 通用协议）；中栏逐 block 展示；右栏点开 block 看其全部「标识」，并含异常队列、审计/回滚两个标签页。界面用语中文。

## 11. 对现有数据与接口的影响

保持第一阶段 JSON/JSONL，不推倒已实现的 stores。

- **candidates.jsonl**：保留为内部中间格式，schema 不变（`docs/data-format-v0.1.md` §8 仍有效）。
- **changes.jsonl**：扩展字段 `decided_by` / `auto_accepted` / `reviewer_model` / `work_run_id`（向后兼容，旧记录视为 `decided_by:"user"`）。
- **review_items.jsonl / open_questions.jsonl**：异常队列复用 ReviewItem；伏笔/隐藏身份继续用 OpenQuestion。
- **work_runs.jsonl**：扩展记录 `auto_accepted_count` / `escalated_count` / `rejected_count` / `drafter_model` / `reviewer_model`。
- **新增（实施阶段定）**：复核 Agent 的判定记录（可并入 candidate 的 review 字段或单独 `reports/review_runs.jsonl`）。
- **新增接口**：`ReviewerAgent.reviewCandidate()` / `reviewRange()`；`AcceptedStore.autoAccept(candidate, reviewer_decision)`（受控自动写入，强制生成 Change）；回滚接口 `revertChange` / `revertWorkRun`。

`docs/agent-operation-spec-v0.1.md` §4 的工具接口（FileStore/Parser/Validator/CandidateGenerator/Compiler/WorkRunStore）继续有效，新增 Reviewer 与自动写入/回滚接口。

## 12. 待定参数（实施前确认）

- 起草 / 复核各用哪个模型（已定方向：分离 + 可跨厂商，例如起草 ds4flash、复核 dsv4pro 或 mimov2.5；具体型号实施时定）。
- §6.1 / §6.2 分类是否要再细分（例如 fact 里区分「客观属性」vs「带评价的描述」）。
- 异常队列是否需要优先级与批量操作（同类合并候选一次裁决）。
- scene digest 是否在第一阶段就做，还是 CLI 审计先行。

## 13. 与文档体系的关系 / 下一步

- 本文取代旧方案的「逐候选复核」部分；`agent-operation-spec-v0.1.md` §6/§9/§11 和 `workflow-spec-v0.1.md` §3/§5 的逐候选描述以本文为准。
- 已同步：`project-prompts-v0.1.md`（使用规则、通用提示词、0.1#4、0.3 整段、阶段五/六/八）、`README.md`、`phase-5-8-operation-redesign-note.md` 均已对齐本文口径并指向本文。
- 已实现：起草/复核双 AI 流水线 + 增量 AgentStore（自动落盘 + Change + 三级回滚）+ 图形化三栏工作台（`tools/src/server.ts`、`tools/src/agent/*`、`tools/web/*`，`npm run workbench`）。读侧（章节/逐 block/标识/异常队列/审计）与写侧（自动落盘 + 回滚 + 人工裁决）已用 gray-tower 验证；实际 LLM 调用待接入 API key。
