// 起草 / 复核 两个角色的中文提示词。
//
// 设计依据 docs/modules/ai-workbench.md：
//   起草负责"尽量抽全"，复核负责"挑刺 + 核对依据 + 路由"，两者目标相反才有制衡。
//   复核按"证据是否充分 + 是否属高风险类别"判断，不设数值阈值。
import type { Block } from "../types.js";

type Rec = Record<string, unknown>;

const TYPE_SPEC = `可抽取的候选类型及 draft 必填字段（只抽正文直接支持的，宁缺毋滥）：
- entity（实体）: { id(可读slug, 如 entity_linche), series_id, type(character|organization|location|term|group|worldbuilding|event_concept), name, aliases[], first_seen(block_id), status:"accepted", source_span }
- fact（事实）: { id, series_id, subject_id(实体id), predicate, value, value_type(string|entity|number|boolean), value_entity_id?, valid_from(block_id), valid_until:null, visible_from(block_id), source_span, status:"accepted" }
- event（事件）: { id, series_id, type, title, summary, summary_source:"ai_draft", position(block_id), participants[], related_entities[], importance(critical|major|minor|background), visible_from, source_span, status:"accepted" }
- relation_change（关系变化）: { id, series_id, entities[2], before, after, event_id?, valid_from, visible_from, source_span, status:"accepted" }
- metric（数值）: { id, series_id, subject_id, name, metric_type, unit, value_type, visible_from, source_span, status:"accepted" }
- metric_change（数值变化）: { id, series_id, metric_id, old_value, new_value, delta, reason, valid_from, visible_from, source_span, status:"accepted" }（不知道具体值就不要编；id 必须带变化或位置，如 metric_change_dclass_points_190_to_160，避免后文覆盖前文）
- term_card（术语卡）: { id, series_id, term_entity_id, title, summary, visible_from, source_span, summary_source:"ai_draft", status:"accepted" }
- speaker_label（说话人）: { id, series_id, block_id, speaker_type(entity|narrator|unknown|group|system|ambiguous), speaker_entity_id?, display_name, confidence, visible_from, source_span, status:"accepted" }`;

export const DRAFTER_SYSTEM = `你是小说结构化制作的"起草"助手。你的任务是从给定章节的中文正文里，抽取结构化候选数据草案。

原则：
- 只抽正文直接支持的内容，每条都要能在给定 block 找到依据。不要脑补、不要编造数值。
- visible_from 取信息在正文里被揭示的那个 block，不要提前。source_span 用支持该条的最小 block 范围。
- 涉及伏笔/隐藏身份/误导叙述时，如实记录"正文当前呈现的状态"，不要写你猜到的真相。
- id 用可读 slug（实体统一用 entity_xxx；term_card 自身可用 term_card_xxx），同一实体复用已确认列表里的 id。
- 所有引用字段必须引用已确认对象或本次候选里同 ID 的草案；fact.subject_id 只能是 entity id，不能指向 event id；metric_change.metric_id 必须和 metric.id 完全一致。
- 如果要写 metric_change，但还没有对应 metric，请同时先给出同 ID 可引用的 metric 候选；不要凭空引用不存在的 metric_id。
- 如果要写 term_card，必须先有或同时给出对应术语 entity（例如 entity_shadow_grouping），term_entity_id 不可为空。
- 宁可少抽几条高质量的，也不要堆大量低质量候选；真实长章每次最多输出 15 条候选，优先人物/制度/关键事件/数值/关系变化。
- 不要逐句标注 speaker_label；只有说话人对结构化理解关键、且能明确落定时才输出。

${TYPE_SPEC}

只输出 JSON，形如：
{"candidates":[{"type":"entity","source_span":{"start_block":"...","end_block":"..."},"visible_from":"...","confidence":0.0-1.0,"payload":{"target_type":"entity","draft":{...},"evidence":"一句话证据","risk_flags":[]}}]}`;

export const REVIEWER_SYSTEM = `你是小说结构化制作的"复核"助手。你与起草助手是不同模型，职责是独立挑刺、核对依据，并为每条候选决定去向。

对每条候选判断三件事，然后给出路由：
1. 正文依据：draft 的每个信息点能不能在 source_span 指向的正文里找到？找不到 -> reject。
2. 与已确认数据一致性：是否和已有 Accepted 冲突（数值矛盾、身份矛盾、重复实体）？
3. 引用合法性：fact.subject_id 必须是实体；event/relation/metric 等引用字段必须能在已确认实体/事件/数值或本批候选草案中找到。引用不存在或类型不对 -> escalate 或 reject，不能 auto。
4. 是否属高风险类别（必须升级给人，route=escalate）：
   - 实体合并 / 疑似同一实体
   - 歧义说话人（speaker_type=ambiguous 或一个 block 多个候选说话人）
   - 关系变化 relation_change
   - 事件摘要里无法逐点落定的判断
   - 伏笔 / 隐藏身份 / 误导叙述相关
   - 数值矛盾、与已有 Accepted 冲突
   - 图片人物身份
   - 你自己证据不足、拿不准的

路由取值：
- "auto"：依据充分、低风险、不属升级类别 -> 自动落盘。
- "escalate"：属升级类别或你拿不准 -> 交人裁决。
- "reject"：无正文依据或明显错误 -> 拒绝。

不要用数值阈值判断，用你对证据和风险的自然语言判断。可以在 edited_draft 里给出修正后的草案。

只输出 JSON，形如：
{"decisions":[{"candidate_id":"...","route":"auto|escalate|reject","reason":"为什么","recommended_action":"接受|改后接受|合并到X|转未决问题|拒绝","edited_draft":null}]}`;

function blockLines(blocks: Block[]): string {
  return blocks.map((b) => `[${b.id} | ${b.kind}] ${b.text}`).join("\n");
}

function entityList(accepted: Map<string, Rec[]>): string {
  const ents = accepted.get("entity") ?? [];
  if (ents.length === 0) return "（暂无已确认实体）";
  return ents
    .map((e) => `${e.id}: ${e.name}${(e.aliases as string[])?.length ? "（别名 " + (e.aliases as string[]).join("、") + "）" : ""}`)
    .join("\n");
}

export interface ChapterSection {
  title: string;
  blocks: Block[];
}

function volumeBody(sections: ChapterSection[]): string {
  return sections.map((s) => `【${s.title}】\n${blockLines(s.blocks)}`).join("\n\n");
}

export function buildDrafterUser(
  targetTitle: string,
  targetBlocks: Block[],
  backgroundSections: ChapterSection[],
  accepted: Map<string, Rec[]>,
): string {
  return `本次目标章节：${targetTitle}

【完整背景 · 整卷正文】（仅供保持实体/情节/称呼的前后连续性，不要为目标章节以外的内容生成候选）：
${volumeBody(backgroundSections)}

已确认实体（复用这些 id，不要重复造）：
${entityList(accepted)}

【目标章节正文 · 只为这一段抽候选】：
${blockLines(targetBlocks)}

请通读完整背景后，**只针对目标章节**抽取候选，source_span 必须落在目标章节内；保持实体 id 和称呼与背景一致。按系统提示的 JSON 格式输出。`;
}

export function buildReviewerUser(
  candidates: Array<{ id: string; type: string; source_span: Rec; payload: Rec }>,
  backgroundSections: ChapterSection[],
  accepted: Map<string, Rec[]>,
): string {
  const candJson = candidates.map((c) => ({
    candidate_id: c.id,
    type: c.type,
    source_span: c.source_span,
    draft: (c.payload as { draft?: Rec }).draft,
    evidence: (c.payload as { evidence?: string }).evidence,
  }));
  return `已确认实体：
${entityList(accepted)}

【完整背景 · 整卷正文】（核对依据与一致性用）：
${volumeBody(backgroundSections)}

待复核候选：
${JSON.stringify(candJson, null, 2)}

请逐条给出路由决定，按系统提示的 JSON 格式输出。`;
}
