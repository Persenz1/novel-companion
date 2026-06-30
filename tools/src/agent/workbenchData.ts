// 工作台读侧数据：加载 bookpack，按章节组织 block，计算每个 block 身上的"标识"。
//
// "标识"(marker) = 挂在某个 block 上的结构化对象，分三类：
//   已确认 accepted、待复核候选 candidate、异常待裁决 review_item。
// 右侧面板点开一个 block 时，展示它身上有多少标识、分别是什么。
import { FileStore } from "../fileStore.js";
import { ACCEPTED_TYPE_FILES } from "../acceptedTypes.js";
import type { Asset, AssetAnchor, Block, Candidate, Manifest, Scene } from "../types.js";

type Rec = Record<string, unknown>;

/** 类型 -> 中文标签（界面用语尽量中文）。 */
export const TYPE_LABELS: Record<string, string> = {
  entity: "实体",
  fact: "事实",
  event: "事件",
  relation_change: "关系变化",
  metric: "数值",
  metric_change: "数值变化",
  character_card: "角色卡",
  term_card: "术语卡",
  speaker_label: "说话人",
  asset_subject: "图片主体",
  open_question: "未决问题",
  review_item: "复核项",
};

export interface Marker {
  kind: "accepted" | "candidate" | "exception";
  type: string;
  type_label: string;
  id: string;
  title: string; // 一行摘要
  description: string; // 自然语言："这段在设置什么"
  source_span?: { start_block: string; end_block: string };
  status?: string;
  detail: Rec; // 原始对象，前端可展开
}

export interface ChapterSummary {
  id: string;
  order: number;
  kind: string;
  title: string;
  volume_id: string;
  volume_title: string;
  block_count: number;
  accepted_count: number;
  candidate_count: number;
  exception_count: number;
}

export class WorkbenchData {
  private readonly store: FileStore;
  private _manifest?: Manifest;
  private _blocks?: Block[];
  private _order?: Map<string, number>;
  private _accepted?: Map<string, Rec[]>; // type -> rows
  private _candidates?: Candidate[];
  private _reviewItems?: Rec[];

  constructor(store: FileStore) {
    this.store = store;
  }

  manifest(): Manifest {
    return (this._manifest ??= this.store.readJson<Manifest>("manifest.json"));
  }

  blocks(): Block[] {
    return (this._blocks ??= this.store.readJsonl<Block>("parsed/blocks.jsonl").rows);
  }

  scenes(): Scene[] {
    return this.store.readJsonl<Scene>("parsed/scenes.jsonl").rows;
  }

  candidates(): Candidate[] {
    return (this._candidates ??= this.store.readJsonl<Candidate>("candidates/candidates.jsonl").rows);
  }

  reviewItems(): Rec[] {
    return (this._reviewItems ??= this.store.readJsonl<Rec>("review/review_items.jsonl").rows);
  }

  private _assets?: Asset[];
  private _anchors?: AssetAnchor[];
  assetById(id: string): { id: string; path: string | null; alt: string | null } | undefined {
    this._assets ??= this.store.readJsonl<Asset>("parsed/assets.jsonl").rows;
    const a = this._assets.find((x) => x.id === id);
    return a ? { id: a.id, path: a.path, alt: a.alt } : undefined;
  }

  /** 挂在某个 block 上的图片（经 asset_anchor），带可访问 url。 */
  assetsForBlock(blockId: string): Array<{ id: string; alt: string | null; url: string }> {
    this._anchors ??= this.store.readJsonl<AssetAnchor>("parsed/asset_anchors.jsonl").rows;
    const out: Array<{ id: string; alt: string | null; url: string }> = [];
    for (const an of this._anchors) {
      if (an.block_id !== blockId) continue;
      const a = this.assetById(an.asset_id);
      if (a) out.push({ id: a.id, alt: a.alt, url: `/api/asset/${a.id}` });
    }
    return out;
  }

  accepted(): Map<string, Rec[]> {
    if (this._accepted) return this._accepted;
    const m = new Map<string, Rec[]>();
    for (const { type, file } of ACCEPTED_TYPE_FILES) {
      m.set(type, this.store.readJsonl<Rec>(file).rows);
    }
    this._accepted = m;
    return m;
  }

  /** 实体 id -> 名称，用于把 JSON 里的 id 还原成人能读的名字。 */
  private _names?: Map<string, string>;
  private nameOf(id: unknown): string {
    if (typeof id !== "string" || !id) return String(id ?? "");
    if (!this._names) {
      this._names = new Map();
      for (const e of this.accepted().get("entity") ?? []) {
        const eid = (e as { id?: string }).id;
        const name = (e as { name?: string }).name;
        if (eid && name) this._names.set(eid, name);
      }
    }
    return this._names.get(id) ?? id;
  }

  /** 全局阅读顺序：卷顺序 -> manifest 章节顺序 -> 章内 block.order。 */
  private order(): Map<string, number> {
    if (this._order) return this._order;
    const chapterOrder = new Map<string, number>();
    const manifest = this.manifest();
    manifest.volumes.forEach((v, vi) => {
      for (const ch of v.chapters) chapterOrder.set(ch.id, vi * 100000 + ch.order * 1000);
    });
    const sorted = [...this.blocks()].sort((a, b) => {
      const ca = chapterOrder.get(a.chapter_id) ?? 0;
      const cb = chapterOrder.get(b.chapter_id) ?? 0;
      return ca - cb || a.order - b.order;
    });
    const map = new Map<string, number>();
    sorted.forEach((b, i) => map.set(b.id, i));
    this._order = map;
    return map;
  }

  private covers(span: { start_block?: unknown; end_block?: unknown } | undefined, blockId: string): boolean {
    if (!span) return false;
    const order = this.order();
    const bi = order.get(blockId);
    const si = order.get(String(span.start_block));
    const ei = order.get(String(span.end_block));
    if (bi === undefined || si === undefined || ei === undefined) return false;
    return bi >= Math.min(si, ei) && bi <= Math.max(si, ei);
  }

  chapters(): ChapterSummary[] {
    const manifest = this.manifest();
    const blocks = this.blocks();
    const out: ChapterSummary[] = [];
    for (const v of manifest.volumes) {
      for (const ch of v.chapters) {
        const chapterBlocks = blocks.filter((b) => b.chapter_id === ch.id);
        let acc = 0;
        let cand = 0;
        let exc = 0;
        for (const b of chapterBlocks) {
          const m = this.markersForBlock(b.id);
          acc += m.filter((x) => x.kind === "accepted").length;
          cand += m.filter((x) => x.kind === "candidate").length;
          exc += m.filter((x) => x.kind === "exception").length;
        }
        out.push({
          id: ch.id,
          order: ch.order,
          kind: ch.kind,
          title: ch.title,
          volume_id: v.id,
          volume_title: v.title,
          block_count: chapterBlocks.length,
          accepted_count: acc,
          candidate_count: cand,
          exception_count: exc,
        });
      }
    }
    return out;
  }

  blocksForChapter(chapterId: string): Block[] {
    return this.blocks()
      .filter((b) => b.chapter_id === chapterId)
      .sort((a, b) => a.order - b.order);
  }

  /** 计算某个 block 身上的全部标识。 */
  markersForBlock(blockId: string): Marker[] {
    const markers: Marker[] = [];

    for (const [type, rows] of this.accepted()) {
      for (const r of rows) {
        const id = String((r as { id?: string }).id ?? "");
        if (!id) continue;
        let attached = false;
        if (type === "speaker_label") attached = (r as { block_id?: string }).block_id === blockId;
        else attached = this.covers((r as { source_span?: Rec }).source_span as never, blockId);
        if (!attached) continue;
        markers.push({
          kind: "accepted",
          type,
          type_label: TYPE_LABELS[type] ?? type,
          id,
          title: acceptedTitle(type, r),
          description: describe(type, r, (x) => this.nameOf(x)),
          source_span: (r as { source_span?: { start_block: string; end_block: string } }).source_span,
          status: String((r as { status?: string }).status ?? "accepted"),
          detail: r,
        });
      }
    }

    for (const c of this.candidates()) {
      if (c.status !== "pending_review") continue;
      if (!this.covers(c.source_span, blockId)) continue;
      markers.push({
        kind: "candidate",
        type: c.type,
        type_label: TYPE_LABELS[c.type] ?? c.type,
        id: c.id,
        title: candidateTitle(c),
        description: describe(c.type, { id: c.id, ...((c.payload?.draft ?? {}) as Rec) }, (x) => this.nameOf(x)),
        source_span: c.source_span,
        status: c.status,
        detail: c as unknown as Rec,
      });
    }

    for (const ri of this.reviewItems()) {
      if ((ri as { status?: string }).status !== "open") continue;
      const onBlock =
        (ri as { block_id?: string }).block_id === blockId ||
        this.covers((ri as { source_span?: Rec }).source_span as never, blockId);
      if (!onBlock) continue;
      markers.push({
        kind: "exception",
        type: "review_item",
        type_label: "异常待裁决",
        id: String((ri as { id?: string }).id ?? ""),
        title: String((ri as { message?: string }).message ?? "需要人工裁决"),
        description: String((ri as { message?: string }).message ?? "需要人工裁决"),
        source_span: (ri as { source_span?: { start_block: string; end_block: string } }).source_span,
        status: "open",
        detail: ri,
      });
    }

    return markers;
  }
}

function acceptedTitle(type: string, r: Rec): string {
  switch (type) {
    case "entity":
      return `${r.name ?? r.id}`;
    case "fact":
      return `${r.subject_id ?? ""} · ${r.predicate ?? ""} = ${r.value ?? ""}`;
    case "event":
      return `${r.title ?? r.id}`;
    case "relation_change":
      return `${(r.entities as string[] | undefined)?.join(" ↔ ") ?? r.id}`;
    case "metric":
      return `${r.name ?? r.id}`;
    case "metric_change":
      return `${r.metric_id ?? r.id}：${r.old_value ?? "?"} → ${r.new_value ?? "?"}`;
    case "character_card":
      return `角色卡 · ${r.entity_id ?? r.id}`;
    case "term_card":
      return `${r.title ?? r.id}`;
    case "speaker_label":
      return `说话人 · ${r.display_name ?? r.speaker_entity_id ?? r.speaker_type ?? ""}`;
    case "asset_subject":
      return `图片主体 · ${r.entity_id ?? r.id}`;
    default:
      return String(r.id ?? "");
  }
}

function candidateTitle(c: Candidate): string {
  const draft = (c.payload?.draft ?? {}) as Rec;
  return acceptedTitle(c.type, { id: c.id, ...draft });
}

const ENT_TYPE: Record<string, string> = {
  character: "人物",
  organization: "组织",
  location: "地点",
  term: "术语",
  group: "群体",
  worldbuilding: "设定",
  event_concept: "概念",
};
const IMPORTANCE: Record<string, string> = { critical: "关键", major: "重要", minor: "次要", background: "背景" };
const SPEAKER_TYPE: Record<string, string> = {
  entity: "具体角色",
  narrator: "旁白",
  unknown: "未知",
  group: "群体",
  system: "系统",
  ambiguous: "歧义（待定）",
};

/** 把一个结构化对象映射成一句"这段在设置什么"的中文，nameOf 把实体 id 还原成名字。 */
function describe(type: string, o: Rec, nameOf: (id: unknown) => string): string {
  const s = (v: unknown) => String(v ?? "");
  switch (type) {
    case "entity": {
      const t = ENT_TYPE[s(o.type)] ?? s(o.type);
      const al = (o.aliases as string[])?.length ? `，别名：${(o.aliases as string[]).join("、")}` : "";
      return `登记实体「${o.name}」（${t}）${al}，首次出现于 ${s(o.first_seen)}。`;
    }
    case "fact": {
      const val = o.value_entity_id ? nameOf(o.value_entity_id) : s(o.value);
      return `记录事实：${nameOf(o.subject_id)} 的「${s(o.predicate)}」是「${val}」（自 ${s(o.valid_from || o.visible_from)} 起）。`;
    }
    case "event": {
      const parts = (o.participants as string[])?.map(nameOf).join("、") ?? "";
      const imp = IMPORTANCE[s(o.importance)] ?? s(o.importance);
      return `事件：${o.title}。${o.summary ? s(o.summary) : ""}${parts ? ` 参与者：${parts}。` : ""}${imp ? ` 重要度：${imp}。` : ""}`;
    }
    case "relation_change": {
      const ents = (o.entities as string[])?.map(nameOf).join(" 与 ") ?? "";
      return `关系变化：${ents}——由「${s(o.before)}」变为「${s(o.after)}」。`;
    }
    case "metric":
      return `数值项：${nameOf(o.subject_id)} 的「${o.name}」${o.unit ? `（单位 ${s(o.unit)}）` : ""}。`;
    case "metric_change":
      return `数值变化：${nameOf(o.metric_id) || s(o.metric_id)} 从 ${s(o.old_value)} 变为 ${s(o.new_value)}${o.reason ? `，原因：${s(o.reason)}` : ""}。`;
    case "character_card":
      return `角色卡（${s(o.version_position)}）：${s(o.short_summary)}`;
    case "term_card":
      return `术语卡「${o.title}」：${s(o.summary)}`;
    case "speaker_label": {
      const who = s(o.display_name) || nameOf(o.speaker_entity_id) || SPEAKER_TYPE[s(o.speaker_type)] || s(o.speaker_type);
      return `说话人标注：本段台词由「${who}」所说。`;
    }
    case "asset_subject":
      return `图片主体：图中为 ${nameOf(o.entity_id)}${o.role ? `（${s(o.role)}）` : ""}。`;
    default:
      return "";
  }
}
