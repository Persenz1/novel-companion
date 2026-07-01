#!/usr/bin/env -S npx tsx
// Long-range Phase A runner: global Accepted memory + current-volume text.
//
// This script intentionally writes all model output into a /tmp working copy.
// It never rewrites tools/.workbench-config.json and never touches the source
// samples directory after copying it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Compiler } from "../src/compiler.js";
import { FileStore } from "../src/fileStore.js";
import type { Manifest } from "../src/types.js";
import { Validator } from "../src/validator.js";
import { loadConfig } from "../src/agent/config.js";
import { runDraft, runReview } from "../src/agent/pipeline.js";

type Rec = Record<string, unknown>;

interface Args {
  source: string;
  work: string;
  volumes: string[];
  runModel: boolean;
  force: boolean;
}

interface Metrics {
  label: string;
  counts: Record<string, number>;
  duplicate_entity_names: Array<{ key: string; ids: string[]; rows: Array<{ id: string; name: string }> }>;
  core_entities: Record<string, Array<{ id: string; name: string; first_seen?: string }>>;
  d_class_metric_changes: Array<{
    id: string;
    old_value?: unknown;
    new_value?: unknown;
    delta?: unknown;
    valid_from?: unknown;
    reason?: unknown;
  }>;
  linche_xu_relations: Array<{ id: string; before?: unknown; after?: unknown; valid_from?: unknown }>;
  xu_yingbai_flags: Array<{ file: string; id: string; text: string }>;
  review_escalations: Array<{ id: string; candidate_type?: unknown; message?: unknown; recommended_action?: unknown }>;
  work_runs: { total: number; draft: number; review: number; prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsRoot = path.resolve(here, "..");
const repoRoot = path.resolve(toolsRoot, "..");

const acceptedFiles: Array<[string, string]> = [
  ["entities", "accepted/entities.jsonl"],
  ["facts", "accepted/facts.jsonl"],
  ["events", "accepted/events.jsonl"],
  ["relation_changes", "accepted/relation_changes.jsonl"],
  ["metrics", "accepted/metrics.jsonl"],
  ["metric_changes", "accepted/metric_changes.jsonl"],
  ["character_cards", "accepted/character_cards.jsonl"],
  ["term_cards", "accepted/term_cards.jsonl"],
  ["speaker_labels", "accepted/speaker_labels.jsonl"],
  ["asset_subjects", "accepted/asset_subjects.jsonl"],
  ["changes", "accepted/changes.jsonl"],
];

const coreNames = ["林澈", "灰塔学院", "班级点数制度", "许映白", "周弥", "白川遥", "秦昭", "影子分组"];

function parseArgs(): Args {
  const out: Args = {
    source: path.join(repoRoot, "samples/gray-tower"),
    work: path.join("/tmp", `gt-longrange-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    volumes: ["v01", "v02"],
    runModel: false,
    force: false,
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--source") out.source = path.resolve(requireValue(args, ++i, a));
    else if (a === "--work") out.work = path.resolve(requireValue(args, ++i, a));
    else if (a === "--volumes") out.volumes = requireValue(args, ++i, a).split(",").filter(Boolean);
    else if (a === "--run-model") out.runModel = true;
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") usage();
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function requireValue(args: string[], i: number, flag: string): string {
  const v = args[i];
  if (!v) throw new Error(`${flag} requires a value`);
  return v;
}

function usage(): never {
  console.log(`Usage:
  npx tsx scripts/long-range-phase-a.ts --run-model [--work /tmp/gt-longrange] [--volumes v01,v02]

Options:
  --run-model       Required; this performs real LLM calls.
  --source DIR      Source bookpack to copy. Default: ../samples/gray-tower
  --work DIR        Working copy output dir. Default: /tmp/gt-longrange-<timestamp>
  --volumes CSV     Volumes to process in manifest order. Default: v01,v02
  --force           Remove --work if it already exists.
`);
  process.exit(0);
}

function readJsonl<T = Rec>(store: FileStore, file: string): T[] {
  return store.readJsonl<T>(file).rows;
}

function prepareWorkdir(source: string, work: string, force: boolean): void {
  if (!fs.existsSync(source)) throw new Error(`Source bookpack not found: ${source}`);
  if (fs.existsSync(work)) {
    if (!force) throw new Error(`Workdir already exists: ${work}. Pass --force to remove it.`);
    fs.rmSync(work, { recursive: true, force: true });
  }
  fs.cpSync(source, work, { recursive: true });
}

function chaptersForVolumes(manifest: Manifest, volumes: string[]): string[] {
  const wanted = new Set(volumes);
  return manifest.volumes.flatMap((v) =>
    wanted.has(v.id) ? [...v.chapters].sort((a, b) => a.order - b.order).map((ch) => ch.id) : [],
  );
}

function validateAndCompile(store: FileStore, label: string): void {
  const report = new Validator(store).validateBookpack();
  console.log(`[${label}] validate status=${report.status} errors=${report.errors.length} warnings=${report.warnings.length}`);
  for (const e of report.errors) console.log(`  [error] ${e.code} ${e.file ?? ""} ${e.message}`);
  for (const w of report.warnings) console.log(`  [warning] ${w.code} ${w.file ?? ""} ${w.message}`);
  if (report.status !== "passed") throw new Error(`[${label}] validation failed`);
  const idx = new Compiler(store).compileReaderIndex();
  const acceptedTotal = Object.values(idx.accepted).reduce((n, rows) => n + Object.keys(rows).length, 0);
  console.log(`[${label}] compile blocks=${Object.keys(idx.blocks).length} accepted=${acceptedTotal}`);
}

function normalizedName(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").trim();
}

function textOf(r: Rec): string {
  return JSON.stringify(r, null, 0);
}

function mentionsAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

function tokenCount(runs: Rec[], key: string): number {
  return runs.reduce((n, r) => {
    const usage = r.token_usage as Rec | undefined;
    const value = usage?.[key];
    return n + (typeof value === "number" ? value : 0);
  }, 0);
}

function collectMetrics(store: FileStore, label: string): Metrics {
  const rowsByFile = Object.fromEntries(acceptedFiles.map(([k, f]) => [k, readJsonl<Rec>(store, f)])) as Record<string, Rec[]>;
  const counts = Object.fromEntries(acceptedFiles.map(([k]) => [k, rowsByFile[k]?.length ?? 0]));
  counts.candidates = readJsonl(store, "candidates/candidates.jsonl").length;
  counts.review_items = readJsonl(store, "review/review_items.jsonl").length;
  counts.open_questions = readJsonl(store, "review/open_questions.jsonl").length;

  const entities = rowsByFile.entities ?? [];
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const e of entities) {
    const id = String(e.id ?? "");
    const names = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].map(normalizedName).filter(Boolean);
    for (const name of names) {
      const arr = groups.get(name) ?? [];
      arr.push({ id, name: String(e.name ?? "") });
      groups.set(name, arr);
    }
  }
  const duplicate_entity_names = [...groups.entries()]
    .map(([key, rows]) => ({ key, ids: [...new Set(rows.map((r) => r.id))], rows }))
    .filter((g) => g.ids.length > 1)
    .sort((a, b) => a.key.localeCompare(b.key, "zh-Hans-CN"));

  const core_entities: Metrics["core_entities"] = {};
  for (const name of coreNames) {
    core_entities[name] = entities
      .filter((e) => [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].map(normalizedName).includes(name))
      .map((e) => ({ id: String(e.id ?? ""), name: String(e.name ?? ""), first_seen: String(e.first_seen ?? "") }));
  }

  const dClassMetricIds = new Set(
    (rowsByFile.metrics ?? [])
      .filter((m) => mentionsAny(textOf(m), ["D班", "D 班", "Dclass", "dclass", "class_d", "class_1d", "班级点数", "联合点数"]))
      .map((m) => String(m.id ?? "")),
  );
  const dClassValuePairs = new Set(["0->100", "100->150", "150->190", "190->160", "160->130", "130->200"]);
  const d_class_metric_changes = (rowsByFile.metric_changes ?? [])
    .filter((m) => {
      const pair = `${String(m.old_value ?? "")}->${String(m.new_value ?? "")}`;
      return (
        dClassMetricIds.has(String(m.metric_id ?? "")) ||
        dClassValuePairs.has(pair) ||
        mentionsAny(textOf(m), ["D班", "D 班", "Dclass", "dclass", "class_d", "class_1d", "班级点数", "联合点数"])
      );
    })
    .map((m) => ({
      id: String(m.id ?? ""),
      old_value: m.old_value,
      new_value: m.new_value,
      delta: m.delta,
      valid_from: m.valid_from,
      reason: m.reason,
    }));

  const lincheIds = new Set(core_entities["林澈"].map((e) => e.id));
  const xuIds = new Set(core_entities["许映白"].map((e) => e.id));
  const linche_xu_relations = (rowsByFile.relation_changes ?? [])
    .filter((r) => {
      const ids = Array.isArray(r.entities) ? r.entities.map(String) : [];
      const t = textOf(r);
      return (ids.some((id) => lincheIds.has(id)) && ids.some((id) => xuIds.has(id))) || mentionsAny(t, ["林澈", "许映白"]);
    })
    .map((r) => ({ id: String(r.id ?? ""), before: r.before, after: r.after, valid_from: r.valid_from }));

  const xu_yingbai_flags: Metrics["xu_yingbai_flags"] = [];
  for (const [k, rows] of Object.entries(rowsByFile)) {
    for (const r of rows) {
      const t = textOf(r);
      if (mentionsAny(t, ["许映白"]) && mentionsAny(t, ["隐藏", "非公开", "不是真正", "观察员", "异常", "点数"])) {
        xu_yingbai_flags.push({ file: k, id: String(r.id ?? ""), text: t.slice(0, 280) });
      }
    }
  }
  for (const [file, rows] of [
    ["review_items", readJsonl<Rec>(store, "review/review_items.jsonl")],
    ["open_questions", readJsonl<Rec>(store, "review/open_questions.jsonl")],
  ] as const) {
    for (const r of rows) {
      const t = textOf(r);
      if (mentionsAny(t, ["许映白"]) && mentionsAny(t, ["隐藏", "非公开", "不是真正", "观察员", "异常", "点数"])) {
        xu_yingbai_flags.push({ file, id: String(r.id ?? ""), text: t.slice(0, 280) });
      }
    }
  }

  const reviewItems = readJsonl<Rec>(store, "review/review_items.jsonl");
  const review_escalations = reviewItems.map((r) => ({
    id: String(r.id ?? ""),
    candidate_type: r.candidate_type,
    message: r.message,
    recommended_action: r.recommended_action,
  }));
  const workRuns = readJsonl<Rec>(store, "reports/work_runs.jsonl");
  return {
    label,
    counts,
    duplicate_entity_names,
    core_entities,
    d_class_metric_changes,
    linche_xu_relations,
    xu_yingbai_flags,
    review_escalations,
    work_runs: {
      total: workRuns.length,
      draft: workRuns.filter((r) => r.stage === "draft").length,
      review: workRuns.filter((r) => r.stage === "review").length,
      prompt_tokens: tokenCount(workRuns, "prompt_tokens"),
      completion_tokens: tokenCount(workRuns, "completion_tokens"),
      total_tokens: tokenCount(workRuns, "total_tokens"),
    },
  };
}

function markdownReport(metrics: Metrics[], work: string): string {
  const lines: string[] = [];
  lines.push("# Long-range Phase A Report", "");
  lines.push(`workdir: \`${work}\``, "");
  for (const m of metrics) {
    lines.push(`## ${m.label}`, "");
    lines.push(`accepted counts: ${JSON.stringify(m.counts)}`);
    lines.push(`work runs: ${JSON.stringify(m.work_runs)}`, "");
    lines.push("### Entity Dedup");
    lines.push(m.duplicate_entity_names.length ? JSON.stringify(m.duplicate_entity_names, null, 2) : "No duplicate names/aliases detected.");
    lines.push("");
    lines.push("### Core Entities");
    lines.push(JSON.stringify(m.core_entities, null, 2), "");
    lines.push("### D Class Metric Changes");
    lines.push(m.d_class_metric_changes.length ? JSON.stringify(m.d_class_metric_changes, null, 2) : "None detected.");
    lines.push("");
    lines.push("### Linche / Xu Yingbai Relations");
    lines.push(m.linche_xu_relations.length ? JSON.stringify(m.linche_xu_relations, null, 2) : "None detected.");
    lines.push("");
    lines.push("### Xu Yingbai Flags / Escalations");
    lines.push(m.xu_yingbai_flags.length ? JSON.stringify(m.xu_yingbai_flags, null, 2) : "None detected.");
    lines.push("");
    lines.push("### Review Escalations");
    lines.push(m.review_escalations.length ? JSON.stringify(m.review_escalations, null, 2) : "None.");
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.runModel) {
    throw new Error("Refusing to call models without --run-model. Use --help for usage.");
  }
  const cfg = loadConfig();
  if (!cfg.drafter.api_key || !cfg.reviewer.api_key) throw new Error("Missing API key in tools/.workbench-config.json");
  if (!cfg.drafter.model || !cfg.reviewer.model) throw new Error("Missing model in tools/.workbench-config.json");
  if (cfg.drafter.model === cfg.reviewer.model) throw new Error("Drafter and reviewer must be different models for this test.");

  prepareWorkdir(args.source, args.work, args.force);
  const store = new FileStore(args.work);
  const manifest = store.readJson<Manifest>("manifest.json");
  const chapters = chaptersForVolumes(manifest, args.volumes);
  if (chapters.length === 0) throw new Error(`No chapters found for volumes: ${args.volumes.join(",")}`);

  console.log(`[setup] source=${args.source}`);
  console.log(`[setup] work=${args.work}`);
  console.log(`[setup] drafter=${cfg.drafter.model} reviewer=${cfg.reviewer.model}`);
  console.log(`[setup] chapters=${chapters.join(", ")}`);

  const metrics: Metrics[] = [];
  let lastVolume = "";
  for (const chapterId of chapters) {
    const volume = chapterId.split(".")[0] ?? "";
    if (lastVolume && volume !== lastVolume) {
      validateAndCompile(store, `after ${lastVolume}`);
      metrics.push(collectMetrics(store, `after ${lastVolume}`));
    }
    lastVolume = volume;
    console.log(`\n[draft] ${chapterId}`);
    const draft = await runDraft(store, cfg, chapterId);
    console.log(`  created=${draft.created} model=${draft.model}`);
    console.log(`[review] ${chapterId}`);
    const review = await runReview(store, cfg, chapterId);
    console.log(
      `  reviewed=${review.reviewed} auto=${review.auto_accepted} escalated=${review.escalated} rejected=${review.rejected} model=${review.reviewer_model}`,
    );
  }

  validateAndCompile(store, `after ${lastVolume}`);
  metrics.push(collectMetrics(store, `after ${lastVolume}`));

  const reportMd = markdownReport(metrics, args.work);
  const reportJson = JSON.stringify(metrics, null, 2) + "\n";
  fs.writeFileSync(path.join(args.work, "reports", "long-range-phase-a.md"), reportMd, "utf8");
  fs.writeFileSync(path.join(args.work, "reports", "long-range-phase-a.json"), reportJson, "utf8");
  console.log(`\n[done] report: ${path.join(args.work, "reports", "long-range-phase-a.md")}`);
  console.log(`[done] json:   ${path.join(args.work, "reports", "long-range-phase-a.json")}`);
}

main().catch((err) => {
  console.error(`[long-range-phase-a] ${(err as Error).message}`);
  process.exitCode = 1;
});
