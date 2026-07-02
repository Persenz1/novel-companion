#!/usr/bin/env -S npx tsx
// MiMo-assisted Japanese reference matching for the real-book bilingual test.
//
// Chinese remains the only story spine. This script only writes Japanese
// display/reference artifacts:
//   source/ja/<volume>.blocks.json
//   review/ja_alignment_items.jsonl
//   reports/ja_alignment_report.json
//   reports/ja_alignment_mimo_outputs/*.json
//
// It never writes Accepted/Candidates and never lets Japanese become extraction
// evidence for the agent pipeline.
import fs from "node:fs";
import path from "node:path";
import { FileStore } from "../src/fileStore.js";
import type { Block, Manifest } from "../src/types.js";
import { loadConfig } from "../src/agent/config.js";
import { chat, extractJson } from "../src/agent/llm.js";

type Rec = Record<string, unknown>;

interface ChapterMap {
  zh: string;
  ja: string[];
}

interface Args {
  bookpack: string;
  jaBookpack: string;
  volumeId: string;
  preset: string;
  force: boolean;
}

interface MimoMapping {
  zh_id: string;
  ja_ids?: string[];
  confidence?: number;
  reason?: string;
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
  npx tsx scripts/mimo-ja-alignment.ts --bookpack <zh-bookpack> --ja-bookpack <ja-imported-bookpack> --volume-id v01 --preset cote-v01 [--force]
`);
  process.exit(2);
}

function parseArgs(): Args {
  const out: Args = { bookpack: "", jaBookpack: "", volumeId: "v01", preset: "cote-v01", force: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--bookpack") out.bookpack = path.resolve(req(args, ++i, a));
    else if (a === "--ja-bookpack") out.jaBookpack = path.resolve(req(args, ++i, a));
    else if (a === "--volume-id") out.volumeId = req(args, ++i, a);
    else if (a === "--preset") out.preset = req(args, ++i, a);
    else if (a === "--force") out.force = true;
    else usage();
  }
  if (!out.bookpack || !out.jaBookpack) usage();
  if (out.preset !== "cote-v01") throw new Error(`Unsupported preset: ${out.preset}`);
  return out;
}

function req(args: string[], i: number, flag: string): string {
  const value = args[i];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function readJsonl<T>(store: FileStore, rel: string): T[] {
  return store.readJsonl<T>(rel).rows;
}

function isZhExtraNote(block: Block): boolean {
  return /^注[:：]/.test(block.text.trim());
}

function isJaHeading(block: Block): boolean {
  return /^○/.test(block.text.trim());
}

function blocksFor(blocks: Block[], chapterId: string): Block[] {
  return blocks.filter((b) => b.chapter_id === chapterId && b.text.trim()).sort((a, b) => a.order - b.order);
}

function compactBlock(block: Block): Rec {
  return { id: block.id, text: block.text };
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function repairWindow(
  store: FileStore,
  chapter: ChapterMap,
  zhWindow: Block[],
  jaWindow: Block[],
): Promise<MimoMapping[]> {
  const cfg = loadConfig();
  if (!cfg.vision.base_url || !cfg.vision.api_key || !cfg.vision.model) {
    throw new Error("vision/MiMo 模型未配置，无法执行日文匹配。");
  }
  const prompt =
    `你在做小说中日双语段落匹配。中文是唯一阅读主轴，日文只作为显示参考，不用于剧情解析。\n` +
    `请只根据语义匹配下面这个局部窗口。允许一对一、一对多、多对一；中文译注（如“注：...”）若日文原版没有对应，应返回空 ja_ids 并说明 zh_extra_note。\n` +
    `必须为每个 zh_blocks 里的 zh_id 返回一条 mapping。只输出 JSON：\n` +
    `{"mappings":[{"zh_id":"...","ja_ids":["..."],"confidence":0.0-1.0,"reason":"简短原因"}]}\n\n` +
    `章节：${chapter.zh} <= ${chapter.ja.join(", ")}\n\n` +
    `zh_blocks:\n${JSON.stringify(zhWindow.map(compactBlock), null, 2)}\n\n` +
    `ja_blocks:\n${JSON.stringify(jaWindow.map(compactBlock), null, 2)}`;

  const result = await chat(
    cfg.vision,
    [
      {
        role: "system",
        content:
          "你是双语小说段落匹配助手。只做中日段落对齐，不抽取实体、事实、事件或剧情结构。输出严格 JSON。",
      },
      { role: "user", content: prompt },
    ],
    { maxCompletionTokens: 4096, jsonMode: true, thinking: "disabled" },
  );
  const parsed = extractJson<{ mappings?: MimoMapping[] }>(result.text);
  const mappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
  const rel = `reports/ja_alignment_mimo_outputs/${chapter.zh}.tail.json`;
  store.writeJson(rel, {
    schema_version: "0.1.0",
    task_type: "mimo_ja_alignment_repair",
    chapter_id: chapter.zh,
    ja_chapters: chapter.ja,
    model: result.model,
    usage: result.usage ?? null,
    zh_window: zhWindow.map((b) => b.id),
    ja_window: jaWindow.map((b) => b.id),
    parsed: { mappings },
    raw_text: result.text,
  });
  return mappings;
}

function writeReviewItem(volumeId: string, seq: number, item: Rec): Rec {
  return {
    id: `ja_align_${volumeId}_${String(seq).padStart(4, "0")}`,
    type: "ja_alignment_mimo",
    status: "open",
    priority: item.priority ?? "medium",
    volume_id: volumeId,
    created_by: "mimo",
    ...item,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const store = new FileStore(args.bookpack);
  const jaStore = new FileStore(args.jaBookpack);
  const outRel = `source/ja/${args.volumeId}.blocks.json`;
  if (store.exists(outRel) && !args.force) throw new Error(`${outRel} exists. Pass --force.`);

  const manifest = store.readJson<Manifest>("manifest.json");
  const zhBlocks = readJsonl<Block>(store, "parsed/blocks.jsonl");
  const jaBlocks = readJsonl<Block>(jaStore, "parsed/blocks.jsonl");
  const jaById = new Map(jaBlocks.map((b) => [b.id, b]));
  const out: Record<string, string> = {};
  const review: Rec[] = [];
  const chapters: Rec[] = [];
  let reviewSeq = 1;

  fs.mkdirSync(store.abs("reports/ja_alignment_mimo_outputs"), { recursive: true });

  for (const chapter of COTE_V01) {
    const zhAll = blocksFor(zhBlocks, chapter.zh);
    const zhNotes = zhAll.filter(isZhExtraNote);
    const zhStory = zhAll.filter((b) => !isZhExtraNote(b));
    const jaStory = chapter.ja.flatMap((ch) => blocksFor(jaBlocks, ch).filter((b) => !isJaHeading(b)));

    const base = Math.min(zhStory.length, jaStory.length);
    for (let i = 0; i < base; i += 1) out[zhStory[i]!.id] = jaStory[i]!.text;
    for (const note of zhNotes) {
      review.push(writeReviewItem(args.volumeId, reviewSeq++, {
        zh_chapter: chapter.zh,
        zh_id: note.id,
        ja_ids: [],
        confidence: 1,
        message: "中文译注/译版补充，日文原版无对应；不进入日文匹配。",
        recommended_action: "保留中文正文显示，不写日文 text_ja，不进入结构化抽取。",
        priority: "low",
      }));
    }

    let repaired = false;
    if (zhStory.length !== jaStory.length) {
      const windowSize = 18;
      const zhWindow = zhStory.slice(Math.max(0, zhStory.length - windowSize));
      const jaWindow = jaStory.slice(Math.max(0, jaStory.length - windowSize));
      const mappings = await repairWindow(store, chapter, zhWindow, jaWindow);
      const jaWindowIds = new Set(jaWindow.map((b) => b.id));
      const zhWindowIds = new Set(zhWindow.map((b) => b.id));
      for (const m of mappings) {
        if (!zhWindowIds.has(m.zh_id)) continue;
        const jaIds = (m.ja_ids ?? []).map(String).filter((id) => jaWindowIds.has(id));
        if (jaIds.length > 0) {
          out[m.zh_id] = jaIds.map((id) => jaById.get(id)?.text ?? "").filter(Boolean).join("\n");
          repaired = true;
        } else {
          delete out[m.zh_id];
          review.push(writeReviewItem(args.volumeId, reviewSeq++, {
            zh_chapter: chapter.zh,
            zh_id: m.zh_id,
            ja_ids: [],
            confidence: toNumber(m.confidence, 0.5),
            message: m.reason || "MiMo 判断该中文 block 无明确日文对应。",
            recommended_action: "人工确认是否为译版补充、分段差异或需要与前后日文合并。",
            priority: "medium",
          }));
        }
      }
    }

    const storyMissing = zhStory.filter((b) => !out[b.id]).map((b) => b.id);
    chapters.push({
      zh_chapter: chapter.zh,
      ja_chapters: chapter.ja,
      zh_story_blocks: zhStory.length,
      zh_extra_notes: zhNotes.map((b) => b.id),
      ja_story_blocks: jaStory.length,
      mapped_story_blocks: zhStory.length - storyMissing.length,
      story_missing: storyMissing,
      repaired_by_mimo: repaired,
    });
  }

  const volumeZhStory = chapters.reduce((n, ch) => n + Number((ch as Rec).zh_story_blocks ?? 0), 0);
  const volumeMapped = chapters.reduce((n, ch) => n + Number((ch as Rec).mapped_story_blocks ?? 0), 0);
  const storyMissing = chapters.flatMap((ch) => ((ch as Rec).story_missing as string[]) ?? []);

  store.writeJson(outRel, out);
  store.writeJsonl("review/ja_alignment_items.jsonl", review);
  store.writeJson("reports/ja_alignment_report.json", {
    generated_at: new Date().toISOString(),
    generator: "scripts/mimo-ja-alignment.ts",
    volume_id: args.volumeId,
    mode: "mimo_repaired_chapter_map",
    parsed_only_as_reference: true,
    writes_accepted: false,
    story_coverage: {
      zh_story_blocks: volumeZhStory,
      mapped_story_blocks: volumeMapped,
      ratio: volumeZhStory ? Number((volumeMapped / volumeZhStory).toFixed(4)) : 0,
      story_missing: storyMissing,
      review_items: review.length,
    },
    chapters,
  });
  store.writeJson("manifest.json", {
    ...manifest,
    features: { ...(manifest.features ?? {}), contains_ja_reference: true },
  });

  console.log(`[mimo-ja-alignment] ${store.root}`);
  console.log(`  story matched=${volumeMapped}/${volumeZhStory} missing=${storyMissing.length} review_items=${review.length}`);
  console.log(`  wrote ${outRel}`);
  console.log("  wrote reports/ja_alignment_report.json");
}

main().catch((err) => {
  console.error(`[mimo-ja-alignment] ${(err as Error).message}`);
  process.exitCode = 1;
});
