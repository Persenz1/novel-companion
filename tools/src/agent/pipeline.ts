// 双 AI 流水线编排：起草 -> 复核 -> 自动落盘 / 升级 / 拒绝，外加人工裁决异常队列。
//
// 起草 Agent 写候选；复核 Agent 独立路由；低风险自动写 Accepted（带可回滚 Change），
// 高风险升级成异常队列里的 ReviewItem 交人裁决。详见
// docs/modules/ai-workbench.md。
import { FileStore } from "../fileStore.js";
import type { Candidate, Manifest, ManifestVolume } from "../types.js";
import type { WorkbenchConfig } from "./config.js";
import { isModelReady } from "./config.js";
import { chat, extractJson } from "./llm.js";
import { AgentStore } from "./agentStore.js";
import { WorkbenchData } from "./workbenchData.js";
import {
  DRAFTER_SYSTEM,
  REVIEWER_SYSTEM,
  buildDrafterUser,
  buildReviewerUser,
  type ChapterSection,
} from "./prompts.js";

type Rec = Record<string, unknown>;

const CANDIDATES = "candidates/candidates.jsonl";
const REVIEW_ITEMS = "review/review_items.jsonl";
const OPEN_QUESTIONS = "review/open_questions.jsonl";
const WORK_RUNS = "reports/work_runs.jsonl";
const DRAFT_CHAT_OPTIONS = { jsonMode: true, temperature: 0.2, maxTokens: 8192, thinking: "enabled", reasoningEffort: "high" } as const;
const REVIEW_CHAT_OPTIONS = { jsonMode: true, temperature: 0.1, maxTokens: 8192, thinking: "enabled", reasoningEffort: "high" } as const;

function chapterKey(chapterId: string): string {
  return chapterId.replace(/[.]/g, "_");
}

function nextSeqId(rows: Rec[], prefix: string): (n: number) => string {
  let base = 0;
  for (const r of rows) {
    const m = String((r as { id?: string }).id ?? "").match(/(\d+)$/);
    if (m && String((r as { id?: string }).id ?? "").startsWith(prefix)) base = Math.max(base, Number(m[1]));
  }
  return (n: number) => `${prefix}${String(base + n).padStart(4, "0")}`;
}

function manifestOf(store: FileStore): Manifest {
  return store.readJson<Manifest>("manifest.json");
}

function chapterTitle(manifest: Manifest, chapterId: string): string {
  for (const v of manifest.volumes) for (const ch of v.chapters) if (ch.id === chapterId) return ch.title;
  return chapterId;
}

/** 找到包含某章节的卷。 */
function volumeForChapter(manifest: Manifest, chapterId: string): ManifestVolume {
  const v = manifest.volumes.find((x) => x.chapters.some((ch) => ch.id === chapterId));
  if (!v) throw new Error(`找不到章节 ${chapterId} 所属的卷`);
  return v;
}

/** 整卷正文按 manifest 章节顺序分段（作为完整背景），空章节跳过。 */
function volumeSections(data: WorkbenchData, volume: ManifestVolume): ChapterSection[] {
  return volume.chapters
    .map((ch) => ({ title: ch.title, blocks: data.blocksForChapter(ch.id) }))
    .filter((s) => s.blocks.length > 0);
}

function appendJsonl(store: FileStore, file: string, rows: Rec[]): void {
  const existing = store.readJsonl<Rec>(file).rows;
  store.writeJsonl(file, existing.concat(rows));
}

function tokenUsage(usage: Record<string, unknown> | undefined): Rec | undefined {
  if (!usage) return undefined;
  const out: Rec = {};
  for (const key of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "prompt_cache_hit_tokens",
    "prompt_cache_miss_tokens",
  ]) {
    const value = usage[key];
    if (typeof value === "number") out[key] = value;
  }
  const hit = out.prompt_cache_hit_tokens;
  const miss = out.prompt_cache_miss_tokens;
  if (typeof hit === "number" && typeof miss === "number" && hit + miss > 0) {
    out.prompt_cache_hit_ratio = Number((hit / (hit + miss)).toFixed(4));
  }
  const completionDetails = usage.completion_tokens_details;
  if (completionDetails && typeof completionDetails === "object") {
    const reasoning = (completionDetails as Rec).reasoning_tokens;
    if (typeof reasoning === "number") out.reasoning_tokens = reasoning;
  }
  return Object.keys(out).length ? out : usage;
}

function setOfIds(rows: Rec[] | undefined): Set<string> {
  return new Set((rows ?? []).map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean));
}

function collectAutoDraftIds(pending: Candidate[], decisions: Map<string, Rec>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const c of pending) {
    const d = decisions.get(c.id);
    if (String((d as { route?: string })?.route ?? "escalate") !== "auto") continue;
    const edited = (d as { edited_draft?: Rec })?.edited_draft;
    const draft = (edited && Object.keys(edited).length ? edited : c.payload.draft) as Rec | undefined;
    const id = String((draft as { id?: string } | undefined)?.id ?? "");
    if (!id) continue;
    const ids = out.get(c.type) ?? new Set<string>();
    ids.add(id);
    out.set(c.type, ids);
  }
  return out;
}

function idsFor(accepted: Map<string, Rec[]>, autoDraftIds: Map<string, Set<string>>, type: string): Set<string> {
  return new Set([...setOfIds(accepted.get(type)), ...(autoDraftIds.get(type) ?? [])]);
}

function missingRefs(values: unknown, allowed: Set<string>): string[] {
  const refs = Array.isArray(values) ? values : values ? [values] : [];
  return refs.map(String).filter((ref) => ref && !allowed.has(ref));
}

function comparableDraft(r: Rec): string {
  const skip = new Set(["series_id", "status", "created_change_id", "updated_change_ids"]);
  const out: Rec = {};
  for (const key of Object.keys(r).sort()) {
    if (!skip.has(key)) out[key] = r[key];
  }
  return JSON.stringify(out);
}

function autoAcceptBlockers(
  type: string,
  draft: Rec,
  accepted: Map<string, Rec[]>,
  autoDraftIds: Map<string, Set<string>>,
): string[] {
  const entities = idsFor(accepted, autoDraftIds, "entity");
  const events = idsFor(accepted, autoDraftIds, "event");
  const metrics = idsFor(accepted, autoDraftIds, "metric");
  const acceptedIds = new Set([...accepted.values()].flatMap((rows) => rows.map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean)));
  const blockers: string[] = [];
  const draftId = String((draft as { id?: string }).id ?? "");
  const existing = (accepted.get(type) ?? []).find((r) => String((r as { id?: string }).id ?? "") === draftId);
  if (existing && type !== "entity" && type !== "metric" && comparableDraft(existing) !== comparableDraft(draft)) {
    blockers.push(`Accepted 已存在同 ID ${draftId} 但内容不同，不能自动覆盖`);
  }
  const required = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") blockers.push(`${label} 缺失`);
  };
  const check = (label: string, values: unknown, allowed: Set<string>) => {
    const missing = missingRefs(values, allowed);
    if (missing.length) blockers.push(`${label} 引用不存在或类型不对：${missing.join(", ")}`);
  };

  switch (type) {
    case "fact":
      required("subject_id", draft.subject_id);
      check("subject_id", draft.subject_id, entities);
      if (draft.value_type === "entity") {
        required("value_entity_id", draft.value_entity_id);
        check("value_entity_id", draft.value_entity_id, entities);
      }
      break;
    case "event":
      check("participants", draft.participants, entities);
      check("related_entities", draft.related_entities, entities);
      break;
    case "relation_change":
      required("entities", draft.entities);
      check("entities", draft.entities, entities);
      if (draft.event_id) check("event_id", draft.event_id, events);
      break;
    case "metric":
      required("subject_id", draft.subject_id);
      check("subject_id", draft.subject_id, entities);
      break;
    case "metric_change":
      required("metric_id", draft.metric_id);
      check("metric_id", draft.metric_id, metrics);
      if (draft.reason_event_id) check("reason_event_id", draft.reason_event_id, events);
      break;
    case "term_card":
      required("term_entity_id", draft.term_entity_id);
      check("term_entity_id", draft.term_entity_id, entities);
      break;
    case "character_card":
      required("entity_id", draft.entity_id);
      check("entity_id", draft.entity_id, entities);
      check("source_refs", draft.source_refs, acceptedIds);
      break;
    case "speaker_label":
      if (draft.speaker_type === "entity") {
        required("speaker_entity_id", draft.speaker_entity_id);
        check("speaker_entity_id", draft.speaker_entity_id, entities);
      }
      break;
    case "asset_subject":
      if (draft.entity_id) check("entity_id", draft.entity_id, entities);
      break;
  }
  return blockers;
}

// ----- 起草 -----

export interface DraftResult {
  chapter_id: string;
  created: number;
  model: string;
  candidates: Candidate[];
}

export async function runDraft(
  store: FileStore,
  cfg: WorkbenchConfig,
  chapterId: string,
): Promise<DraftResult> {
  if (!isModelReady(cfg.drafter)) throw new Error("起草模型未配置，请先在面板填好 base_url / api_key / model。");
  const data = new WorkbenchData(store);
  const manifest = data.manifest();
  const targetBlocks = data.blocksForChapter(chapterId);
  if (targetBlocks.length === 0) throw new Error(`章节 ${chapterId} 没有 block，无法起草。`);
  // 目标按章，但背景喂整卷正文，保持连续性。
  const background = volumeSections(data, volumeForChapter(manifest, chapterId));
  const accepted = data.accepted();

  const res = await chat(
    cfg.drafter,
    [
      { role: "system", content: DRAFTER_SYSTEM },
      { role: "user", content: buildDrafterUser(chapterTitle(manifest, chapterId), targetBlocks, background, accepted) },
    ],
    // max_tokens 顶高，避免多候选 JSON 被供应商较低的默认值截断成半截。
    DRAFT_CHAT_OPTIONS,
  );

  const parsed = extractJson<{ candidates?: Rec[] }>(res.text);
  const raw = Array.isArray(parsed.candidates) ? parsed.candidates : [];

  const existing = store.readJsonl<Candidate>(CANDIDATES).rows;
  const mkId = nextSeqId(existing as unknown as Rec[], `cand_${chapterKey(chapterId)}_`);
  const taskId = `task_${chapterKey(chapterId)}_${Date.now().toString(36)}`;
  const firstId = targetBlocks[0]!.id;
  const lastId = targetBlocks[targetBlocks.length - 1]!.id;

  const created: Candidate[] = raw.map((r, i) => {
    const span = (r.source_span as Candidate["source_span"]) ?? {
      start_block: firstId,
      end_block: firstId,
    };
    const payload = (r.payload as Candidate["payload"]) ?? {};
    return {
      id: mkId(i + 1),
      series_id: manifest.series.id,
      type: String(r.type ?? payload.target_type ?? "entity"),
      block_id: span.start_block,
      source_span: span,
      visible_from: String(r.visible_from ?? span.end_block),
      confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
      status: "pending_review",
      model: res.model,
      task_id: taskId,
      payload: {
        target_type: payload.target_type ?? String(r.type ?? "entity"),
        draft: payload.draft ?? {},
        evidence: payload.evidence ?? "",
        risk_flags: payload.risk_flags ?? [],
      },
    };
  });

  store.writeJsonl(CANDIDATES, (existing as unknown as Rec[]).concat(created as unknown as Rec[]));

  appendJsonl(store, WORK_RUNS, [
    {
      id: `work_${chapterKey(chapterId)}_draft_${Date.now().toString(36)}`,
      chapter_id: chapterId,
      stage: "draft",
      start_block: firstId,
      end_block: lastId,
      status: "completed",
      created_candidate_count: created.length,
      drafter_model: res.model,
      request_options: DRAFT_CHAT_OPTIONS,
      context_estimate: { target_blocks: targetBlocks.length, background_blocks: background.flatMap((s) => s.blocks).length },
      ...(tokenUsage(res.usage) ? { token_usage: tokenUsage(res.usage) } : {}),
      created_at: new Date().toISOString(),
    },
  ]);

  return { chapter_id: chapterId, created: created.length, model: res.model, candidates: created };
}

// ----- 复核 -----

export interface ReviewResult {
  chapter_id: string;
  reviewed: number;
  auto_accepted: number;
  escalated: number;
  rejected: number;
  reviewer_model: string;
}

export async function runReview(
  store: FileStore,
  cfg: WorkbenchConfig,
  chapterId: string,
): Promise<ReviewResult> {
  if (!isModelReady(cfg.reviewer)) throw new Error("复核模型未配置，请先在面板填好 base_url / api_key / model。");
  const data = new WorkbenchData(store);
  const manifest = data.manifest();
  const chapterBlockIds = new Set(data.blocksForChapter(chapterId).map((b) => b.id));
  const allCandidates = store.readJsonl<Candidate>(CANDIDATES).rows;
  const pending = allCandidates.filter(
    (c) => c.status === "pending_review" && chapterBlockIds.has(c.source_span.start_block),
  );
  if (pending.length === 0)
    return { chapter_id: chapterId, reviewed: 0, auto_accepted: 0, escalated: 0, rejected: 0, reviewer_model: cfg.reviewer.model };

  // 复核也喂整卷背景，便于核对依据与跨章一致性。
  const background = volumeSections(data, volumeForChapter(manifest, chapterId));
  const accepted = data.accepted();
  const res = await chat(
    cfg.reviewer,
    [
      { role: "system", content: REVIEWER_SYSTEM },
      {
        role: "user",
        content: buildReviewerUser(
          pending.map((c) => ({ id: c.id, type: c.type, source_span: c.source_span as unknown as Rec, payload: c.payload as unknown as Rec })),
          background,
          accepted,
        ),
      },
    ],
    REVIEW_CHAT_OPTIONS,
  );

  const parsed = extractJson<{ decisions?: Rec[] }>(res.text);
  const decisions = new Map<string, Rec>();
  for (const d of parsed.decisions ?? []) decisions.set(String((d as { candidate_id?: string }).candidate_id), d);
  const autoDraftIds = collectAutoDraftIds(pending, decisions);

  const agentStore = new AgentStore(store, manifest.series.id);
  const workRunId = `work_${chapterKey(chapterId)}_review_${Date.now().toString(36)}`;
  const byId = new Map(allCandidates.map((c) => [c.id, c]));

  const reviewItems = store.readJsonl<Rec>(REVIEW_ITEMS).rows;
  const mkReviewId = nextSeqId(reviewItems, `review_${chapterKey(chapterId)}_`);
  const newReviewItems: Rec[] = [];

  let autoAccepted = 0;
  let escalated = 0;
  let rejected = 0;

  pending.forEach((c, i) => {
    const d = decisions.get(c.id);
    const route = String((d as { route?: string })?.route ?? "escalate");
    const reason = String((d as { reason?: string })?.reason ?? "复核未给出理由，默认升级。");
    const target = byId.get(c.id)!;

    if (route === "auto") {
      const edited = (d as { edited_draft?: Rec }).edited_draft;
      const draft = (edited && Object.keys(edited).length ? edited : c.payload.draft) as Rec;
      if (!draft || !draft.id) {
        // 草案不完整，安全起见改为升级。
        newReviewItems.push(buildReviewItem(mkReviewId(escalated + 1), c, "草案缺少 id，复核改判升级。", chapterId, manifest.series.id));
        target.status = "converted_to_review_item";
        escalated += 1;
        return;
      }
      const blockers = autoAcceptBlockers(c.type, draft, accepted, autoDraftIds);
      if (blockers.length) {
        newReviewItems.push(
          buildReviewItem(
            mkReviewId(escalated + 1),
            c,
            `自动写入前校验失败：${blockers.join("；")}。`,
            chapterId,
            manifest.series.id,
            "改后接受或转未决问题",
          ),
        );
        target.status = "converted_to_review_item";
        escalated += 1;
        return;
      }
      agentStore.write(c.type, draft, {
        operation: edited && Object.keys(edited).length ? "accept_candidate_with_edit" : "accept_candidate",
        decidedBy: "reviewer_agent",
        autoAccepted: true,
        approvedBy: res.model,
        reason,
        candidateId: c.id,
        reviewerModel: res.model,
        workRunId,
      });
      target.status = edited && Object.keys(edited).length ? "accepted_with_edit" : "accepted";
      autoAccepted += 1;
    } else if (route === "reject") {
      target.status = "rejected";
      rejected += 1;
    } else {
      const rec = String((d as { recommended_action?: string })?.recommended_action ?? "");
      newReviewItems.push(buildReviewItem(mkReviewId(escalated + 1), c, reason, chapterId, manifest.series.id, rec));
      target.status = "converted_to_review_item";
      escalated += 1;
    }
  });

  store.writeJsonl(CANDIDATES, allCandidates as unknown as Rec[]);
  if (newReviewItems.length) store.writeJsonl(REVIEW_ITEMS, reviewItems.concat(newReviewItems));

  appendJsonl(store, WORK_RUNS, [
    {
      id: workRunId,
      chapter_id: chapterId,
      stage: "review",
      status: "completed",
      auto_accepted_count: autoAccepted,
      escalated_count: escalated,
      rejected_count: rejected,
      drafter_model: pending[0]?.model ?? "",
      reviewer_model: res.model,
      request_options: REVIEW_CHAT_OPTIONS,
      ...(tokenUsage(res.usage) ? { token_usage: tokenUsage(res.usage) } : {}),
      created_at: new Date().toISOString(),
    },
  ]);

  return {
    chapter_id: chapterId,
    reviewed: pending.length,
    auto_accepted: autoAccepted,
    escalated,
    rejected,
    reviewer_model: res.model,
  };
}

function buildReviewItem(
  id: string,
  c: Candidate,
  message: string,
  chapterId: string,
  seriesId: string,
  recommended = "",
): Rec {
  return {
    id,
    series_id: seriesId,
    type: "candidate_escalation",
    status: "open",
    priority: "medium",
    chapter_id: chapterId,
    block_id: c.source_span.start_block,
    source_span: c.source_span,
    candidate_id: c.id,
    candidate_type: c.type,
    message,
    recommended_action: recommended,
    created_by: "reviewer_agent",
    created_at: new Date().toISOString(),
  };
}

// ----- 人工裁决异常队列 -----

export interface ResolveResult {
  review_item_id: string;
  decision: string;
  change_id?: string;
}

export interface ResolveDecision {
  id: string;
  decision: "accept" | "reject" | "open_question";
  editedDraft?: Rec;
  note?: string;
}

/**
 * 批量裁决异常队列：一次读入 review_items / candidates / open_questions，
 * 顺序应用每条决定，最后各文件只写一次。`accept` 走 AgentStore.write（各自落盘），
 * `open_question` 的顺序 ID 在批内累进，避免多条同章撞号。任一项报错则整批抛出（不半写队列文件）。
 */
export function resolveExceptionsBatch(store: FileStore, decisions: ResolveDecision[]): ResolveResult[] {
  const manifest = manifestOf(store);
  const reviewItems = store.readJsonl<Rec>(REVIEW_ITEMS).rows;
  const candidates = store.readJsonl<Candidate>(CANDIDATES).rows;
  const existingOqs = store.readJsonl<Rec>(OPEN_QUESTIONS).rows;
  const agentStore = new AgentStore(store, manifest.series.id);

  const newOqs: Rec[] = [];
  const results: ResolveResult[] = [];

  for (const { id: reviewItemId, decision, editedDraft, note } of decisions) {
    const item = reviewItems.find((r) => (r as { id?: string }).id === reviewItemId);
    if (!item) throw new Error(`找不到异常项：${reviewItemId}`);
    const candId = String((item as { candidate_id?: string }).candidate_id ?? "");
    const candidate = candidates.find((c) => c.id === candId);

    let changeId: string | undefined;

    if (decision === "accept") {
      if (!candidate) throw new Error(`异常项 ${reviewItemId} 关联的候选不存在。`);
      const edited = editedDraft;
      const draft = (edited && Object.keys(edited).length ? edited : candidate.payload.draft) as Rec;
      if (!draft || !draft.id) throw new Error("草案缺少 id，无法接受。");
      const r = agentStore.write(candidate.type, draft, {
        operation: edited && Object.keys(edited).length ? "accept_candidate_with_edit" : "accept_candidate",
        decidedBy: "user",
        autoAccepted: false,
        approvedBy: "user",
        reason: note ?? "人工裁决接受。",
        candidateId: candidate.id,
      });
      changeId = r.changeId;
      candidate.status = edited && Object.keys(edited).length ? "accepted_with_edit" : "accepted";
      (item as Rec).status = "resolved";
    } else if (decision === "reject") {
      if (candidate) candidate.status = "rejected";
      (item as Rec).status = "dismissed";
    } else {
      // 转未决问题；ID 基于已落盘 + 本批已生成的同前缀项累进。
      const prefix = `oq_${chapterKey(String((item as { chapter_id?: string }).chapter_id ?? "v01"))}_`;
      const mkOq = nextSeqId([...existingOqs, ...newOqs], prefix);
      newOqs.push({
        id: mkOq(1),
        series_id: manifest.series.id,
        type: "from_escalation",
        status: "open",
        risk_level: "medium",
        source_span: (item as { source_span?: Rec }).source_span,
        question: note ?? String((item as { message?: string }).message ?? "待确认问题"),
        related_candidate_ids: candId ? [candId] : [],
        related_accepted_ids: [],
        resolution: null,
        resolved_by_change_id: null,
        created_by: "user",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (candidate) candidate.status = "converted_to_open_question";
      (item as Rec).status = "converted_to_open_question";
    }

    results.push({ review_item_id: reviewItemId, decision, change_id: changeId });
  }

  if (newOqs.length) appendJsonl(store, OPEN_QUESTIONS, newOqs);
  store.writeJsonl(CANDIDATES, candidates as unknown as Rec[]);
  store.writeJsonl(REVIEW_ITEMS, reviewItems);
  return results;
}

export function resolveException(
  store: FileStore,
  reviewItemId: string,
  decision: "accept" | "reject" | "open_question",
  opts: { editedDraft?: Rec; note?: string } = {},
): ResolveResult {
  const [result] = resolveExceptionsBatch(store, [
    { id: reviewItemId, decision, editedDraft: opts.editedDraft, note: opts.note },
  ]);
  return result!;
}
