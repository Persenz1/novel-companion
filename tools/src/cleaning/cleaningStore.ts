// Cleaning change log + snapshot-based rollback, shared by the normalizer and
// the suggestion applier. Every cleaning write goes through commitVolumeChange
// so that: (1) a Markdown snapshot is taken before the edit, (2) the bookpack is
// reparsed + revalidated after, (3) a failed validation auto-rolls-back, and
// (4) an auditable, reversible change record is appended.
//
// Cleaning only touches Markdown/manifest/assets/parsed/reports/review; it never
// writes the story-graph accepted/candidates. The change log lives under
// accepted/cleaning_changes.jsonl (cleaning is a pre-draft, auditable stage).
import { FileStore } from "../fileStore.js";
import { Parser } from "../parser.js";
import { Validator } from "../validator.js";
import type { Manifest, ValidationReport } from "../types.js";

export const CLEANING_CHANGES = "accepted/cleaning_changes.jsonl";
export const CLEANING_ITEMS = "review/cleaning_items.jsonl";
export const SNAPSHOT_DIR = "reports/cleaning_snapshots";

export type CleaningSuggestionType =
  | "set_asset_alt"
  | "move_asset_anchor"
  | "set_block_kind"
  | "set_scene"
  | "drop_noise"
  | "retitle_chapter"
  | "split_block"
  | "merge_blocks";

export interface CleaningItem {
  id: string;
  volume_id: string;
  chapter_id: string;
  type: string;
  target: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  reason: string;
  patch: Record<string, unknown>;
  source_task_id: string;
  model: string;
  status: "open" | "accepted" | "rejected" | "applied";
  created_at: string;
  resolved_at?: string;
}

export interface CleaningChange {
  id: string;
  seq: number;
  op: "normalize" | "apply_suggestion";
  source: string;
  volume_id: string;
  summary: string;
  edits: Array<{ type: string; target: string; detail: string }>;
  item_ids: string[];
  snapshot_before: string;
  snapshot_manifest: string;
  created_at: string;
  status: "applied" | "rolled_back";
  rolled_back_at?: string;
}

export interface CommitResult {
  changed: boolean;
  change?: CleaningChange;
  validation?: ValidationReport;
  edits: Array<{ type: string; target: string; detail: string }>;
}

/** Reparse + revalidate the whole bookpack (cleaning is pre-draft). */
export function reparseValidate(store: FileStore): ValidationReport {
  new Parser(store).parseBookpack();
  return new Validator(store).validateBookpack();
}

function readChanges(store: FileStore): CleaningChange[] {
  return store.readJsonl<CleaningChange>(CLEANING_CHANGES).rows;
}

function nextSeq(store: FileStore): number {
  return readChanges(store).reduce((n, c) => Math.max(n, c.seq), 0) + 1;
}

function volumeMainText(store: FileStore, volumeId: string): string {
  const manifest = store.readJson<Manifest>("manifest.json");
  const volume = manifest.volumes.find((v) => v.id === volumeId);
  if (!volume) throw new Error(`找不到卷：${volumeId}`);
  return volume.main_text;
}

/** Resolve which volume a target id (block/chapter/asset) belongs to. */
export function volumeOfTarget(store: FileStore, target: string): string {
  const manifest = store.readJson<Manifest>("manifest.json");
  const hit = manifest.volumes.find((v) => target === v.id || target.startsWith(v.id + ".") || target.startsWith(v.id + "_"));
  if (hit) return hit.id;
  throw new Error(`无法从 target 推断卷：${target}`);
}

/**
 * Apply an in-place Markdown edit to one volume as a single auditable change.
 * `mutate` edits the `lines` array and returns the concrete edits it made (empty
 * = no-op). On validation failure the snapshot is restored and the change is not
 * recorded. Returns the change + validation report.
 */
export function commitVolumeChange(
  store: FileStore,
  volumeId: string,
  opts: {
    op: CleaningChange["op"];
    source: string;
    summary: string;
    item_ids?: string[];
    mutate: (ctx: { lines: string[]; manifest: Manifest }) => Array<{ type: string; target: string; detail: string }>;
  },
): CommitResult {
  const mainText = volumeMainText(store, volumeId);
  const seq = nextSeq(store);
  const stem = `${SNAPSHOT_DIR}/${volumeId}.${String(seq).padStart(4, "0")}`;
  const snapMd = `${stem}.md`;
  const snapMani = `${stem}.manifest.json`;
  const originalMd = store.readText(mainText);
  const originalMani = store.readText("manifest.json");

  const lines = originalMd.split(/\r?\n/);
  const manifest = JSON.parse(originalMani) as Manifest;
  const edits = opts.mutate({ lines, manifest });
  if (edits.length === 0) return { changed: false, edits: [] };

  // Snapshot the pre-edit Markdown + manifest, then write the edited versions.
  store.writeText(snapMd, originalMd);
  store.writeText(snapMani, originalMani);
  store.writeText(mainText, lines.join("\n"));
  store.writeJson("manifest.json", manifest);

  const validation = reparseValidate(store);
  if (validation.status !== "passed") {
    // Roll back this edit; keep the failed report for the caller to surface.
    store.writeText(mainText, originalMd);
    store.writeText("manifest.json", originalMani);
    reparseValidate(store);
    return { changed: false, validation, edits };
  }

  const change: CleaningChange = {
    id: `cleanchg_${String(seq).padStart(4, "0")}`,
    seq,
    op: opts.op,
    source: opts.source,
    volume_id: volumeId,
    summary: opts.summary,
    edits,
    item_ids: opts.item_ids ?? [],
    snapshot_before: snapMd,
    snapshot_manifest: snapMani,
    created_at: new Date().toISOString(),
    status: "applied",
  };
  const changes = readChanges(store);
  changes.push(change);
  store.writeJsonl(CLEANING_CHANGES, changes);
  return { changed: true, change, validation, edits };
}

/**
 * Roll back a cleaning change by restoring its pre-edit snapshot. Any later
 * applied changes on the same volume are invalidated (their edits are discarded
 * by the restore) and marked rolled_back too. Reparses + revalidates.
 */
export function rollbackChange(store: FileStore, changeId: string): { rolled_back: string[]; validation: ValidationReport } {
  const changes = readChanges(store);
  const target = changes.find((c) => c.id === changeId);
  if (!target) throw new Error(`找不到 cleaning change：${changeId}`);
  if (target.status !== "applied") throw new Error(`change 已回滚：${changeId}`);
  if (!store.exists(target.snapshot_before)) throw new Error(`快照丢失，无法回滚：${target.snapshot_before}`);

  const mainText = volumeMainText(store, target.volume_id);
  store.writeText(mainText, store.readText(target.snapshot_before));
  if (target.snapshot_manifest && store.exists(target.snapshot_manifest)) {
    store.writeText("manifest.json", store.readText(target.snapshot_manifest));
  }

  const rolledBack: string[] = [];
  const now = new Date().toISOString();
  for (const c of changes) {
    if (c.volume_id === target.volume_id && c.seq >= target.seq && c.status === "applied") {
      c.status = "rolled_back";
      c.rolled_back_at = now;
      rolledBack.push(c.id);
    }
  }
  store.writeJsonl(CLEANING_CHANGES, changes);

  // Reopen any items that those changes had marked applied.
  const appliedItemIds = new Set(
    changes.filter((c) => rolledBack.includes(c.id)).flatMap((c) => c.item_ids),
  );
  if (appliedItemIds.size > 0) setItemsStatus(store, [...appliedItemIds], "accepted");

  const validation = reparseValidate(store);
  return { rolled_back: rolledBack, validation };
}

// ----- cleaning items (ingested suggestions) -----

export function readItems(store: FileStore): CleaningItem[] {
  return store.readJsonl<CleaningItem>(CLEANING_ITEMS).rows;
}

export function writeItems(store: FileStore, items: CleaningItem[]): void {
  store.writeJsonl(CLEANING_ITEMS, items);
}

export function setItemsStatus(store: FileStore, ids: string[], status: CleaningItem["status"]): number {
  const set = new Set(ids);
  const items = readItems(store);
  let n = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    if (set.has(it.id)) {
      it.status = status;
      if (status !== "open") it.resolved_at = now;
      n += 1;
    }
  }
  writeItems(store, items);
  return n;
}
