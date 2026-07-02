// Ingest MiMo cleaning outputs (reports/cleaning_mimo_outputs/*.json) into the
// cleaning suggestion queue (review/cleaning_items.jsonl). Idempotent: item ids
// are deterministic per chapter+position, and re-ingesting preserves the status
// of items a human has already adjudicated.
import { FileStore } from "../fileStore.js";
import type { Manifest } from "../types.js";
import { CLEANING_ITEMS, readItems, writeItems, type CleaningItem } from "./cleaningStore.js";

const OUTPUT_DIR = "reports/cleaning_mimo_outputs";

interface MimoOutput {
  task_id?: string;
  chapter_id?: string;
  model?: string;
  parsed?: { suggestions?: Array<Record<string, unknown>> };
}

function volumeOf(manifest: Manifest, chapterId: string): string {
  for (const v of manifest.volumes) if (v.chapters.some((c) => c.id === chapterId)) return v.id;
  const m = /^([^.]+)\./.exec(chapterId);
  return m?.[1] ?? manifest.volumes[0]?.id ?? "v01";
}

function asPatch(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") return { text: v };
  return {};
}

export interface IngestResult {
  file_count: number;
  item_count: number;
  new_count: number;
  by_status: Record<string, number>;
}

export function ingestMimoSuggestions(store: FileStore): IngestResult {
  const manifest = store.readJson<Manifest>("manifest.json");
  const prev = new Map(readItems(store).map((it) => [it.id, it]));
  const files = store.listDir(OUTPUT_DIR).filter((f) => f.endsWith(".json")).sort();

  const items: CleaningItem[] = [];
  let newCount = 0;
  for (const file of files) {
    const out = store.readJson<MimoOutput>(`${OUTPUT_DIR}/${file}`);
    const chapterId = out.chapter_id ?? "";
    const suggestions = out.parsed?.suggestions ?? [];
    suggestions.forEach((s, i) => {
      const type = String(s.type ?? "");
      const target = String(s.target ?? "");
      if (!type || !target) return;
      const id = `${chapterId}#${i}`;
      const existing = prev.get(id);
      const item: CleaningItem = {
        id,
        volume_id: volumeOf(manifest, chapterId),
        chapter_id: chapterId,
        type,
        target,
        confidence: typeof s.confidence === "number" ? s.confidence : 0,
        risk: (["low", "medium", "high"].includes(String(s.risk)) ? s.risk : "medium") as CleaningItem["risk"],
        reason: String(s.reason ?? ""),
        patch: asPatch(s.patch),
        source_task_id: out.task_id ?? "",
        model: out.model ?? "",
        // Preserve a prior human decision; otherwise start open.
        status: existing && existing.status !== "open" ? existing.status : "open",
        created_at: existing?.created_at ?? new Date().toISOString(),
        resolved_at: existing?.resolved_at,
      };
      if (!existing) newCount += 1;
      items.push(item);
    });
  }

  writeItems(store, items);
  const byStatus: Record<string, number> = {};
  for (const it of items) byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
  return { file_count: files.length, item_count: items.length, new_count: newCount, by_status: byStatus };
}

export { CLEANING_ITEMS };
