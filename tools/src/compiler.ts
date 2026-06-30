// Compiler: manifest + Parsed JSONL + Accepted JSONL -> compiled/reader_index.json
// (docs/modules/compiled-query.md). The reader index is a regeneratable query
// product, never an authoring source. Compile is gated on a passing validation
// report (§2): if reports/validation_report.json is missing or not `passed`,
// compilation refuses.
import { FileStore } from "./fileStore.js";
import { buildTimeline, type Timeline } from "./timeline.js";
import { ACCEPTED_TYPE_FILES } from "./acceptedTypes.js";
import type {
  Alignment,
  Asset,
  AssetAnchor,
  Block,
  Manifest,
  Scene,
  ValidationReport,
} from "./types.js";

type Rec = Record<string, unknown>;

export interface ReaderIndex {
  schema_version: string;
  series_id: string;
  generated_at: string;
  source_fingerprint: null;
  source_summary: Rec;
  validation_report: { path: string; status: string };
  timeline: Timeline;
  blocks: Record<string, Block>;
  scenes: Record<string, Scene>;
  assets: Record<string, Asset>;
  asset_anchors: Record<string, AssetAnchor>;
  alignments: Record<string, Alignment>;
  accepted: Record<string, Record<string, Rec>>;
  index: {
    by_block: Record<string, BlockIndex>;
    by_scene: Record<string, string[]>;
    by_entity: Record<string, string[]>;
  };
}

export interface BlockIndex {
  scene_id: string | null;
  asset_ids: string[];
  alignment_ids: string[];
  speaker_label_ids: string[];
}

export class CompileError extends Error {}

export class Compiler {
  private readonly store: FileStore;
  constructor(store: FileStore) {
    this.store = store;
  }

  compileReaderIndex(now = new Date().toISOString()): ReaderIndex {
    if (!this.store.exists("reports/validation_report.json"))
      throw new CompileError("缺少 reports/validation_report.json，请先运行 validate。");
    const vr = this.store.readJson<ValidationReport>("reports/validation_report.json");
    if (vr.status !== "passed")
      throw new CompileError(`validation report status=${vr.status}，只有 passed 才允许 compile。`);

    const manifest = this.store.readJson<Manifest>("manifest.json");
    const blocks = this.store.readJsonl<Block>("parsed/blocks.jsonl").rows;
    const scenes = this.store.readJsonl<Scene>("parsed/scenes.jsonl").rows;
    const assets = this.store.readJsonl<Asset>("parsed/assets.jsonl").rows;
    const anchors = this.store.readJsonl<AssetAnchor>("parsed/asset_anchors.jsonl").rows;
    const alignments = this.store.readJsonl<Alignment>("parsed/alignments.jsonl").rows;

    const timeline = buildTimeline(manifest, blocks);

    const blockMap = byId(blocks);
    const sceneMap = byId(scenes);
    const assetMap = byId(assets);
    const anchorMap = byId(anchors);
    const alignmentMap = byId(alignments);

    // accepted objects, keyed by type then id.
    const accepted: Record<string, Record<string, Rec>> = {};
    const acceptedCounts: Record<string, { path: string; count: number }> = {};
    for (const { type, file } of ACCEPTED_TYPE_FILES) {
      const rows = this.store.readJsonl<Rec>(file).rows as Array<Rec & { id: string }>;
      accepted[plural(type)] = byId(rows);
      acceptedCounts[plural(type)] = { path: file, count: rows.length };
    }

    const index = this.buildIndex(blocks, scenes, anchors, alignments, accepted);

    const readerIndex: ReaderIndex = {
      schema_version: "0.1.0",
      series_id: manifest.series.id,
      generated_at: now,
      source_fingerprint: null,
      source_summary: {
        manifest_path: "manifest.json",
        parsed_files: {
          blocks: { path: "parsed/blocks.jsonl", count: blocks.length },
          scenes: { path: "parsed/scenes.jsonl", count: scenes.length },
          assets: { path: "parsed/assets.jsonl", count: assets.length },
          asset_anchors: { path: "parsed/asset_anchors.jsonl", count: anchors.length },
          alignments: { path: "parsed/alignments.jsonl", count: alignments.length },
        },
        accepted_files: acceptedCounts,
      },
      validation_report: { path: "reports/validation_report.json", status: vr.status },
      timeline,
      blocks: blockMap,
      scenes: sceneMap,
      assets: assetMap,
      asset_anchors: anchorMap,
      alignments: alignmentMap,
      accepted,
      index,
    };

    this.store.writeJson("compiled/reader_index.json", readerIndex);
    return readerIndex;
  }

  private buildIndex(
    blocks: Block[],
    scenes: Scene[],
    anchors: AssetAnchor[],
    alignments: Alignment[],
    accepted: Record<string, Record<string, Rec>>,
  ): ReaderIndex["index"] {
    const by_block: Record<string, BlockIndex> = {};
    const ensure = (b: string): BlockIndex =>
      (by_block[b] ??= { scene_id: null, asset_ids: [], alignment_ids: [], speaker_label_ids: [] });
    for (const b of blocks) ensure(b.id);

    // scenes -> by_scene + each block's scene_id (blocks fall in [start,end] order).
    const by_scene: Record<string, string[]> = {};
    const sceneOrder = new Map<string, Block[]>();
    for (const b of blocks) {
      const arr = sceneOrder.get(b.chapter_id) ?? [];
      arr.push(b);
      sceneOrder.set(b.chapter_id, arr);
    }
    for (const s of scenes) {
      const chapterBlocks = (sceneOrder.get(s.chapter_id) ?? []).sort((a, b) => a.order - b.order);
      const members = chapterBlocks.filter(
        (b) => withinByOrder(b, s, chapterBlocks),
      );
      by_scene[s.id] = members.map((b) => b.id);
      for (const b of members) ensure(b.id).scene_id = s.id;
    }
    for (const an of anchors) if (by_block[an.block_id]) ensure(an.block_id).asset_ids.push(an.asset_id);
    for (const al of alignments) for (const zb of al.zh_block_ids) if (by_block[zb]) ensure(zb).alignment_ids.push(al.id);
    for (const sl of Object.values(accepted.speaker_labels ?? {})) {
      const b = sl.block_id as string;
      if (b && by_block[b]) ensure(b).speaker_label_ids.push(sl.id as string);
    }

    // entity -> related accepted object ids (facts/events/relations/etc).
    const by_entity: Record<string, string[]> = {};
    const link = (eid: unknown, oid: unknown) => {
      if (typeof eid !== "string" || typeof oid !== "string") return;
      (by_entity[eid] ??= []).push(oid);
    };
    for (const f of Object.values(accepted.facts ?? {})) link(f.subject_id, f.id);
    for (const e of Object.values(accepted.events ?? {}))
      for (const p of (e.participants as string[]) ?? []) link(p, e.id);
    for (const r of Object.values(accepted.relation_changes ?? {}))
      for (const en of (r.entities as string[]) ?? []) link(en, r.id);
    for (const m of Object.values(accepted.metrics ?? {})) link(m.subject_id, m.id);
    for (const c of Object.values(accepted.character_cards ?? {})) link(c.entity_id, c.id);
    for (const t of Object.values(accepted.term_cards ?? {})) link(t.term_entity_id, t.id);

    return { by_block, by_scene, by_entity };
  }
}

function withinByOrder(b: Block, s: Scene, chapterBlocks: Block[]): boolean {
  if (!s.start_block || !s.end_block) return false;
  const idx = (id: string) => chapterBlocks.findIndex((x) => x.id === id);
  const bi = idx(b.id);
  const si = idx(s.start_block);
  const ei = idx(s.end_block);
  return si >= 0 && ei >= 0 && bi >= si && bi <= ei;
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) out[r.id] = r;
  return out;
}

/** Accepted type -> the plural key used inside reader_index.accepted. */
function plural(type: string): string {
  switch (type) {
    case "entity":
      return "entities";
    case "fact":
      return "facts";
    case "asset_subject":
      return "asset_subjects";
    case "character_card":
      return "character_cards";
    case "term_card":
      return "term_cards";
    case "speaker_label":
      return "speaker_labels";
    case "relation_change":
      return "relation_changes";
    case "metric_change":
      return "metric_changes";
    default:
      return type + "s";
  }
}
