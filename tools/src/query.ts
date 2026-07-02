// getVisibleContext: the reader's single spoiler-safe query entry
// (docs/modules/compiled-query.md).
//
// Hard rule: all enhanced data is filtered by `read_boundary`, never by
// `current_block`. current_block only selects current-position relevance
// (current scene, this block's speaker/assets/ja). A current_block past the
// boundary sets is_ahead_of_boundary but does NOT widen visibility.
import { FileStore } from "./fileStore.js";
import { isVisible, comparePositions, type Timeline } from "./timeline.js";
import type { ReaderIndex } from "./compiler.js";

type Rec = Record<string, unknown>;

export interface VisibleContextOptions {
  includeJa?: boolean;
}

export interface VisibleContext {
  current_block: Rec | null;
  read_boundary: string;
  is_ahead_of_boundary: boolean;
  current_scene: Rec | null;
  speaker_labels: Rec[];
  entities: Rec[];
  facts: Rec[];
  events: Rec[];
  relation_changes: Rec[];
  term_cards: Rec[];
  character_cards: Rec[];
  metric_changes: Rec[];
  assets: Rec[];
  ja_refs: Rec[];
  warnings: string[];
}

export class CompiledQuery {
  private readonly idx: ReaderIndex;
  private readonly timeline: Timeline;

  constructor(index: ReaderIndex) {
    this.idx = index;
    this.timeline = index.timeline;
  }

  static load(store: FileStore): CompiledQuery {
    if (!store.exists("compiled/reader_index.json"))
      throw new Error("compiled/reader_index.json 不存在，请先 compile。");
    return new CompiledQuery(store.readJson<ReaderIndex>("compiled/reader_index.json"));
  }

  private has(pos: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.timeline.order, pos);
  }

  getVisibleContext(
    currentBlock: string,
    readBoundary: string,
    options: VisibleContextOptions = {},
  ): VisibleContext {
    const warnings: string[] = [];
    if (!this.has(readBoundary)) throw new Error(`read_boundary 不是阅读时间线位置：${readBoundary}`);
    if (!this.has(currentBlock)) {
      warnings.push(`current_block 不是阅读时间线位置：${currentBlock}`);
    }

    const isAhead = this.has(currentBlock) && comparePositions(this.timeline, currentBlock, readBoundary) > 0;
    if (isAhead) warnings.push("current_block 已越过 read_boundary，增强数据仍按 read_boundary 过滤。");

    const visible = (vf: unknown): boolean =>
      typeof vf === "string" && this.has(vf) && isVisible(this.timeline, vf, readBoundary);

    const acc = this.idx.accepted;
    const blockInfo = this.idx.index.by_block[currentBlock];

    // current scene + this block's speaker labels / assets / ja.
    const currentScene = blockInfo?.scene_id ? this.idx.scenes[blockInfo.scene_id] ?? null : null;
    const speaker_labels = (blockInfo?.speaker_label_ids ?? [])
      .map((id) => acc.speaker_labels?.[id])
      .filter((s): s is Rec => !!s && visible(s.visible_from));

    const entities = Object.values(acc.entities ?? {}).filter((e) => visible(e.first_seen));
    const facts = Object.values(acc.facts ?? {}).filter((f) => visible(f.visible_from));
    const events = Object.values(acc.events ?? {}).filter((e) => visible(e.visible_from));
    const relation_changes = Object.values(acc.relation_changes ?? {}).filter((r) => visible(r.visible_from));
    const term_cards = Object.values(acc.term_cards ?? {}).filter((t) => visible(t.visible_from));
    const metric_changes = Object.values(acc.metric_changes ?? {}).filter((m) => visible(m.visible_from));

    // character cards: latest visible version per entity before the boundary.
    const character_cards = this.latestCardsPerEntity(Object.values(acc.character_cards ?? {}).filter((c) => visible(c.visible_from)));

    // assets anchored to the current block, with their visible subjects.
    const assets = (blockInfo?.asset_ids ?? []).map((aid) => {
      const asset = this.idx.assets[aid];
      const subjects = Object.values(acc.asset_subjects ?? {}).filter(
        (s) => s.asset_id === aid && visible(s.visible_from),
      );
      return { ...(asset as unknown as Rec), subjects };
    });

    // ja references for the current block (reviewed alignments only).
    let ja_refs: Rec[] = [];
    if (options.includeJa) {
      for (const alId of blockInfo?.alignment_ids ?? []) {
        const al = this.idx.alignments[alId];
        if (al && al.status === "reviewed") ja_refs.push(...(al.ja_refs as unknown as Rec[]));
      }
    }

    return {
      current_block: (this.idx.blocks[currentBlock] as unknown as Rec) ?? null,
      read_boundary: readBoundary,
      is_ahead_of_boundary: isAhead,
      current_scene: (currentScene as unknown as Rec) ?? null,
      speaker_labels,
      entities,
      facts,
      events,
      relation_changes,
      term_cards,
      character_cards,
      metric_changes,
      assets,
      ja_refs,
      warnings,
    };
  }

  private latestCardsPerEntity(cards: Rec[]): Rec[] {
    const best = new Map<string, Rec>();
    for (const c of cards) {
      const entityId = c.entity_id as string;
      const vp = c.version_position as string;
      const prev = best.get(entityId);
      if (!prev || this.orderOf(vp) > this.orderOf(prev.version_position as string)) best.set(entityId, c);
    }
    return [...best.values()];
  }

  private orderOf(pos: string): number {
    return this.timeline.order[pos] ?? -1;
  }
}
