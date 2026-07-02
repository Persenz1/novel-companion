// Suggestion applier: turns an accepted cleaning suggestion into a concrete
// Markdown/manifest edit. Each type maps to one deterministic transform; the
// edit is committed through commitVolumeChange, so it is snapshotted, revalidated
// and reversible. A suggestion that would break validation is auto-rolled-back.
//
// Supported (low/medium risk): set_asset_alt, move_asset_anchor, set_block_kind,
// set_scene, drop_noise, retitle_chapter. High-risk split_block/merge_blocks are
// left to a human for now and reported as skipped.
import { FileStore } from "../fileStore.js";
import type { Manifest, ValidationReport } from "../types.js";
import {
  commitVolumeChange,
  readItems,
  setItemsStatus,
  volumeOfTarget,
  type CleaningChange,
  type CleaningItem,
} from "./cleaningStore.js";
import { deleteBlock, setMarkerAttr } from "./markdownEdit.js";

export interface Suggestion {
  type: string;
  target: string;
  patch?: Record<string, unknown>;
}

function str(patch: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = patch?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Apply one suggestion to the in-memory volume lines/manifest. Returns a short
 * edit description on success; throws with a human reason when it cannot apply
 * (bad target / missing patch / unsupported type). Never partially applies.
 */
function applyToLines(
  ctx: { lines: string[]; manifest: Manifest },
  s: Suggestion,
): { type: string; target: string; detail: string } {
  const { lines, manifest } = ctx;
  switch (s.type) {
    case "set_asset_alt": {
      const alt = str(s.patch, "alt");
      if (!alt) throw new Error("缺少 patch.alt");
      if (!setMarkerAttr(lines, "asset", s.target, "alt", alt)) throw new Error(`找不到 asset 标记：${s.target}`);
      return { type: s.type, target: s.target, detail: `alt="${alt}"` };
    }
    case "move_asset_anchor": {
      const block = str(s.patch, "block", "anchor_block", "to_block");
      if (!block) throw new Error("缺少 patch.block");
      if (!setMarkerAttr(lines, "asset", s.target, "block", block)) throw new Error(`找不到 asset 标记：${s.target}`);
      return { type: s.type, target: s.target, detail: `block→${block}` };
    }
    case "set_block_kind": {
      const kind = str(s.patch, "kind");
      if (!kind) throw new Error("缺少 patch.kind");
      if (!setMarkerAttr(lines, "block", s.target, "kind", kind)) throw new Error(`找不到 block 标记：${s.target}`);
      return { type: s.type, target: s.target, detail: `kind→${kind}` };
    }
    case "set_scene": {
      // Interpreted as: this block is a scene divider → retype to separator.
      if (!setMarkerAttr(lines, "block", s.target, "kind", "separator")) throw new Error(`找不到 block 标记：${s.target}`);
      return { type: s.type, target: s.target, detail: "kind→separator" };
    }
    case "drop_noise": {
      if (!deleteBlock(lines, s.target)) throw new Error(`找不到 block 标记：${s.target}`);
      return { type: s.type, target: s.target, detail: "删除噪声 block" };
    }
    case "retitle_chapter": {
      const title = str(s.patch, "title");
      if (!title) throw new Error("缺少 patch.title");
      if (!setMarkerAttr(lines, "chapter", s.target, "title", title)) throw new Error(`找不到 chapter 标记：${s.target}`);
      for (const v of manifest.volumes) for (const c of v.chapters) if (c.id === s.target) c.title = title;
      return { type: s.type, target: s.target, detail: `title="${title}"` };
    }
    case "split_block":
    case "merge_blocks":
      throw new Error(`高风险类型需人工处理：${s.type}`);
    default:
      throw new Error(`不支持的清洗类型：${s.type}`);
  }
}

export interface ApplyResult {
  applied: string[];
  skipped: Array<{ id: string; reason: string }>;
  changes: CleaningChange[];
  failed_volumes: Array<{ volume_id: string; validation: ValidationReport }>;
}

/**
 * Apply accepted cleaning items by id. Items are grouped by volume; each volume
 * is one committed change (all its edits share a snapshot and one reparse). Items
 * that cannot be applied are reported as skipped without aborting the rest.
 */
export function applyItems(store: FileStore, ids: string[], source = "human"): ApplyResult {
  const wanted = new Set(ids);
  const items = readItems(store).filter((it) => wanted.has(it.id));
  const byVolume = new Map<string, CleaningItem[]>();
  for (const it of items) {
    const list = byVolume.get(it.volume_id) ?? [];
    list.push(it);
    byVolume.set(it.volume_id, list);
  }

  const applied: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const changes: CleaningChange[] = [];
  const failed: ApplyResult["failed_volumes"] = [];

  for (const [volumeId, volItems] of byVolume) {
    const appliedHere: string[] = [];
    const result = commitVolumeChange(store, volumeId, {
      op: "apply_suggestion",
      source,
      summary: `应用 ${volItems.length} 条清洗建议`,
      item_ids: volItems.map((it) => it.id),
      mutate: (mctx) => {
        const edits: Array<{ type: string; target: string; detail: string }> = [];
        for (const it of volItems) {
          try {
            edits.push(applyToLines(mctx, { type: it.type, target: it.target, patch: it.patch }));
            appliedHere.push(it.id);
          } catch (err) {
            skipped.push({ id: it.id, reason: (err as Error).message });
          }
        }
        return edits;
      },
    });

    if (result.change) {
      changes.push(result.change);
      // The committed change carries exactly the applied item ids.
      result.change.item_ids = appliedHere;
      applied.push(...appliedHere);
    } else if (result.validation && result.validation.status !== "passed") {
      failed.push({ volume_id: volumeId, validation: result.validation });
      for (const it of volItems) if (appliedHere.includes(it.id)) skipped.push({ id: it.id, reason: "整卷校验失败已回滚" });
    }
  }

  if (applied.length > 0) setItemsStatus(store, applied, "applied");
  return { applied, skipped, changes, failed_volumes: failed };
}

/** Apply a single ad-hoc suggestion (no items file); used by CLI/tests. */
export function applyOne(store: FileStore, s: Suggestion): ApplyResult["changes"][number] | { skipped: string } {
  const volumeId = volumeOfTarget(store, s.target);
  let detail = "";
  const result = commitVolumeChange(store, volumeId, {
    op: "apply_suggestion",
    source: "cli",
    summary: `应用 ${s.type} @ ${s.target}`,
    mutate: (mctx) => {
      const e = applyToLines(mctx, s);
      detail = e.detail;
      return [e];
    },
  });
  if (result.change) return result.change;
  const reason = result.validation && result.validation.status !== "passed" ? "校验失败已回滚" : detail || "no-op";
  return { skipped: reason };
}
