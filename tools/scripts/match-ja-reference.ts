#!/usr/bin/env -S npx tsx
// Import a Japanese EPUB as reference text, then attach it to an existing
// Chinese-main bookpack by block id. This writes display/alignment artifacts
// only; it never writes Accepted/Candidates and must not feed agent extraction.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../src/fileStore.js";
import { importEpubToBookpack } from "../src/cleaning/epubImport.js";
import { isBodyChapterKind } from "../src/chapterKind.js";
import type { Block, Manifest } from "../src/types.js";

interface ChapterMap {
  zh: string;
  ja: string[];
}

interface Args {
  bookpack: string;
  jaEpub: string;
  volumeId: string;
  preset: string | null;
  map: ChapterMap[];
  jaWork: string;
  force: boolean;
}

interface ChapterReport {
  zh_chapter: string;
  ja_chapters: string[];
  zh_blocks: number;
  ja_blocks: number;
  matched: number;
  unmatched_zh: string[];
  unmatched_ja: string[];
}

const COTE_V01: ChapterMap[] = [
  { zh: "v01.c12", ja: ["v01.c09"] },
  { zh: "v01.c13", ja: ["v01.c10", "v01.c12", "v01.c14"] },
  { zh: "v01.c14", ja: ["v01.c15", "v01.c17"] },
  { zh: "v01.c15", ja: ["v01.c18", "v01.c20"] },
  { zh: "v01.c16", ja: ["v01.c21"] },
  { zh: "v01.c17", ja: ["v01.c22"] },
  { zh: "v01.c18", ja: ["v01.c23", "v01.c25"] },
  { zh: "v01.c19", ja: ["v01.c26", "v01.c28", "v01.c30", "v01.c32"] },
  { zh: "v01.c20", ja: ["v01.c33", "v01.c35"] },
  { zh: "v01.c21", ja: ["v01.c36"] },
  { zh: "v01.c22", ja: ["v01.c37"] },
  { zh: "v01.c23", ja: ["v01.c38", "v01.c40"] },
];

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/match-ja-reference.ts --bookpack <dir> --ja-epub <file> --volume-id v01 --preset cote-v01 [--force]
  npx tsx scripts/match-ja-reference.ts --bookpack <dir> --ja-epub <file> --volume-id v01 --map zh:ja+ja,zh:ja

Options:
  --preset cote-v01  Built-in mapping for COTE Chinese v01 and Japanese v01.
  --map CSV          Example: v01.c12:v01.c09,v01.c13:v01.c10+v01.c12+v01.c14
  --ja-work DIR      Temporary Japanese import dir. Default: OS tmp dir.
  --force            Replace existing source/ja/<volume>.blocks.json and ja-work.
`);
  process.exit(2);
}

function parseArgs(): Args {
  const out: Args = {
    bookpack: "",
    jaEpub: "",
    volumeId: "v01",
    preset: null,
    map: [],
    jaWork: path.join(os.tmpdir(), `novel-companion-ja-${process.pid}`),
    force: false,
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--bookpack") out.bookpack = path.resolve(req(args, ++i, a));
    else if (a === "--ja-epub") out.jaEpub = path.resolve(req(args, ++i, a));
    else if (a === "--volume-id") out.volumeId = req(args, ++i, a);
    else if (a === "--preset") out.preset = req(args, ++i, a);
    else if (a === "--map") out.map = parseMap(req(args, ++i, a));
    else if (a === "--ja-work") out.jaWork = path.resolve(req(args, ++i, a));
    else if (a === "--force") out.force = true;
    else usage();
  }
  if (!out.bookpack || !out.jaEpub) usage();
  if (out.preset === "cote-v01") out.map = COTE_V01;
  if (!out.map.length) throw new Error("Missing --map or --preset.");
  return out;
}

function req(args: string[], i: number, flag: string): string {
  const value = args[i];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseMap(value: string): ChapterMap[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [zh, rhs] = part.split(":");
      const ja = (rhs ?? "").split("+").filter(Boolean);
      if (!zh || ja.length === 0) throw new Error(`Invalid map entry: ${part}`);
      return { zh, ja };
    });
}

function readJsonl<T>(store: FileStore, rel: string): T[] {
  return store.readJsonl<T>(rel).rows;
}

function blocksByChapter(blocks: Block[]): Map<string, Block[]> {
  const out = new Map<string, Block[]>();
  for (const block of blocks) {
    const rows = out.get(block.chapter_id) ?? [];
    rows.push(block);
    out.set(block.chapter_id, rows);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.order - b.order);
  return out;
}

function zhTextBlocks(manifest: Manifest, blocks: Block[], volumeId: string, chapterId: string): Block[] {
  const volume = manifest.volumes.find((v) => v.id === volumeId);
  const chapter = volume?.chapters.find((ch) => ch.id === chapterId);
  if (!chapter) throw new Error(`Chinese chapter not found: ${chapterId}`);
  if (!isBodyChapterKind(chapter.kind)) throw new Error(`Chinese chapter is non-body: ${chapterId} (${chapter.kind})`);
  return blocks
    .filter((b) => b.chapter_id === chapterId)
    .sort((a, b) => a.order - b.order)
    .filter((b) => b.text.trim());
}

function jaTextBlocks(byChapter: Map<string, Block[]>, chapterIds: string[]): Block[] {
  return chapterIds.flatMap((chapterId) =>
    (byChapter.get(chapterId) ?? [])
      .filter((b) => b.text.trim())
      .filter((b) => !/^○/.test(b.text.trim())),
  );
}

function makeReviewItem(volumeId: string, report: ChapterReport, seq: number): Record<string, unknown> {
  return {
    id: `ja_align_${volumeId}_${String(seq).padStart(4, "0")}`,
    type: "ja_alignment_mismatch",
    status: "open",
    priority: "medium",
    volume_id: volumeId,
    zh_chapter: report.zh_chapter,
    ja_chapters: report.ja_chapters,
    message: `中日 block 数不一致：中文 ${report.zh_blocks}，日文 ${report.ja_blocks}，已顺序匹配 ${report.matched}。`,
    recommended_action: "人工检查该章节的一对多/多对一分段差异；必要时修正 source/ja/*.blocks.json。",
    unmatched_zh: report.unmatched_zh,
    unmatched_ja: report.unmatched_ja,
  };
}

function main(): void {
  const args = parseArgs();
  const zhStore = new FileStore(args.bookpack);
  const jaOutRel = `source/ja/${args.volumeId}.blocks.json`;
  if (zhStore.exists(jaOutRel) && !args.force) {
    throw new Error(`${jaOutRel} already exists. Pass --force to replace it.`);
  }
  if (fs.existsSync(args.jaWork)) {
    if (!args.force) throw new Error(`ja-work already exists: ${args.jaWork}. Pass --force to replace it.`);
    fs.rmSync(args.jaWork, { recursive: true, force: true });
  }

  importEpubToBookpack(args.jaEpub, args.jaWork, {
    volumeId: args.volumeId,
    seriesId: "ja_reference",
    packId: "ja_reference_v1",
    packName: "Japanese Reference",
    force: true,
  });

  const jaStore = new FileStore(args.jaWork);
  const zhManifest = zhStore.readJson<Manifest>("manifest.json");
  const zhBlocks = readJsonl<Block>(zhStore, "parsed/blocks.jsonl");
  const jaBlocks = readJsonl<Block>(jaStore, "parsed/blocks.jsonl");
  const jaByChapter = blocksByChapter(jaBlocks);

  const out: Record<string, string> = {};
  const chapters: ChapterReport[] = [];
  let itemSeq = 1;
  const reviewItems: Record<string, unknown>[] = [];

  for (const entry of args.map) {
    const zh = zhTextBlocks(zhManifest, zhBlocks, args.volumeId, entry.zh);
    const ja = jaTextBlocks(jaByChapter, entry.ja);
    const matched = Math.min(zh.length, ja.length);
    for (let i = 0; i < matched; i += 1) out[zh[i]!.id] = ja[i]!.text;
    const report: ChapterReport = {
      zh_chapter: entry.zh,
      ja_chapters: entry.ja,
      zh_blocks: zh.length,
      ja_blocks: ja.length,
      matched,
      unmatched_zh: zh.slice(matched).map((b) => b.id),
      unmatched_ja: ja.slice(matched).map((b) => b.id),
    };
    chapters.push(report);
    if (report.zh_blocks !== report.ja_blocks) reviewItems.push(makeReviewItem(args.volumeId, report, itemSeq++));
  }

  const coveredZh = Object.keys(out).length;
  const totalZh = args.map.reduce((n, entry) => n + zhTextBlocks(zhManifest, zhBlocks, args.volumeId, entry.zh).length, 0);
  zhStore.writeJson(jaOutRel, out);
  zhStore.writeJsonl("review/ja_alignment_items.jsonl", reviewItems);
  zhStore.writeJson("reports/ja_alignment_report.json", {
    generated_at: new Date().toISOString(),
    generator: "scripts/match-ja-reference.ts",
    volume_id: args.volumeId,
    ja_epub: args.jaEpub,
    ja_work: args.jaWork,
    mode: "chapter_map_sequential_text_blocks",
    parsed_only_as_reference: true,
    writes_accepted: false,
    coverage: {
      zh_text_blocks: totalZh,
      matched_blocks: coveredZh,
      ratio: totalZh > 0 ? Number((coveredZh / totalZh).toFixed(4)) : 0,
      review_items: reviewItems.length,
    },
    chapters,
  });

  const manifest = zhStore.readJson<Manifest>("manifest.json");
  zhStore.writeJson("manifest.json", {
    ...manifest,
    features: { ...(manifest.features ?? {}), contains_ja_reference: true },
  });

  console.log(`[match-ja-reference] ${zhStore.root}`);
  console.log(`  volume=${args.volumeId} matched=${coveredZh}/${totalZh} review_items=${reviewItems.length}`);
  console.log(`  wrote ${jaOutRel}`);
  console.log("  wrote review/ja_alignment_items.jsonl");
  console.log("  wrote reports/ja_alignment_report.json");
}

main();
