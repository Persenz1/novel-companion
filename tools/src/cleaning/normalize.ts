// Deterministic normalizer: the rule-based half of cleaning. It fixes patterns
// that are unambiguous enough not to need the AI, so the model only ever sees
// the cases that genuinely require judgement.
//
// Currently: isolated scene-divider blocks. Real books (e.g. COTE) print a bare
// number or symbol on its own line to mark a scene break; the importer keeps
// them as paragraphs. Here we retype them as `separator`. Runs through
// commitVolumeChange, so it is snapshotted, revalidated and reversible.
import { FileStore } from "../fileStore.js";
import type { Block, Manifest } from "../types.js";
import { commitVolumeChange, type CommitResult } from "./cleaningStore.js";
import { setMarkerAttr } from "./markdownEdit.js";

// A block whose entire text is a short number or a run of divider symbols.
const SEPARATOR_TEXT = /^\s*(\d{1,3}|[*＊※◇◆●○・.。\-—－─=＝]{1,8}|\*(?:\s*\*){1,3})\s*$/;

export function isIsolatedSeparator(text: string): boolean {
  if (text.includes("\n")) return false; // multi-line = real body
  return SEPARATOR_TEXT.test(text);
}

export interface NormalizeResult {
  volume_results: Array<{ volume_id: string; result: CommitResult }>;
  total_edits: number;
  validation_ok: boolean;
}

/** Normalize one bookpack (all volumes, or a single volume). */
export function normalizeBookpack(store: FileStore, volumeId?: string): NormalizeResult {
  const manifest = store.readJson<Manifest>("manifest.json");
  const blocks = store.readJsonl<Block>("parsed/blocks.jsonl").rows;

  const results: NormalizeResult["volume_results"] = [];
  let total = 0;
  let ok = true;

  for (const volume of manifest.volumes) {
    if (volumeId && volume.id !== volumeId) continue;
    const targets = blocks.filter(
      (b) => b.volume_id === volume.id && b.kind !== "separator" && isIsolatedSeparator(b.text),
    );
    if (targets.length === 0) continue;

    const result = commitVolumeChange(store, volume.id, {
      op: "normalize",
      source: "normalizer",
      summary: `${targets.length} 个孤立数字/符号 block 归为 separator`,
      mutate: ({ lines }) => {
        const edits: Array<{ type: string; target: string; detail: string }> = [];
        for (const b of targets) {
          if (setMarkerAttr(lines, "block", b.id, "kind", "separator")) {
            edits.push({ type: "set_block_kind", target: b.id, detail: `paragraph→separator ("${b.text}")` });
          }
        }
        return edits;
      },
    });

    results.push({ volume_id: volume.id, result });
    total += result.edits.length;
    if (result.validation && result.validation.status !== "passed") ok = false;
  }

  return { volume_results: results, total_edits: total, validation_ok: ok };
}
