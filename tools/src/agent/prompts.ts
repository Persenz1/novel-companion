// 起草 / 复核 v2 提示词：稳定前缀 + 分 pass 抽取 + JSONL 输出。
//
// 设计见 docs/modules/drafting-review-v2-design.md：
//   - 同卷所有调用共享大前缀（system + 全卷正文 + 已确认记忆），变化区放最后，
//     前缀缓存按前缀匹配，pass 内所有窗口调用命中同一前缀。
//   - 稀疏抽取（实体/知识/叙事）与密集标注（说话人）用不同调用形状。
//   - 输出 JSONL（一行一条），截断只丢尾行，废除全局条数上限。
import type { Block } from "../types.js";

type Rec = Record<string, unknown>;

export type DraftPassId = "entities" | "knowledge" | "narrative" | "speakers";

export const DRAFT_PASS_IDS: DraftPassId[] = ["entities", "knowledge", "narrative", "speakers"];

// ---------- 共用 system（所有 pass 一致，保持前缀稳定） ----------

export const GENERIC_SYSTEM = `你是长篇小说结构化制作流水线中的工作助手。用户消息依次给出【全卷正文】（带 block 标识）、【已确认记忆】（既有结构化数据摘要）与【本次任务】。
通读正文与记忆后，严格按【本次任务】的指令与输出格式工作。只输出任务要求的内容，不输出任何解释或前后缀文字。`;

// ---------- 前缀：全卷正文 + 已确认记忆 ----------

export interface ChapterSection {
  title: string;
  blocks: Block[];
}

function blockLines(blocks: Block[]): string {
  return blocks.map((b) => `[${b.id} | ${b.kind}] ${b.text}`).join("\n");
}

export function buildVolumePrefix(volumeTitle: string, sections: ChapterSection[], memory: string): string {
  const body = sections.map((s) => `【${s.title}】\n${blockLines(s.blocks)}`).join("\n\n");
  return `【全卷正文 · ${volumeTitle}】
${body}

【已确认记忆】（既有结构化数据；实体 id 必须复用，不要重复造）
${memory}

`;
}

/**
 * 跨卷已确认记忆摘要（v2 放宽：不止实体名册，还带事实/事件/关系/数值的压缩状态）。
 * 摘要一律引用 id，便于模型复用；各节封顶防失控。
 */
export function renderAcceptedMemory(accepted: Map<string, Rec[]>): string {
  const out: string[] = [];
  const cap = <T>(rows: T[], n: number) => rows.slice(0, n);

  const ents = accepted.get("entity") ?? [];
  out.push("实体名册：");
  if (ents.length === 0) out.push("（暂无）");
  for (const e of ents) {
    const aliases = (e.aliases as string[]) ?? [];
    out.push(`${e.id}: ${e.name}${aliases.length ? `（别名 ${aliases.join("、")}）` : ""} [${e.type}]`);
  }

  // 现行事实：每 subject+predicate 取最新一条（valid_until 为空视为现行）。
  const facts = (accepted.get("fact") ?? []).filter((f) => f.valid_until == null);
  const latestFact = new Map<string, Rec>();
  for (const f of facts) latestFact.set(`${f.subject_id}|${f.predicate}`, f);
  if (latestFact.size) {
    out.push("", "现行事实：");
    for (const f of cap([...latestFact.values()], 500)) {
      out.push(`${f.subject_id}.${f.predicate} = ${f.value ?? f.value_entity_id ?? ""}`);
    }
  }

  const events = (accepted.get("event") ?? []).filter((e) => e.importance === "critical" || e.importance === "major");
  if (events.length) {
    out.push("", "主要事件：");
    for (const e of cap(events, 200)) out.push(`${e.id} [${e.importance}] ${e.title}：${e.summary ?? ""}`);
  }

  // 关系现状：每实体对取最后一条 relation_change 的 after。
  const rels = accepted.get("relation_change") ?? [];
  const latestRel = new Map<string, Rec>();
  for (const r of rels) latestRel.set([...((r.entities as string[]) ?? [])].sort().join("|"), r);
  if (latestRel.size) {
    out.push("", "关系现状：");
    for (const r of cap([...latestRel.values()], 200)) {
      out.push(`${((r.entities as string[]) ?? []).join(" ↔ ")}：${r.after ?? ""}`);
    }
  }

  // 数值现状：metric 定义 + 最后一条 metric_change 的 new_value。
  const metrics = accepted.get("metric") ?? [];
  const changes = accepted.get("metric_change") ?? [];
  if (metrics.length) {
    out.push("", "数值现状：");
    for (const m of cap(metrics, 100)) {
      const last = [...changes].reverse().find((c) => c.metric_id === m.id);
      out.push(`${m.id}（${m.name}）${last ? ` = ${last.new_value}` : ""}`);
    }
  }

  const terms = accepted.get("term_card") ?? [];
  if (terms.length) {
    out.push("", "术语卡：");
    for (const t of cap(terms, 100)) out.push(`${t.id}: ${t.title}`);
  }

  return out.join("\n");
}

// ---------- 各 pass 的类型 schema 与任务指令 ----------

const CANDIDATE_LINE_FORMAT = `输出格式：JSONL——每行一个独立 JSON 对象，不要外层数组、不要代码围栏、不要行尾逗号。每行形如：
{"type":"<类型>","source_span":{"start_block":"...","end_block":"..."},"visible_from":"...","confidence":0.0-1.0,"draft":{<按类型必填字段>},"evidence":"一句话证据","risk_flags":[]}`;

const PROVISIONAL_ENTITY_NOTE = `如果遇到【已确认记忆】名册之外的新人物/组织/术语且确有必要引用：先输出一行 type:"entity" 的临时实体候选（id 用可读 slug），后续行才可引用该 id；不得引用未注册且本批未给出的 id。`;

export interface DraftPassSpec {
  id: DraftPassId;
  label: string;
  /** 本 pass 允许产出的候选类型（entity 恒可作为临时实体产出）。 */
  types: string[];
  instruction: string;
}

export const DRAFT_PASSES: Record<DraftPassId, DraftPassSpec> = {
  entities: {
    id: "entities",
    label: "实体名册",
    types: ["entity"],
    instruction: `任务：通读全卷，抽取值得进入名册的实体（人物/组织/地点/术语/团体/世界观概念）。这是后续所有抽取的引用基础，宁全勿缺；跑龙套无名路人不收。
- entity draft 必填：{ id(可读slug,如 entity_linche), series_id, type(character|organization|location|term|group|worldbuilding|event_concept), name, aliases[], first_seen(block_id), status:"accepted", source_span }
- name 与 aliases 只用正文出现过的称呼；first_seen / visible_from 取该实体首次在正文出现的 block，不要提前。
- 已在【已确认记忆】名册中的实体不要重复输出；发现名册实体的新别名时，输出同 id 的 entity 行并在 aliases 里补全（risk_flags 加 "alias_update"）。

${CANDIDATE_LINE_FORMAT}`,
  },
  knowledge: {
    id: "knowledge",
    label: "事实 / 数值 / 术语",
    types: ["fact", "metric", "metric_change", "term_card", "entity"],
    instruction: `任务：只在本次窗口范围内，抽取事实、数值与术语卡候选。有正文依据就抽，不设条数上限；不要脑补、不要编造数值。
- fact: { id, series_id, subject_id(实体id), predicate, value, value_type(string|entity|number|boolean), value_entity_id?, valid_from(block_id), valid_until:null, visible_from, source_span, status:"accepted" }（subject_id 只能是实体 id）
- metric: { id, series_id, subject_id, name, metric_type, unit, value_type, visible_from, source_span, status:"accepted" }
- metric_change: { id, series_id, metric_id, old_value, new_value, delta, reason, valid_from, visible_from, source_span, status:"accepted" }（id 必须带变化或位置，如 metric_change_dclass_points_190_to_160；引用的 metric_id 若尚无定义，同批先给出 metric 行）
- term_card: { id, series_id, term_entity_id, title, summary, visible_from, source_span, summary_source:"ai_draft", status:"accepted" }（term_entity_id 必须存在或同批给出）
- ${PROVISIONAL_ENTITY_NOTE}

${CANDIDATE_LINE_FORMAT}`,
  },
  narrative: {
    id: "narrative",
    label: "事件 / 关系变化",
    types: ["event", "relation_change", "entity"],
    instruction: `任务：只在本次窗口范围内，抽取事件与关系变化候选。有依据就抽，不设条数上限。
- event: { id, series_id, type, title, summary, summary_source:"ai_draft", position(block_id), participants[], related_entities[], importance(critical|major|minor|background), visible_from, source_span, status:"accepted" }
- relation_change: { id, series_id, entities[2], before, after, event_id?, valid_from, visible_from, source_span, status:"accepted" }（两人关系状态发生可指认的变化才算；entities 用实体 id）
- 涉及伏笔/隐藏身份/误导叙述时，如实记录"正文当前呈现的状态"，不要写你猜到的真相。
- ${PROVISIONAL_ENTITY_NOTE}

${CANDIDATE_LINE_FORMAT}`,
  },
  speakers: {
    id: "speakers",
    label: "说话人标注",
    types: ["speaker_label"],
    instruction: `任务：对本次窗口内**每一个 dialogue 块**判定说话人，逐块输出一行，禁止遗漏（全覆盖契约）。
- 每行格式：{"block_id":"...","speaker_type":"entity|narrator|group|system|unknown|ambiguous","speaker_entity_id":"entity_xxx 或省略","display_name":"该位置正文已揭示的称呼","confidence":0.0-1.0}
- speaker_type 取值：entity=名册中的具体人物；narrator=叙述者自己说的话；group=多人齐声（display_name 写群体称呼）；system=广播/系统/文书；unknown=正文无法判断是谁；ambiguous=有 2 个以上候选拿不准（confidence 相应降低）。
- 防剧透：display_name 必须用该位置为止正文已揭示的称呼（名字未出现前用"红发学生"这类正文称呼），不要用后文才揭示的名字。
- 归因依据是相邻叙述句、称呼、口癖、上下文轮替；判定不了就老实 unknown，不要硬猜。
- 名册外的说话人：speaker_type 用 entity、speaker_entity_id 省略、display_name 写正文称呼（会转人工确认）。
- 只输出 JSONL 行，一行一个 JSON 对象，不要外层数组、不要围栏。`,
  },
};

// ---------- 起草变化区（tail） ----------

export interface DraftWindowMeta {
  startBlock: string;
  endBlock: string;
  blockCount: number;
  dialogueCount: number;
  windowIndex: number;
  windowTotal: number;
}

export function buildDraftTail(spec: DraftPassSpec, win: DraftWindowMeta): string {
  const range =
    spec.id === "entities"
      ? `本次范围：全卷（${win.startBlock} → ${win.endBlock}，共 ${win.blockCount} 块）。`
      : `本次窗口（第 ${win.windowIndex}/${win.windowTotal} 窗）：${win.startBlock} → ${win.endBlock}（含两端，共 ${win.blockCount} 块，其中 dialogue ${win.dialogueCount} 块）。只处理窗口内的内容；source_span/visible_from/block_id 必须落在窗口范围内。全卷正文仅用于保持称呼、剧情与状态的连续性。`;
  return `【本次任务 · ${spec.label}】
${range}

${spec.instruction}`;
}

/** 说话人 pass 覆盖缺口补跑：只列缺失 block id。 */
export function buildSpeakerRetryTail(missingIds: string[]): string {
  return `【本次任务 · 说话人标注 · 补漏】
上一轮以下 dialogue 块缺少判定，请只为这些块逐一输出判定行（格式同前，一行一个 JSON）：
${missingIds.join("\n")}`;
}

/** 截断续写：告知已收行数，从断点继续。 */
export function buildContinueMessage(receivedRows: number): string {
  return `你的输出被截断。已成功接收 ${receivedRows} 行。请从第 ${receivedRows + 1} 行（含被截断未完成的那一行）继续输出剩余行，仍然一行一个 JSON，不要重复已接收的行，不要输出任何说明文字。`;
}

// ---------- 复核 ----------

const REVIEW_COMMON = `你是独立复核助手，与起草是不同模型。对下列每条候选判断：(1) draft 的每个信息点能否在 source_span 指向的正文找到依据；(2) 是否与【已确认记忆】冲突（数值矛盾、身份矛盾、重复实体）；(3) 引用的实体/事件/数值 id 是否存在于名册或本批候选。
路由：auto=依据充分且低风险，自动落盘；escalate=高风险或拿不准，交人裁决；reject=无正文依据或明显错误。
输出格式：JSONL——每行一个决定，形如：
{"candidate_id":"...","route":"auto|escalate|reject","reason":"为什么","recommended_action":"接受|改后接受|合并到X|转未决问题|拒绝","edited_draft":null}
可在 edited_draft 给修正后的完整草案。不要输出决定行以外的任何文字。`;

const REVIEW_CHECKLISTS: Record<DraftPassId, string> = {
  entities: `本批为实体候选，重点：
- 与名册或本批其他候选疑似同一实体（同人异名/异译）→ escalate（recommended_action 写"合并到X"）。
- name/aliases 含正文没有的称呼 → reject 或 edited_draft 修正。
- first_seen 晚于/早于正文实际首现 → edited_draft 修正后 auto。`,
  knowledge: `本批为事实/数值/术语候选，重点：
- 数值必须与正文完全一致，对不上 → reject；数值与已确认记忆冲突 → escalate。
- fact.subject_id 必须是实体 id；metric_change.metric_id 必须存在或在本批中定义。
- 伏笔/隐藏身份相关的"事实" → escalate。`,
  narrative: `本批为事件/关系变化候选，重点：
- event.summary 的每个论断都要能落到正文；落不了 → edited_draft 删改或 escalate。
- relation_change 一律 escalate（高风险类别，人裁决），你的 reason 里给出支持/反对证据。
- 伏笔/隐藏身份/误导叙述相关 → escalate。`,
  speakers: `本批为说话人标注候选，重点：
- 归因与相邻叙述线索一致、无第二候选 → auto。
- speaker_type=ambiguous、同块多候选、或你另有第二人选 → escalate。
- display_name 用了该位置尚未揭示的名字（剧透）→ edited_draft 改为已揭示称呼后 auto，改不了 → escalate。
- 明显归因错误 → reject。`,
};

export interface ReviewCandidateView {
  candidate_id: string;
  type: string;
  source_span: Rec;
  draft: Rec | undefined;
  evidence: string | undefined;
}

export function buildReviewTail(passId: DraftPassId, candidates: ReviewCandidateView[]): string {
  return `【本次任务 · 复核 · ${DRAFT_PASSES[passId].label}】
${REVIEW_COMMON}

${REVIEW_CHECKLISTS[passId]}

待复核候选：
${JSON.stringify(candidates)}`;
}
