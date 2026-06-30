// Chinese-main-text timeline, shared by Validator and Compiler.
//
// Phase 1 spoiler comparison only recognises positions derived from the
// Chinese body (docs/modules/bookpack-data.md,
// docs/modules/compiled-query.md):
//
//   v01.start  v01.c01.start  v01.c01.b0001  v01.c01.end  v01.end
//
// `visible_from <= read_boundary` is decided by integer order in this list,
// never by string sort. semester_1.end / external:* / manual:* are NOT
// comparable here and must be mapped to a body position before they can drive
// reader queries.
import type { Block, Manifest } from "./types.js";

export type PositionKind =
  | "volume_start"
  | "chapter_start"
  | "block"
  | "chapter_end"
  | "volume_end";

export interface TimelinePosition {
  id: string;
  kind: PositionKind;
  order: number;
}

export interface Timeline {
  positions: TimelinePosition[];
  /** position id -> integer order (0-based, dense). */
  order: Record<string, number>;
}

/**
 * Build the total order over body positions. Volumes follow manifest order;
 * chapters follow manifest `order`; blocks follow their parsed `order` within
 * the chapter. Blocks not declared in the manifest chapter list are skipped
 * (the Validator reports those separately).
 */
export function buildTimeline(manifest: Manifest, blocks: Block[]): Timeline {
  const blocksByChapter = new Map<string, Block[]>();
  for (const b of blocks) {
    const arr = blocksByChapter.get(b.chapter_id) ?? [];
    arr.push(b);
    blocksByChapter.set(b.chapter_id, arr);
  }
  for (const arr of blocksByChapter.values()) arr.sort((a, b) => a.order - b.order);

  const positions: TimelinePosition[] = [];
  const push = (id: string, kind: PositionKind) =>
    positions.push({ id, kind, order: positions.length });

  for (const volume of manifest.volumes) {
    push(`${volume.id}.start`, "volume_start");
    const chapters = [...volume.chapters].sort((a, b) => a.order - b.order);
    for (const chapter of chapters) {
      push(`${chapter.id}.start`, "chapter_start");
      for (const block of blocksByChapter.get(chapter.id) ?? []) {
        push(block.id, "block");
      }
      push(`${chapter.id}.end`, "chapter_end");
    }
    push(`${volume.id}.end`, "volume_end");
  }

  const order: Record<string, number> = {};
  for (const p of positions) order[p.id] = p.order;
  return { positions, order };
}

/** True when `pos` is a comparable body timeline position. */
export function isBodyPosition(timeline: Timeline, pos: string): boolean {
  return Object.prototype.hasOwnProperty.call(timeline.order, pos);
}

/** -1 / 0 / 1 comparison by timeline order; throws if either is non-body. */
export function comparePositions(timeline: Timeline, a: string, b: string): number {
  const oa = timeline.order[a];
  const ob = timeline.order[b];
  if (oa === undefined) throw new Error(`non-timeline position: ${a}`);
  if (ob === undefined) throw new Error(`non-timeline position: ${b}`);
  return oa === ob ? 0 : oa < ob ? -1 : 1;
}

/** True when `visibleFrom <= readBoundary` in timeline order. */
export function isVisible(timeline: Timeline, visibleFrom: string, readBoundary: string): boolean {
  return comparePositions(timeline, visibleFrom, readBoundary) <= 0;
}
