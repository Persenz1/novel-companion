// 双 AI 流水线编排：起草 -> 复核 -> 自动落盘 / 升级 / 拒绝，外加人工裁决异常队列。
//
// 起草 Agent 写候选；复核 Agent 独立路由；低风险自动写 Accepted（带可回滚 Change），
// 高风险升级成异常队列里的 ReviewItem 交人裁决。详见
// docs/modules/ai-workbench.md。
import { FileStore } from "../fileStore.js";
import type { Block, Candidate, Manifest, ManifestVolume } from "../types.js";
import type { WorkbenchConfig } from "./config.js";
import { isModelReady } from "./config.js";
import { chat, parseJsonlLoose, type ChatMessage } from "./llm.js";
import { AgentStore } from "./agentStore.js";
import { WorkbenchData } from "./workbenchData.js";
import {
  GENERIC_SYSTEM,
  DRAFT_PASSES,
  DRAFT_PASS_IDS,
  buildVolumePrefix,
  buildDraftTail,
  buildSpeakerRetryTail,
  buildContinueMessage,
  buildReviewTail,
  renderAcceptedMemory,
  type ChapterSection,
  type DraftPassId,
  type DraftWindowMeta,
  type ReviewCandidateView,
} from "./prompts.js";
import { isBodyChapterKind } from "../chapterKind.js";

export type { DraftPassId };
export { DRAFT_PASS_IDS };

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

/** 整卷正文按 manifest 章节顺序分段（作为完整背景），空章节跳过。 */
function volumeSections(data: WorkbenchData, volume: ManifestVolume): ChapterSection[] {
  return volume.chapters
    .filter((ch) => isBodyChapterKind(ch.kind))
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

// ----- 起草 v2：分 pass + 窗口（docs/modules/drafting-review-v2-design.md） -----

/** 稀疏抽取 pass 的窗口目标 block 数；说话人 pass 的窗口目标 dialogue 块数。 */
const SPARSE_WINDOW_TARGET = 250;
const SPEAKER_WINDOW_TARGET = 80;
/** 截断续写的最大轮数。 */
const MAX_CONTINUATIONS = 2;
/** 说话人覆盖缺口的最大补跑轮数（每轮只补上一轮仍缺的块，无进展则提前停止）。 */
const SPEAKER_MISSING_RETRY_ROUNDS = 3;

/** blockId（v01.c22.b0058）所属章节 id（v01.c22）。 */
function chapterOfBlock(blockId: string): string {
  return blockId.split(".").slice(0, -1).join(".");
}

export interface WindowOptions {
  /** 目标计数：countDialogueOnly 时按 dialogue 块计，否则按全部块计。 */
  target: number;
  countDialogueOnly?: boolean;
}

/**
 * 把整卷正文顺序切成连续窗口：达到目标量 80% 后遇 separator 或章节边界即切，
 * 硬上限 140% 强制切。输出预算因此与文本量线性，不再随章节长短失衡。
 */
export function buildDraftWindows(blocks: Block[], opts: WindowOptions): Block[][] {
  const soft = Math.max(1, Math.floor(opts.target * 0.8));
  const hard = Math.max(soft, Math.ceil(opts.target * 1.4));
  const windows: Block[][] = [];
  let cur: Block[] = [];
  let count = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    cur.push(b);
    if (!opts.countDialogueOnly || b.kind === "dialogue") count += 1;

    const next = blocks[i + 1];
    const atBoundary = b.kind === "separator" || !next || next.chapter_id !== b.chapter_id;
    if ((count >= soft && atBoundary) || count >= hard) {
      windows.push(cur);
      cur = [];
      count = 0;
    }
  }
  if (cur.length) {
    // 尾窗过小则并入上一窗，避免碎窗。
    if (count < soft / 2 && windows.length) windows[windows.length - 1]!.push(...cur);
    else windows.push(cur);
  }
  return windows;
}

/** 窗口内 block 引用归一化：短 id（b0058）在窗口内唯一可展开则展开。 */
function makeRefNormalizer(windowBlocks: Block[], volumeBlockIds: Set<string>) {
  const bySuffix = new Map<string, string | null>();
  for (const b of windowBlocks) {
    const suffix = b.id.split(".").pop()!;
    bySuffix.set(suffix, bySuffix.has(suffix) ? null : b.id);
  }
  return (ref: unknown, fallback: string): string => {
    const raw = String(ref ?? "").trim();
    if (volumeBlockIds.has(raw)) return raw;
    const expanded = bySuffix.get(raw);
    if (expanded) return expanded;
    return fallback;
  };
}

function sumUsage(usages: Array<Rec | undefined>): Rec | undefined {
  const merged: Rec = {};
  for (const u of usages) {
    if (!u) continue;
    for (const [k, v] of Object.entries(u)) {
      if (typeof v === "number") merged[k] = ((merged[k] as number) ?? 0) + v;
    }
  }
  if (typeof merged.prompt_cache_hit_tokens === "number" && typeof merged.prompt_cache_miss_tokens === "number") {
    const total = (merged.prompt_cache_hit_tokens as number) + (merged.prompt_cache_miss_tokens as number);
    if (total > 0) merged.prompt_cache_hit_ratio = Number(((merged.prompt_cache_hit_tokens as number) / total).toFixed(4));
  }
  return Object.keys(merged).length ? merged : undefined;
}

interface JsonlChatOutcome {
  rows: Rec[];
  badLines: number;
  model: string;
  usage?: Rec;
  truncated: boolean;
}

/**
 * 一次 JSONL 会话：prefix+tail 拼成单条 user 消息（prefix 稳定在前，命中前缀缓存），
 * finish_reason=length 时自动续写，行结果合并。
 */
async function chatJsonl(
  modelCfg: WorkbenchConfig["drafter"],
  prefix: string,
  tail: string,
  options: typeof DRAFT_CHAT_OPTIONS | typeof REVIEW_CHAT_OPTIONS,
): Promise<JsonlChatOutcome> {
  const messages: ChatMessage[] = [
    { role: "system", content: GENERIC_SYSTEM },
    { role: "user", content: prefix + tail },
  ];
  const usages: Array<Rec | undefined> = [];
  let rows: Rec[] = [];
  let badLines = 0;
  let truncated = false;
  let model = modelCfg.model;

  for (let round = 0; ; round++) {
    const res = await chat(modelCfg, messages, options);
    model = res.model;
    usages.push(tokenUsage(res.usage));
    const parsed = parseJsonlLoose<Rec>(res.text);
    rows = rows.concat(parsed.rows);
    badLines += parsed.badLines;
    if (res.finishReason !== "length") break;
    if (round >= MAX_CONTINUATIONS) {
      truncated = true;
      break;
    }
    messages.push({ role: "assistant", content: res.text });
    messages.push({ role: "user", content: buildContinueMessage(rows.length) });
  }
  return { rows, badLines, model, usage: sumUsage(usages), truncated };
}

export interface DraftPassResult {
  volume_id: string;
  pass: DraftPassId;
  windows: number;
  created: number;
  bad_lines: number;
  model: string;
  /** speakers pass：unknown 判定数（满足覆盖但不建候选）与补漏后仍缺的对话块数。 */
  speaker_unknown?: number;
  speaker_missing?: number;
}

export async function runDraftPass(
  store: FileStore,
  cfg: WorkbenchConfig,
  volumeId: string,
  passId: DraftPassId,
): Promise<DraftPassResult> {
  if (!isModelReady(cfg.drafter)) throw new Error("起草模型未配置，请先在面板填好 base_url / api_key / model。");
  const spec = DRAFT_PASSES[passId];
  if (!spec) throw new Error(`未知起草 pass：${passId}（可选 ${DRAFT_PASS_IDS.join("/")}）`);

  const data = new WorkbenchData(store);
  const manifest = data.manifest();
  const volume = manifest.volumes.find((v) => v.id === volumeId);
  if (!volume) throw new Error(`找不到卷：${volumeId}`);
  const sections = volumeSections(data, volume);
  const volBlocks = sections.flatMap((s) => s.blocks);
  if (volBlocks.length === 0) throw new Error(`卷 ${volumeId} 没有正文 block。`);

  const accepted = data.accepted();
  const prefix = buildVolumePrefix(volume.title, sections, renderAcceptedMemory(accepted));
  const volumeBlockIds = new Set(volBlocks.map((b) => b.id));

  const windows =
    passId === "entities"
      ? [volBlocks]
      : passId === "speakers"
        ? buildDraftWindows(volBlocks, { target: SPEAKER_WINDOW_TARGET, countDialogueOnly: true }).filter((w) =>
            w.some((b) => b.kind === "dialogue"),
          )
        : buildDraftWindows(volBlocks, { target: SPARSE_WINDOW_TARGET });

  const existing = store.readJsonl<Candidate>(CANDIDATES).rows;
  const mkId = nextSeqId(existing as unknown as Rec[], `cand_${volumeId}_${passId}_`);
  const taskId = `task_${volumeId}_${passId}_${Date.now().toString(36)}`;
  const created: Candidate[] = [];
  let badLines = 0;
  let unknownTotal = 0;
  let missingTotal = 0;
  let lastModel = cfg.drafter.model;
  let seq = 0;

  const allowedTypes = new Set(spec.types);
  // 逐窗口落盘：单窗失败（如供应商临时 503）不丢已完成窗口的候选与 work_run，
  // 重跑同一 pass 前建议先清掉本卷本 pass 的旧候选（参考 drafting-review-v2-design.md）。
  let persisted = existing as unknown as Rec[];

  for (let wi = 0; wi < windows.length; wi++) {
    const win = windows[wi]!;
    const normalizeRef = makeRefNormalizer(win, volumeBlockIds);
    const dialogueIds = win.filter((b) => b.kind === "dialogue").map((b) => b.id);
    const meta: DraftWindowMeta = {
      startBlock: win[0]!.id,
      endBlock: win[win.length - 1]!.id,
      blockCount: win.length,
      dialogueCount: dialogueIds.length,
      windowIndex: wi + 1,
      windowTotal: windows.length,
    };

    let outcome: JsonlChatOutcome;
    try {
      outcome = await chatJsonl(cfg.drafter, prefix, buildDraftTail(spec, meta), DRAFT_CHAT_OPTIONS);
    } catch (err) {
      appendJsonl(store, WORK_RUNS, [
        {
          id: `work_${volumeId}_${passId}_w${wi + 1}_${Date.now().toString(36)}`,
          volume_id: volumeId,
          pass: passId,
          stage: "draft",
          window_index: wi + 1,
          window_total: windows.length,
          start_block: meta.startBlock,
          end_block: meta.endBlock,
          status: "failed",
          error: (err as Error).message,
          created_at: new Date().toISOString(),
        },
      ]);
      throw new Error(
        `${volumeId}/${passId} 第 ${wi + 1}/${windows.length} 窗失败：${(err as Error).message}（此前 ${wi} 窗已落盘，无需重跑）`,
      );
    }
    lastModel = outcome.model;
    badLines += outcome.badLines;
    let rows = outcome.rows;
    let windowUnknown = 0;
    let windowMissing: string[] = [];

    if (passId === "speakers") {
      // 全覆盖契约：缺判定的对话块循环补跑，直到补齐或连续两轮无进展（如模型放弃整段）才记入覆盖缺口。
      const judgedIds = () => new Set(rows.map((r) => normalizeRef(r.block_id, "")).filter(Boolean));
      windowMissing = dialogueIds.filter((id) => !judgedIds().has(id));
      for (let r = 0; r < SPEAKER_MISSING_RETRY_ROUNDS && windowMissing.length; r++) {
        const before = windowMissing.length;
        let retry: JsonlChatOutcome;
        try {
          retry = await chatJsonl(cfg.drafter, prefix, buildSpeakerRetryTail(windowMissing), DRAFT_CHAT_OPTIONS);
        } catch {
          break; // 补跑请求失败（如临时 503）：保留本窗已判定的部分，记为覆盖缺口，不影响其它窗口。
        }
        badLines += retry.badLines;
        rows = rows.concat(retry.rows);
        windowMissing = dialogueIds.filter((id) => !judgedIds().has(id));
        if (windowMissing.length >= before) break; // 无进展，模型对这些块给不出判定，停止重试。
      }
      missingTotal += windowMissing.length;
    }

    const windowCreated: Candidate[] = [];
    const dialogueIdSet = new Set(dialogueIds);
    const seenSpeakerBlocks = new Set<string>();

    for (const r of rows) {
      if (passId === "speakers") {
        const blockId = normalizeRef(r.block_id, "");
        if (!blockId || !dialogueIdSet.has(blockId) || seenSpeakerBlocks.has(blockId)) continue;
        seenSpeakerBlocks.add(blockId);
        const speakerType = String(r.speaker_type ?? "unknown");
        if (speakerType === "unknown") {
          windowUnknown += 1;
          continue; // 满足覆盖即可，unknown 不进候选。
        }
        seq += 1;
        const draft: Rec = {
          id: `speaker_${blockId.replace(/[.]/g, "_")}`,
          series_id: manifest.series.id,
          block_id: blockId,
          speaker_type: speakerType,
          ...(r.speaker_entity_id ? { speaker_entity_id: String(r.speaker_entity_id) } : {}),
          display_name: String(r.display_name ?? ""),
          confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
          visible_from: blockId,
          source_span: { start_block: blockId, end_block: blockId },
          status: "accepted",
        };
        windowCreated.push({
          id: mkId(seq),
          series_id: manifest.series.id,
          type: "speaker_label",
          pass: passId,
          block_id: blockId,
          source_span: { start_block: blockId, end_block: blockId },
          visible_from: blockId,
          confidence: draft.confidence as number,
          status: "pending_review",
          model: outcome.model,
          task_id: taskId,
          payload: { target_type: "speaker_label", draft, evidence: String(r.evidence ?? ""), risk_flags: [] },
        });
        continue;
      }

      // 稀疏 pass：候选行 {type, source_span, visible_from, confidence, draft, evidence, risk_flags}
      const type = String(r.type ?? "");
      if (!allowedTypes.has(type)) continue;
      const rawSpan = (r.source_span as { start_block?: unknown; end_block?: unknown }) ?? {};
      const start = normalizeRef(rawSpan.start_block, meta.startBlock);
      const end = normalizeRef(rawSpan.end_block, start);
      const draft = (r.draft as Rec) ?? {};
      if (draft.series_id == null) draft.series_id = manifest.series.id;
      if (draft.status == null) draft.status = "accepted";
      seq += 1;
      windowCreated.push({
        id: mkId(seq),
        series_id: manifest.series.id,
        type,
        pass: passId,
        block_id: start,
        source_span: { start_block: start, end_block: end },
        visible_from: normalizeRef(r.visible_from, end),
        confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
        status: "pending_review",
        model: outcome.model,
        task_id: taskId,
        payload: {
          target_type: type,
          draft,
          evidence: String(r.evidence ?? ""),
          risk_flags: Array.isArray(r.risk_flags) ? (r.risk_flags as string[]) : [],
        },
      });
    }

    unknownTotal += windowUnknown;
    created.push(...windowCreated);

    // 逐窗口落盘：本窗完成即写，后续窗口若失败不影响已完成窗口的结果。
    persisted = persisted.concat(windowCreated as unknown as Rec[]);
    store.writeJsonl(CANDIDATES, persisted);
    appendJsonl(store, WORK_RUNS, [
      {
        id: `work_${volumeId}_${passId}_w${wi + 1}_${Date.now().toString(36)}`,
        volume_id: volumeId,
        pass: passId,
        stage: "draft",
        window_index: wi + 1,
        window_total: windows.length,
        start_block: meta.startBlock,
        end_block: meta.endBlock,
        status: "completed",
        created_candidate_count: windowCreated.length,
        bad_lines: outcome.badLines,
        ...(outcome.truncated ? { truncated: true } : {}),
        ...(passId === "speakers"
          ? { dialogue_blocks: dialogueIds.length, unknown_count: windowUnknown, missing_ids: windowMissing }
          : {}),
        drafter_model: outcome.model,
        request_options: DRAFT_CHAT_OPTIONS,
        context_estimate: { window_blocks: win.length, volume_blocks: volBlocks.length },
        ...(outcome.usage ? { token_usage: outcome.usage } : {}),
        created_at: new Date().toISOString(),
      },
    ]);
  }

  return {
    volume_id: volumeId,
    pass: passId,
    windows: windows.length,
    created: created.length,
    bad_lines: badLines,
    model: lastModel,
    ...(passId === "speakers" ? { speaker_unknown: unknownTotal, speaker_missing: missingTotal } : {}),
  };
}

// ----- 复核 -----

// ----- 复核 v2：按 pass 分批 + 专用 checklist + 高风险代码级强制升级 -----

const SPARSE_REVIEW_BATCH = 25;
const SPEAKER_REVIEW_BATCH = 60;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** 高风险类别代码级强制升级（不依赖复核模型自觉）。返回升级原因，null 表示不强制。 */
function forcedEscalation(c: Candidate, draft: Rec): string | null {
  if (c.type === "relation_change") return "高风险类别（关系变化）按硬约束升级人裁决";
  if (c.type === "speaker_label" && draft.speaker_type === "ambiguous") return "歧义说话人按硬约束升级人裁决";
  return null;
}

export interface ReviewPassResult {
  volume_id: string;
  pass: DraftPassId;
  reviewed: number;
  auto_accepted: number;
  escalated: number;
  rejected: number;
  batches: number;
  reviewer_model: string;
}

export async function runReviewPass(
  store: FileStore,
  cfg: WorkbenchConfig,
  volumeId: string,
  passId: DraftPassId,
): Promise<ReviewPassResult> {
  if (!isModelReady(cfg.reviewer)) throw new Error("复核模型未配置，请先在面板填好 base_url / api_key / model。");
  const spec = DRAFT_PASSES[passId];
  if (!spec) throw new Error(`未知复核 pass：${passId}（可选 ${DRAFT_PASS_IDS.join("/")}）`);

  const data = new WorkbenchData(store);
  const manifest = data.manifest();
  const volume = manifest.volumes.find((v) => v.id === volumeId);
  if (!volume) throw new Error(`找不到卷：${volumeId}`);

  const allCandidates = store.readJsonl<Candidate>(CANDIDATES).rows;
  const typeSet = new Set(spec.types);
  const pending = allCandidates.filter(
    (c) =>
      c.status === "pending_review" &&
      String(c.source_span.start_block).startsWith(`${volumeId}.`) &&
      (c.pass ? c.pass === passId : typeSet.has(c.type)),
  );
  if (pending.length === 0)
    return { volume_id: volumeId, pass: passId, reviewed: 0, auto_accepted: 0, escalated: 0, rejected: 0, batches: 0, reviewer_model: cfg.reviewer.model };

  // 复核共享同一稳定前缀（全卷正文 + 已确认记忆），批间命中缓存。
  const sections = volumeSections(data, volume);
  const accepted = data.accepted();
  const prefix = buildVolumePrefix(volume.title, sections, renderAcceptedMemory(accepted));

  const agentStore = new AgentStore(store, manifest.series.id);
  const reviewItems = store.readJsonl<Rec>(REVIEW_ITEMS).rows;
  const mkReviewId = nextSeqId(reviewItems, `review_${volumeId}_${passId}_`);
  const newReviewItems: Rec[] = [];

  let autoAccepted = 0;
  let escalated = 0;
  let rejected = 0;
  let reviewerModel = cfg.reviewer.model;

  const batches = chunk(pending, passId === "speakers" ? SPEAKER_REVIEW_BATCH : SPARSE_REVIEW_BATCH);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]!;
    const views: ReviewCandidateView[] = batch.map((c) => ({
      candidate_id: c.id,
      type: c.type,
      source_span: c.source_span as unknown as Rec,
      draft: c.payload.draft,
      evidence: c.payload.evidence,
    }));

    let outcome: JsonlChatOutcome;
    try {
      outcome = await chatJsonl(cfg.reviewer, prefix, buildReviewTail(passId, views), REVIEW_CHAT_OPTIONS);
    } catch (err) {
      appendJsonl(store, WORK_RUNS, [
        {
          id: `work_${volumeId}_${passId}_review_b${bi + 1}_${Date.now().toString(36)}`,
          volume_id: volumeId,
          pass: passId,
          stage: "review",
          batch_index: bi + 1,
          batch_total: batches.length,
          status: "failed",
          error: (err as Error).message,
          created_at: new Date().toISOString(),
        },
      ]);
      throw new Error(
        `${volumeId}/${passId} 复核第 ${bi + 1}/${batches.length} 批失败：${(err as Error).message}（此前 ${bi} 批已落盘，无需重跑）`,
      );
    }
    reviewerModel = outcome.model;
    const decisions = new Map<string, Rec>();
    for (const d of outcome.rows) decisions.set(String(d.candidate_id ?? ""), d);
    const autoDraftIds = collectAutoDraftIds(batch, decisions);
    const workRunId = `work_${volumeId}_${passId}_review_b${bi + 1}_${Date.now().toString(36)}`;

    for (const c of batch) {
      const d = decisions.get(c.id);
      let route = String((d as { route?: string })?.route ?? "escalate");
      let reason = String((d as { reason?: string })?.reason ?? "复核未给出决定，默认升级。");
      const chapterId = chapterOfBlock(c.source_span.start_block);
      const edited = (d as { edited_draft?: Rec })?.edited_draft;
      const draft = (edited && Object.keys(edited).length ? edited : c.payload.draft) as Rec;

      const forced = draft ? forcedEscalation(c, draft) : null;
      if (route === "auto" && forced) {
        route = "escalate";
        reason = `${forced}。复核意见：${reason}`;
      }

      if (route === "auto") {
        if (!draft || !draft.id) {
          newReviewItems.push(buildReviewItem(mkReviewId(newReviewItems.length + 1), c, "草案缺少 id，复核改判升级。", chapterId, manifest.series.id));
          c.status = "converted_to_review_item";
          escalated += 1;
          continue;
        }
        const blockers = autoAcceptBlockers(c.type, draft, accepted, autoDraftIds);
        if (blockers.length) {
          newReviewItems.push(
            buildReviewItem(
              mkReviewId(newReviewItems.length + 1),
              c,
              `自动写入前校验失败：${blockers.join("；")}。`,
              chapterId,
              manifest.series.id,
              "改后接受或转未决问题",
            ),
          );
          c.status = "converted_to_review_item";
          escalated += 1;
          continue;
        }
        agentStore.write(c.type, draft, {
          operation: edited && Object.keys(edited).length ? "accept_candidate_with_edit" : "accept_candidate",
          decidedBy: "reviewer_agent",
          autoAccepted: true,
          approvedBy: outcome.model,
          reason,
          candidateId: c.id,
          reviewerModel: outcome.model,
          workRunId,
        });
        c.status = edited && Object.keys(edited).length ? "accepted_with_edit" : "accepted";
        autoAccepted += 1;
      } else if (route === "reject") {
        c.status = "rejected";
        rejected += 1;
      } else {
        const rec = String((d as { recommended_action?: string })?.recommended_action ?? "");
        newReviewItems.push(buildReviewItem(mkReviewId(newReviewItems.length + 1), c, reason, chapterId, manifest.series.id, rec));
        c.status = "converted_to_review_item";
        escalated += 1;
      }
    }

    // 逐批落盘：本批完成即写候选状态/异常队列/work_run，后续批次若失败不丢已完成批次的结果。
    store.writeJsonl(CANDIDATES, allCandidates as unknown as Rec[]);
    if (newReviewItems.length) store.writeJsonl(REVIEW_ITEMS, reviewItems.concat(newReviewItems));
    appendJsonl(store, WORK_RUNS, [
      {
        id: workRunId,
        volume_id: volumeId,
        pass: passId,
        stage: "review",
        batch_index: bi + 1,
        batch_total: batches.length,
        status: "completed",
        reviewed_count: batch.length,
        bad_lines: outcome.badLines,
        ...(outcome.truncated ? { truncated: true } : {}),
        drafter_model: batch[0]?.model ?? "",
        reviewer_model: outcome.model,
        request_options: REVIEW_CHAT_OPTIONS,
        ...(outcome.usage ? { token_usage: outcome.usage } : {}),
        created_at: new Date().toISOString(),
      },
    ]);
  }

  return {
    volume_id: volumeId,
    pass: passId,
    reviewed: pending.length,
    auto_accepted: autoAccepted,
    escalated,
    rejected,
    batches: batches.length,
    reviewer_model: reviewerModel,
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
