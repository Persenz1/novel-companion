// Parser: Markdown volume -> Parsed JSONL, per docs/modules/toolchain.md
// and docs/modules/bookpack-data.md.
//
// Parsed output is a regeneratable product. It does NOT carry review progress
// (that lives in review/block_progress.jsonl). Japanese ja_refs are authored
// separately during cleaning; the Markdown only marks which zh blocks align,
// so the parser emits alignments with empty ja_refs unless an existing
// alignments source is merged in later.
import path from "node:path";
import { FileStore } from "./fileStore.js";
import { isCommentLine, parseComment, splitList } from "./markdown/comment.js";
import type {
  Alignment,
  AlignmentStatus,
  Asset,
  AssetAnchor,
  Block,
  BlockKind,
  CleaningNote,
  CleaningReport,
  Manifest,
  ManifestVolume,
  ParsedBundle,
  Scene,
} from "./types.js";

const RECOGNIZED_TAGS = new Set(["chapter", "block", "scene", "asset", "alignment"]);
const ALIGNMENT_STATUSES = new Set<AlignmentStatus>(["parsed", "pending_review", "reviewed"]);

export interface VolumeParseResult {
  bundle: ParsedBundle;
  notes: CleaningNote[];
}

export class Parser {
  private readonly store: FileStore;
  private readonly manifest: Manifest;

  constructor(store: FileStore) {
    this.store = store;
    if (!store.exists("manifest.json")) {
      throw new Error(`manifest.json not found in bookpack: ${store.root}`);
    }
    this.manifest = store.readJson<Manifest>("manifest.json");
  }

  /** Parse one volume and return its records + notes (does not write files). */
  parseVolume(volumeId: string): VolumeParseResult {
    const volume = this.manifest.volumes.find((v) => v.id === volumeId);
    if (!volume) throw new Error(`volume not found in manifest: ${volumeId}`);
    return this.parseVolumeInternal(volume);
  }

  /** Parse all volumes, write parsed/*.jsonl + reports/cleaning_report.json. */
  parseBookpack(): CleaningReport {
    const merged: ParsedBundle = {
      blocks: [],
      scenes: [],
      assets: [],
      asset_anchors: [],
      alignments: [],
    };
    const notes: CleaningNote[] = [];
    const volumeSummaries: CleaningReport["volumes"] = [];

    for (const volume of this.manifest.volumes) {
      const { bundle, notes: vnotes } = this.parseVolumeInternal(volume);
      merged.blocks.push(...bundle.blocks);
      merged.scenes.push(...bundle.scenes);
      merged.assets.push(...bundle.assets);
      merged.asset_anchors.push(...bundle.asset_anchors);
      merged.alignments.push(...bundle.alignments);
      notes.push(...vnotes);
      volumeSummaries.push({
        volume_id: volume.id,
        main_text: volume.main_text,
        chapter_count: volume.chapters.length,
        block_count: bundle.blocks.length,
        scene_count: bundle.scenes.length,
        asset_count: bundle.assets.length,
        alignment_count: bundle.alignments.length,
      });
    }

    this.store.writeJsonl("parsed/blocks.jsonl", merged.blocks);
    this.store.writeJsonl("parsed/scenes.jsonl", merged.scenes);
    this.store.writeJsonl("parsed/assets.jsonl", merged.assets);
    this.store.writeJsonl("parsed/asset_anchors.jsonl", merged.asset_anchors);
    this.store.writeJsonl("parsed/alignments.jsonl", merged.alignments);

    const hasWarning = notes.some((n) => n.severity === "warning");
    const report: CleaningReport = {
      status: hasWarning ? "ok_with_warnings" : "ok",
      generated_at: new Date().toISOString(),
      generator: "novel-companion-tools/parser@0.1.0",
      volumes: volumeSummaries,
      counts: {
        blocks: merged.blocks.length,
        scenes: merged.scenes.length,
        assets: merged.assets.length,
        asset_anchors: merged.asset_anchors.length,
        alignments: merged.alignments.length,
      },
      notes,
    };
    this.store.writeJson("reports/cleaning_report.json", report);
    return report;
  }

  // --- internals ---

  /** Load source/ja/{volume}.json: alignment_id -> { confidence?, ja_refs[] }. */
  private loadJaSource(volumeId: string): Record<string, { confidence?: number; ja_refs: string[] }> {
    const rel = `source/ja/${volumeId}.json`;
    if (!this.store.exists(rel)) return {};
    return this.store.readJson<Record<string, { confidence?: number; ja_refs: string[] }>>(rel);
  }

  private parseVolumeInternal(volume: ManifestVolume): VolumeParseResult {
    const seriesId = this.manifest.series.id;
    const mainText = volume.main_text;
    const raw = this.store.readText(mainText);
    const lines = raw.split(/\r?\n/);

    const bundle: ParsedBundle = {
      blocks: [],
      scenes: [],
      assets: [],
      asset_anchors: [],
      alignments: [],
    };
    const notes: CleaningNote[] = [];

    // Known image files for asset path resolution: stem -> filename.
    const imageFiles = new Map<string, string>();
    for (const name of this.store.listDir("assets/images")) {
      imageFiles.set(name.slice(0, name.length - path.extname(name).length), name);
    }

    // Optional Japanese reference source, merged into alignments. Japanese is
    // reference-only and authored at the cleaning stage; the Markdown carries
    // only the zh-block mapping, so ja text lives in source/ja/{volume}.json
    // and is merged here to keep alignments.jsonl regeneratable.
    const jaSource = this.loadJaSource(volume.id);
    const wantsJa = this.manifest.features?.contains_ja_reference === true;

    let currentChapter: string | null = null;
    // Per-chapter 1-based order counters.
    const blockOrder = new Map<string, number>();
    const sceneOrder = new Map<string, number>();
    let anchorSeq = 0;

    // Open scene tracking.
    let openScene: { id: string; title: string | null; blocks: string[] } | null = null;

    const nextOrder = (m: Map<string, number>, key: string): number => {
      const n = (m.get(key) ?? 0) + 1;
      m.set(key, n);
      return n;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNo = i + 1;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith("#")) continue; // visible heading, rendered from chapter marker

      if (!isCommentLine(line)) {
        // Stray body text that is not attached to a block marker.
        notes.push({
          code: "ORPHAN_TEXT",
          severity: "warning",
          message: `正文行不在任何 block 标记之后：${trimmed.slice(0, 24)}`,
          file: mainText,
          line: lineNo,
        });
        continue;
      }

      const comment = parseComment(line);
      if (!comment) {
        notes.push({
          code: "UNPARSEABLE_COMMENT",
          severity: "warning",
          message: "无法解析的 HTML 注释（非 marker）。",
          file: mainText,
          line: lineNo,
        });
        continue;
      }

      const { tag, primary, attrs } = comment;
      if (!RECOGNIZED_TAGS.has(tag)) {
        notes.push({
          code: "UNKNOWN_TAG",
          severity: "warning",
          message: `未识别的 marker tag：${tag}`,
          file: mainText,
          line: lineNo,
          object_id: primary,
        });
        continue;
      }

      switch (tag) {
        case "chapter": {
          currentChapter = primary;
          break;
        }
        case "block": {
          if (!currentChapter) {
            notes.push({
              code: "BLOCK_BEFORE_CHAPTER",
              severity: "warning",
              message: `block 出现在任何 chapter 之前：${primary}`,
              file: mainText,
              line: lineNo,
              object_id: primary,
            });
          }
          // Block kind is open (see BlockKind in types.ts): the importer may
          // synthesize `image` carriers and the cleaning AI may assign semantic
          // kinds. Keep whatever kind the Markdown declares; only a missing kind
          // falls back to paragraph.
          const kindRaw = attrs.kind;
          const kind: BlockKind = kindRaw ? (kindRaw as BlockKind) : "paragraph";
          const { text, next } = collectBlockText(lines, i + 1);
          i = next - 1;
          bundle.blocks.push({
            id: primary,
            series_id: seriesId,
            volume_id: volume.id,
            chapter_id: currentChapter ?? "",
            order: nextOrder(blockOrder, currentChapter ?? ""),
            kind,
            text,
            source_markdown: mainText,
          });
          if (openScene) openScene.blocks.push(primary);
          break;
        }
        case "scene": {
          const action = attrs.action;
          if (action === "start") {
            if (openScene) {
              notes.push({
                code: "SCENE_NESTED",
                severity: "warning",
                message: `scene ${primary} 在 ${openScene.id} 未结束时开始。`,
                file: mainText,
                line: lineNo,
                object_id: primary,
              });
            }
            openScene = { id: primary, title: attrs.title ?? null, blocks: [] };
          } else if (action === "end") {
            if (!openScene || openScene.id !== primary) {
              notes.push({
                code: "SCENE_END_MISMATCH",
                severity: "warning",
                message: `scene end ${primary} 找不到对应的 start。`,
                file: mainText,
                line: lineNo,
                object_id: primary,
              });
            } else {
              const chapterId = currentChapter ?? "";
              bundle.scenes.push({
                id: openScene.id,
                series_id: seriesId,
                volume_id: volume.id,
                chapter_id: chapterId,
                order: nextOrder(sceneOrder, chapterId),
                title: openScene.title,
                start_block: openScene.blocks[0] ?? null,
                end_block: openScene.blocks[openScene.blocks.length - 1] ?? null,
                pov: null,
                location_entity_id: null,
                status: "parsed",
              });
              openScene = null;
            }
          } else {
            notes.push({
              code: "SCENE_ACTION_MISSING",
              severity: "warning",
              message: `scene ${primary} 缺少 action: start|end。`,
              file: mainText,
              line: lineNo,
              object_id: primary,
            });
          }
          break;
        }
        case "asset": {
          const stem = primary;
          const filename = imageFiles.get(stem) ?? null;
          if (!filename) {
            notes.push({
              code: "ASSET_FILE_MISSING",
              severity: "warning",
              message: `找不到资源文件 assets/images/${stem}.*`,
              file: mainText,
              line: lineNo,
              object_id: stem,
            });
          }
          bundle.assets.push({
            id: stem,
            type: "image",
            path: filename ? `assets/images/${filename}` : null,
            alt: attrs.alt ?? null,
            source_volume_id: volume.id,
          });
          anchorSeq += 1;
          bundle.asset_anchors.push({
            id: `asset_anchor_${String(anchorSeq).padStart(3, "0")}`,
            asset_id: stem,
            anchor_type: (attrs.anchor_type as AssetAnchor["anchor_type"]) ?? "after_block",
            block_id: attrs.block ?? "",
          });
          break;
        }
        case "alignment": {
          const statusRaw = attrs.status;
          let status: AlignmentStatus = "reviewed";
          if (statusRaw) {
            if (ALIGNMENT_STATUSES.has(statusRaw as AlignmentStatus)) {
              status = statusRaw as AlignmentStatus;
            } else {
              notes.push({
                code: "UNKNOWN_ALIGNMENT_STATUS",
                severity: "warning",
                message: `未知 alignment status「${statusRaw}」，按 reviewed 处理。`,
                file: mainText,
                line: lineNo,
                object_id: primary,
              });
            }
          }
          const jaEntry = jaSource[primary];
          if (wantsJa && !jaEntry) {
            notes.push({
              code: "JA_REF_MISSING",
              severity: "warning",
              message: `manifest 声明含日文参考，但 alignment ${primary} 在 ja 源中没有日文文本。`,
              file: mainText,
              line: lineNo,
              object_id: primary,
            });
          }
          bundle.alignments.push({
            id: primary,
            series_id: seriesId,
            volume_id: volume.id,
            chapter_id: currentChapter ?? "",
            zh_block_ids: splitList(attrs.blocks),
            ja_refs: (jaEntry?.ja_refs ?? []).map((text, idx) => ({
              id: `${primary}.ja${String(idx + 1).padStart(2, "0")}`,
              order: idx + 1,
              text,
            })),
            confidence: jaEntry?.confidence ?? null,
            status,
          });
          break;
        }
      }
    }

    if (openScene) {
      notes.push({
        code: "SCENE_NOT_CLOSED",
        severity: "warning",
        message: `scene ${openScene.id} 没有 end 标记。`,
        file: mainText,
        object_id: openScene.id,
      });
    }

    return { bundle, notes };
  }
}

/**
 * Collect a block's body text starting at line index `start`.
 * Stops at the first blank line, comment, or heading. Image-only lines
 * (![alt](src)) are skipped — they belong to asset rendering, not block text.
 * Returns the joined text and the index of the line to resume from.
 */
function collectBlockText(lines: string[], start: number): { text: string; next: number } {
  const parts: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.length === 0) break;
    if (isCommentLine(line)) break;
    if (trimmed.startsWith("#")) break;
    if (/^!\[.*\]\(.*\)$/.test(trimmed)) continue;
    parts.push(trimmed);
  }
  return { text: parts.join("\n"), next: i };
}
