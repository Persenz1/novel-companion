#!/usr/bin/env -S npx tsx
// novel-companion phase 1 CLI.
//
// Usage:
//   nc parse <bookpack-dir> [volume_id]
//
// `parse` runs the Parser over a bookpack: it regenerates parsed/*.jsonl and
// reports/cleaning_report.json. With a volume_id it parses only that volume
// (dry-run, prints a summary) without writing files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { FileStore } from "./fileStore.js";
import { Parser } from "./parser.js";
import { Validator } from "./validator.js";
import { Compiler, CompileError } from "./compiler.js";
import { CompiledQuery } from "./query.js";
import { loadConfig, isModelReady } from "./agent/config.js";
import { chat, imagePart } from "./agent/llm.js";

function usage(): never {
  console.error("Usage:");
  console.error("  nc parse <bookpack-dir> [volume_id]");
  console.error("  nc validate <bookpack-dir>");
  console.error("  nc compile <bookpack-dir>");
  console.error("  nc query <bookpack-dir> <current_block> <read_boundary> [--ja]");
  console.error("  nc describe-image <image-path> [prompt]   # 用 vision 角色（如 MiMo）识图");
  process.exit(2);
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function cmdDescribeImage(args: string[]): Promise<void> {
  const [imagePath, ...promptParts] = args;
  if (!imagePath) usage();
  const cfg = loadConfig();
  if (!isModelReady(cfg.vision))
    throw new Error("vision 角色未配置：在 tools/.workbench-config.json 填好 vision 的 base_url / api_key / model。");
  const mime = MIME_BY_EXT[path.extname(imagePath).toLowerCase()] ?? "image/png";
  const bytes = readFileSync(imagePath);
  const prompt = promptParts.join(" ") || "用中文详细描述这张图里有哪些人物、物体、场景和文字。";
  const r = await chat(
    cfg.vision,
    [{ role: "user", content: [imagePart(bytes, mime), { type: "text", text: prompt }] }],
    { maxCompletionTokens: 1024 },
  );
  console.log(`[describe-image] model=${r.model} file=${imagePath} (${mime}, ${bytes.length} bytes)`);
  console.log(r.text);
  if (r.usage) console.log(`\nusage: ${JSON.stringify(r.usage)}`);
}

function cmdParse(args: string[]): void {
  const [bookpackDir, volumeId] = args;
  if (!bookpackDir) usage();

  const store = new FileStore(bookpackDir);
  const parser = new Parser(store);

  if (volumeId) {
    const { bundle, notes } = parser.parseVolume(volumeId);
    console.log(`[parse] volume ${volumeId} (dry-run, no files written)`);
    console.log(
      `  blocks=${bundle.blocks.length} scenes=${bundle.scenes.length} ` +
        `assets=${bundle.assets.length} anchors=${bundle.asset_anchors.length} ` +
        `alignments=${bundle.alignments.length}`,
    );
    printNotes(notes);
    return;
  }

  const report = parser.parseBookpack();
  console.log(`[parse] bookpack ${store.root}`);
  console.log(`  status=${report.status}`);
  for (const v of report.volumes) {
    console.log(
      `  ${v.volume_id}: blocks=${v.block_count} scenes=${v.scene_count} ` +
        `assets=${v.asset_count} alignments=${v.alignment_count}`,
    );
  }
  console.log(
    `  totals: blocks=${report.counts.blocks} scenes=${report.counts.scenes} ` +
      `assets=${report.counts.assets} anchors=${report.counts.asset_anchors} ` +
      `alignments=${report.counts.alignments}`,
  );
  printNotes(report.notes);
  console.log("  wrote parsed/*.jsonl + reports/cleaning_report.json");
}

function printNotes(notes: { severity: string; code: string; message: string; line?: number }[]): void {
  if (notes.length === 0) {
    console.log("  notes: none");
    return;
  }
  console.log(`  notes: ${notes.length}`);
  for (const n of notes) {
    const at = n.line ? `:${n.line}` : "";
    console.log(`    [${n.severity}] ${n.code}${at} ${n.message}`);
  }
}

function cmdValidate(args: string[]): void {
  const [bookpackDir] = args;
  if (!bookpackDir) usage();

  const store = new FileStore(bookpackDir);
  const report = new Validator(store).validateBookpack();

  console.log(`[validate] bookpack ${store.root}`);
  console.log(`  status=${report.status} errors=${report.errors.length} warnings=${report.warnings.length}`);
  for (const e of report.errors) {
    const at = e.line ? `:${e.line}` : "";
    console.log(`    [error]   ${e.code} ${e.file ?? ""}${at} ${e.message}`);
  }
  for (const w of report.warnings) {
    const at = w.line ? `:${w.line}` : "";
    console.log(`    [warning] ${w.code} ${w.file ?? ""}${at} ${w.message}`);
  }
  console.log("  wrote reports/validation_report.json");
  if (report.status === "failed") process.exitCode = 1;
}

function cmdCompile(args: string[]): void {
  const [bookpackDir] = args;
  if (!bookpackDir) usage();
  const store = new FileStore(bookpackDir);
  try {
    const idx = new Compiler(store).compileReaderIndex();
    console.log(`[compile] bookpack ${store.root}`);
    console.log(`  timeline positions=${idx.timeline.positions.length}`);
    const acceptedTotal = Object.values(idx.accepted).reduce((n, m) => n + Object.keys(m).length, 0);
    console.log(`  blocks=${Object.keys(idx.blocks).length} accepted=${acceptedTotal}`);
    console.log("  wrote compiled/reader_index.json");
  } catch (err) {
    if (err instanceof CompileError) {
      console.error(`[compile] refused: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function cmdQuery(args: string[]): void {
  const [bookpackDir, currentBlock, readBoundary, ...flags] = args;
  if (!bookpackDir || !currentBlock || !readBoundary) usage();
  const store = new FileStore(bookpackDir);
  const ctx = CompiledQuery.load(store).getVisibleContext(currentBlock, readBoundary, {
    includeJa: flags.includes("--ja"),
  });
  console.log(JSON.stringify(ctx, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "parse":
      cmdParse(rest);
      break;
    case "validate":
      cmdValidate(rest);
      break;
    case "compile":
      cmdCompile(rest);
      break;
    case "query":
      cmdQuery(rest);
      break;
    case "describe-image":
      await cmdDescribeImage(rest);
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
