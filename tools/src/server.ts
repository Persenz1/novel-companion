// 工作台 HTTP 服务器（零依赖：node:http + 全局 fetch）。
//
// 同时提供 REST API 和静态前端（tools/web/）。启动：
//   npm run workbench           （默认端口 4173，可用 NC_PORT 覆盖）
// 首次打开在面板里配置 bookpack 路径 + 起草/复核 API，再开始起草。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "./fileStore.js";
import {
  loadConfig,
  saveConfig,
  redactConfig,
  type WorkbenchConfig,
  type ModelConfig,
} from "./agent/config.js";
import { WorkbenchData } from "./agent/workbenchData.js";
import { AgentStore } from "./agent/agentStore.js";
import { runDraft, runReview, resolveException, resolveExceptionsBatch } from "./agent/pipeline.js";
import type { ResolveDecision } from "./agent/pipeline.js";
import { buildReaderBook } from "./readerView.js";
import { CompiledQuery } from "./query.js";
import { Validator } from "./validator.js";
import { Compiler, CompileError } from "./compiler.js";
import { listCleaningAssets, annotateAsset, setAssetAlt } from "./cleaning/imageAnnotate.js";
import { importEpubToBookpack } from "./cleaning/epubImport.js";
import { prepareMimoCleaningInputs } from "./cleaning/mimoFeed.js";
import { runMimoCleaningTask } from "./cleaning/mimoRun.js";

type Rec = Record<string, unknown>;

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(here, "..", "web");
const PORT = Number(process.env.NC_PORT ?? 4173);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<Rec> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Rec);
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function openBookpack(cfg: WorkbenchConfig): FileStore {
  if (!cfg.bookpack_dir) throw new Error("尚未设置 bookpack 路径。");
  const store = new FileStore(cfg.bookpack_dir);
  if (!store.exists("manifest.json")) throw new Error(`目录下没有 manifest.json：${cfg.bookpack_dir}`);
  return store;
}

function readJsonIfExists<T>(store: FileStore, relative: string): T | null {
  if (!store.exists(relative)) return null;
  return store.readJson<T>(relative);
}

function safeReadBookpackJson(store: FileStore, relative: string): unknown {
  const abs = path.resolve(store.root, relative);
  if (!abs.startsWith(path.resolve(store.root))) throw new Error("路径越界。");
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${relative}`);
  return JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
}

function slugId(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "imported_series";
}

function epubPathsFromBody(body: Rec): string[] {
  const raw = Array.isArray(body.epub_paths) ? body.epub_paths : [body.epub_path];
  return raw
    .flatMap((value) => String(value ?? "").split(/\r?\n/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function volumeIdForEpub(epubPath: string, index: number): string {
  const stem = path.basename(epubPath, path.extname(epubPath));
  const m = /(?:^|[-_\s.])(v\d{1,3})(?:[-_\s.]|$)/i.exec(stem);
  if (m) return normalizeVolumeId(m[1]!);
  return `v${String(index + 1).padStart(2, "0")}`;
}

function normalizeVolumeId(value: string): string {
  const m = /^v0*(\d+)$/i.exec(value);
  if (!m) return value;
  return `v${String(Number(m[1])).padStart(2, "0")}`;
}

function batchStem(epubPaths: string[]): string {
  const first = path.basename(epubPaths[0]!, path.extname(epubPaths[0]!));
  if (epubPaths.length === 1) return first;
  const trimmed = first.replace(/[-_\s.]*v\d{1,3}$/i, "").replace(/[-_\s.]+$/g, "");
  return trimmed || first;
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  // "/" -> 工作台首页；"/reader/" -> 阅读器首页（其静态资源在 web/reader/ 下，用相对路径）。
  let rel: string;
  if (urlPath === "/") rel = "index.html";
  else if (urlPath === "/reader/") rel = "reader/index.html";
  else if (urlPath === "/cleaning/") rel = "cleaning/index.html";
  else rel = urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
}

/** 合并模型配置：api_key 为空表示沿用旧值，避免前端覆盖成空。 */
function mergeModel(old: ModelConfig, patch: Partial<ModelConfig> | undefined): ModelConfig {
  if (!patch) return old;
  return {
    provider: patch.provider ?? old.provider ?? "auto",
    base_url: patch.base_url ?? old.base_url,
    model: patch.model ?? old.model,
    api_key: patch.api_key && patch.api_key.length > 0 ? patch.api_key : old.api_key,
  };
}

interface UsageBucket {
  key: string;
  label: string;
  source: string;
  calls: number;
  prompt_tokens: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  prompt_uncategorized_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  visible_output_tokens: number;
  total_tokens: number;
  image_tokens: number;
  prompt_cache_hit_ratio: number | null;
}

function emptyUsageBucket(key: string, label: string, source: string): UsageBucket {
  return {
    key,
    label,
    source,
    calls: 0,
    prompt_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
    prompt_uncategorized_tokens: 0,
    completion_tokens: 0,
    reasoning_tokens: 0,
    visible_output_tokens: 0,
    total_tokens: 0,
    image_tokens: 0,
    prompt_cache_hit_ratio: null,
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageReasoningTokens(usage: Rec): number {
  return num(usage.reasoning_tokens) || num((usage.completion_tokens_details as Rec | undefined)?.reasoning_tokens);
}

function usageImageTokens(usage: Rec): number {
  return num(usage.image_tokens) || num((usage.prompt_tokens_details as Rec | undefined)?.image_tokens);
}

function addUsage(bucket: UsageBucket, usage: Rec | null | undefined): void {
  if (!usage) return;
  const prompt = num(usage.prompt_tokens);
  const hit = num(usage.prompt_cache_hit_tokens);
  const miss = num(usage.prompt_cache_miss_tokens);
  const completion = num(usage.completion_tokens);
  const reasoning = usageReasoningTokens(usage);

  bucket.calls += 1;
  bucket.prompt_tokens += prompt;
  bucket.prompt_cache_hit_tokens += hit;
  bucket.prompt_cache_miss_tokens += miss;
  bucket.prompt_uncategorized_tokens += hit || miss ? Math.max(0, prompt - hit - miss) : prompt;
  bucket.completion_tokens += completion;
  bucket.reasoning_tokens += reasoning;
  bucket.visible_output_tokens += Math.max(0, completion - reasoning);
  bucket.total_tokens += num(usage.total_tokens) || prompt + completion;
  bucket.image_tokens += usageImageTokens(usage);
}

function finalizeUsage(bucket: UsageBucket): UsageBucket {
  const denom = bucket.prompt_cache_hit_tokens + bucket.prompt_cache_miss_tokens;
  bucket.prompt_cache_hit_ratio = denom > 0 ? Number((bucket.prompt_cache_hit_tokens / denom).toFixed(4)) : null;
  return bucket;
}

function aggregateUsage(store: FileStore): Rec {
  const total = emptyUsageBucket("total", "总计", "all");
  const buckets = new Map<string, UsageBucket>();
  const recent: Rec[] = [];

  const bucketFor = (key: string, label: string, source: string): UsageBucket => {
    const found = buckets.get(key);
    if (found) return found;
    const created = emptyUsageBucket(key, label, source);
    buckets.set(key, created);
    return created;
  };
  const record = (bucket: UsageBucket, usage: Rec | null | undefined, detail: Rec): void => {
    if (!usage) return;
    addUsage(total, usage);
    addUsage(bucket, usage);
    recent.push({
      ...detail,
      prompt_tokens: num(usage.prompt_tokens),
      prompt_cache_hit_tokens: num(usage.prompt_cache_hit_tokens),
      prompt_cache_miss_tokens: num(usage.prompt_cache_miss_tokens),
      completion_tokens: num(usage.completion_tokens),
      reasoning_tokens: usageReasoningTokens(usage),
      total_tokens: num(usage.total_tokens),
      image_tokens: usageImageTokens(usage),
    });
  };

  for (const run of store.readJsonl<Rec>("reports/work_runs.jsonl").rows) {
    const stage = String(run.stage ?? "agent");
    const model = String(run.reviewer_model ?? run.drafter_model ?? "");
    const label = stage === "draft" ? "起草" : stage === "review" ? "复核" : stage;
    const modelLabel = model || "unknown-model";
    record(bucketFor(`agent:${stage}:${modelLabel}`, `${label} · ${modelLabel}`, "agent"), run.token_usage as Rec | undefined, {
      source: "agent",
      stage,
      model,
      chapter_id: run.chapter_id,
      created_at: run.created_at,
    });
  }

  for (const file of store.listDir("reports/cleaning_mimo_outputs").filter((name) => name.endsWith(".json")).sort()) {
    try {
      const out = store.readJson<Rec>(`reports/cleaning_mimo_outputs/${file}`);
      const model = String(out.model ?? "unknown-model");
      record(bucketFor(`cleaning:mimo:${model}`, `清洗 · ${model}`, "cleaning"), out.usage as Rec | undefined, {
        source: "cleaning",
        stage: "mimo_cleaning",
        model,
        chapter_id: out.chapter_id,
        file,
        suggestion_count: Array.isArray((out.parsed as Rec | undefined)?.suggestions)
          ? ((out.parsed as Rec).suggestions as unknown[]).length
          : 0,
      });
    } catch {
      /* Ignore malformed historical output files; validator handles bookpack correctness. */
    }
  }

  return {
    total: finalizeUsage(total),
    buckets: [...buckets.values()].map(finalizeUsage),
    recent: recent.slice(-40).reverse(),
  };
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const cfg = loadConfig();

  // 状态：配置 + bookpack 是否就绪
  if (pathname === "/api/state" && method === "GET") {
    let bookpack: Rec = { ok: false };
    try {
      const store = openBookpack(cfg);
      const m = new WorkbenchData(store).manifest();
      bookpack = { ok: true, pack_name: m.pack_name, series: m.series, volume_count: m.volumes.length };
    } catch (err) {
      bookpack = { ok: false, message: (err as Error).message };
    }
    return sendJson(res, 200, { config: redactConfig(cfg), bookpack });
  }

  if (pathname === "/api/config" && method === "POST") {
    const body = await readBody(req);
    const next: WorkbenchConfig = {
      bookpack_dir: typeof body.bookpack_dir === "string" ? body.bookpack_dir : cfg.bookpack_dir,
      drafter: mergeModel(cfg.drafter, body.drafter as Partial<ModelConfig>),
      reviewer: mergeModel(cfg.reviewer, body.reviewer as Partial<ModelConfig>),
      vision: mergeModel(cfg.vision, body.vision as Partial<ModelConfig>),
    };
    saveConfig(next);
    return sendJson(res, 200, { ok: true, config: redactConfig(next) });
  }

  if (pathname === "/api/chapters" && method === "GET") {
    const data = new WorkbenchData(openBookpack(cfg));
    return sendJson(res, 200, { chapters: data.chapters() });
  }

  if (pathname === "/api/usage" && method === "GET") {
    return sendJson(res, 200, aggregateUsage(openBookpack(cfg)));
  }

  // 阅读器视图（与工作台共用同一 bookpack 配置）：按阅读顺序展开的中日双语正文。
  if (pathname === "/api/book" && method === "GET") {
    return sendJson(res, 200, buildReaderBook(openBookpack(cfg)));
  }

  // 阅读器防剧透查询：完全复用 CompiledQuery，read_boundary 是唯一可见边界。
  if (pathname === "/api/context" && method === "GET") {
    const store = openBookpack(cfg);
    const url = new URL(pathname + "?" + (req.url?.split("?")[1] ?? ""), "http://localhost");
    if (!store.exists("compiled/reader_index.json"))
      return sendJson(res, 409, { error: "缺少 compiled/reader_index.json，请先 validate + compile。" });
    const ctx = CompiledQuery.load(store).getVisibleContext(
      url.searchParams.get("current_block") ?? "",
      url.searchParams.get("read_boundary") ?? "",
      { includeJa: url.searchParams.get("ja") === "1" },
    );
    return sendJson(res, 200, ctx);
  }

  const chBlocks = pathname.match(/^\/api\/chapters\/([^/]+)\/blocks$/);
  if (chBlocks && method === "GET") {
    const chapterId = decodeURIComponent(chBlocks[1]!);
    const data = new WorkbenchData(openBookpack(cfg));
    const blocks = data.blocksForChapter(chapterId).map((b) => {
      const m = data.markersForBlock(b.id);
      return {
        id: b.id,
        kind: b.kind,
        order: b.order,
        text: b.text,
        marker_count: m.length,
        accepted_count: m.filter((x) => x.kind === "accepted").length,
        candidate_count: m.filter((x) => x.kind === "candidate").length,
        exception_count: m.filter((x) => x.kind === "exception").length,
      };
    });
    return sendJson(res, 200, { chapter_id: chapterId, blocks });
  }

  const blkMarkers = pathname.match(/^\/api\/blocks\/([^/]+)\/markers$/);
  if (blkMarkers && method === "GET") {
    const blockId = decodeURIComponent(blkMarkers[1]!);
    const data = new WorkbenchData(openBookpack(cfg));
    return sendJson(res, 200, {
      block_id: blockId,
      markers: data.markersForBlock(blockId),
      assets: data.assetsForBlock(blockId),
    });
  }

  // 图片本体：纯文本模型看不见图，复核图片类必须靠这个把图显示出来。
  const assetReq = pathname.match(/^\/api\/asset\/([^/]+)$/);
  if (assetReq && method === "GET") {
    const store = openBookpack(cfg);
    const asset = new WorkbenchData(store).assetById(decodeURIComponent(assetReq[1]!));
    if (!asset?.path) return sendJson(res, 404, { error: "图片不存在" });
    const abs = path.resolve(store.root, asset.path);
    if (!abs.startsWith(path.resolve(store.root)) || !fs.existsSync(abs)) return sendJson(res, 404, { error: "图片文件缺失" });
    res.writeHead(200, { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(abs));
    return;
  }

  if (pathname === "/api/draft" && method === "POST") {
    const body = await readBody(req);
    const result = await runDraft(openBookpack(cfg), cfg, String(body.chapter_id));
    return sendJson(res, 200, result);
  }

  if (pathname === "/api/review" && method === "POST") {
    const body = await readBody(req);
    const result = await runReview(openBookpack(cfg), cfg, String(body.chapter_id));
    return sendJson(res, 200, result);
  }

  if (pathname === "/api/queue" && method === "GET") {
    const store = openBookpack(cfg);
    const data = new WorkbenchData(store);
    const candidates = data.candidates();
    const items = store.readJsonl<Rec>("review/review_items.jsonl").rows
      .filter((r) => (r as { status?: string }).status === "open")
      .map((r) => {
        // 图片类升级项：把关联图片附上，人才能看图裁决。
        const candId = String((r as { candidate_id?: string }).candidate_id ?? "");
        const cand = candidates.find((c) => c.id === candId);
        if (cand && cand.type === "asset_subject") {
          const assetId = String((cand.payload?.draft as Rec | undefined)?.asset_id ?? "");
          const asset = assetId ? data.assetById(assetId) : undefined;
          if (asset) return { ...r, asset: { id: asset.id, alt: asset.alt, url: `/api/asset/${asset.id}` } };
        }
        return r;
      });
    return sendJson(res, 200, { items });
  }

  if (pathname === "/api/queue/resolve" && method === "POST") {
    const body = await readBody(req);
    const result = resolveException(
      openBookpack(cfg),
      String(body.id),
      body.decision as "accept" | "reject" | "open_question",
      { editedDraft: body.edited_draft as Rec, note: body.note as string },
    );
    return sendJson(res, 200, result);
  }

  if (pathname === "/api/queue/resolve-batch" && method === "POST") {
    const body = await readBody(req);
    const decisions = (body.decisions as ResolveDecision[] | undefined) ?? [];
    if (!Array.isArray(decisions) || decisions.length === 0)
      return sendJson(res, 400, { error: "decisions 为空。" });
    const results = resolveExceptionsBatch(openBookpack(cfg), decisions);
    const accepted = results.filter((r) => r.decision === "accept").length;
    const rejected = results.filter((r) => r.decision === "reject").length;
    const openQuestions = results.filter((r) => r.decision === "open_question").length;
    return sendJson(res, 200, { results, accepted, rejected, open_questions: openQuestions });
  }

  if (pathname === "/api/compile" && method === "POST") {
    const store = openBookpack(cfg);
    const report = new Validator(store).validateBookpack();
    if (report.status === "failed")
      return sendJson(res, 409, {
        error: `validation status=${report.status}，无法 compile。`,
        errors: report.errors,
      });
    try {
      const idx = new Compiler(store).compileReaderIndex();
      const acceptedTotal = Object.values(idx.accepted).reduce((n, m) => n + Object.keys(m).length, 0);
      return sendJson(res, 200, {
        status: report.status,
        warnings: report.warnings.length,
        accepted: acceptedTotal,
        blocks: Object.keys(idx.blocks).length,
      });
    } catch (err) {
      if (err instanceof CompileError) return sendJson(res, 409, { error: err.message });
      throw err;
    }
  }

  // ---- 清洗·图片标注（Phase 1）----
  if (pathname === "/api/cleaning/auto-start" && method === "POST") {
    const body = await readBody(req);
    const epubPaths = epubPathsFromBody(body);
    if (epubPaths.length === 0) return sendJson(res, 400, { error: "epub_path 必填。" });
    const stem = batchStem(epubPaths);
    const id = slugId(stem);
    const targetDir = path.join("/tmp/novel-companion-cleaning", id);
    const imports = epubPaths.map((epubPath, idx) =>
      importEpubToBookpack(epubPath, targetDir, {
        volumeId: volumeIdForEpub(epubPath, idx),
        seriesId: id,
        packId: `${id}_project_v1`,
        packName: stem,
        force: idx === 0,
        append: idx > 0,
        parseAndValidate: true,
      }),
    );
    const next = { ...cfg, bookpack_dir: targetDir };
    saveConfig(next);
    const store = new FileStore(targetDir);
    const prepared = prepareMimoCleaningInputs(store);
    const chapterCount = imports.reduce((n, item) => n + item.chapter_count, 0);
    const blockCount = imports.reduce((n, item) => n + item.block_count, 0);
    const imageCount = imports.reduce((n, item) => n + item.image_count, 0);
    return sendJson(res, 200, {
      imported: imports[imports.length - 1],
      imports,
      import_summary: {
        epub_count: imports.length,
        volume_ids: imports.flatMap((item) => item.volume_ids),
        chapter_count: chapterCount,
        block_count: blockCount,
        image_count: imageCount,
        validation_status: imports[imports.length - 1]?.validation?.status ?? "unknown",
      },
      prepared,
      target_dir: targetDir,
      config: redactConfig(next),
    });
  }

  if (pathname === "/api/cleaning/import-epub" && method === "POST") {
    const body = await readBody(req);
    const epubPath = String(body.epub_path ?? "");
    const targetDir = String(body.target_dir ?? "");
    if (!epubPath || !targetDir) return sendJson(res, 400, { error: "epub_path 和 target_dir 必填。" });
    const result = importEpubToBookpack(epubPath, targetDir, {
      volumeId: typeof body.volume_id === "string" && body.volume_id ? body.volume_id : undefined,
      seriesId: typeof body.series_id === "string" && body.series_id ? body.series_id : undefined,
      packId: typeof body.pack_id === "string" && body.pack_id ? body.pack_id : undefined,
      packName: typeof body.pack_name === "string" && body.pack_name ? body.pack_name : undefined,
      force: body.force === true,
      append: body.append === true,
      parseAndValidate: true,
    });
    const next = { ...cfg, bookpack_dir: targetDir };
    saveConfig(next);
    return sendJson(res, 200, { ...result, config: redactConfig(next) });
  }

  if (pathname === "/api/cleaning/prepare-mimo" && method === "POST") {
    const body = await readBody(req);
    const result = prepareMimoCleaningInputs(
      openBookpack(cfg),
      typeof body.volume_id === "string" && body.volume_id ? body.volume_id : undefined,
    );
    return sendJson(res, 200, result);
  }

  if (pathname === "/api/cleaning/mimo-tasks" && method === "GET") {
    const store = openBookpack(cfg);
    const index = readJsonIfExists<Rec>(store, "reports/cleaning_mimo_inputs/index.json");
    return sendJson(res, 200, { index });
  }

  if (pathname === "/api/cleaning/run-mimo" && method === "POST") {
    const body = await readBody(req);
    const taskFile = String(body.task_file ?? "");
    if (!taskFile) return sendJson(res, 400, { error: "task_file 必填。" });
    const store = openBookpack(cfg);
    const result = await runMimoCleaningTask(store, cfg, taskFile);
    const output = safeReadBookpackJson(store, result.output_file);
    return sendJson(res, 200, { ...result, output });
  }

  if (pathname === "/api/cleaning/mimo-output" && method === "GET") {
    const store = openBookpack(cfg);
    const url = new URL(pathname + "?" + (req.url?.split("?")[1] ?? ""), "http://localhost");
    const file = url.searchParams.get("file");
    if (!file) return sendJson(res, 400, { error: "file 必填。" });
    return sendJson(res, 200, { output: safeReadBookpackJson(store, file) });
  }

  if (pathname === "/api/cleaning/assets" && method === "GET") {
    return sendJson(res, 200, { assets: listCleaningAssets(openBookpack(cfg)) });
  }

  if (pathname === "/api/cleaning/annotate" && method === "POST") {
    const body = await readBody(req);
    const annotation = await annotateAsset(
      openBookpack(cfg),
      cfg,
      String(body.asset_id),
      typeof body.roster === "string" ? body.roster : undefined,
    );
    return sendJson(res, 200, annotation);
  }

  if (pathname === "/api/cleaning/set-alt" && method === "POST") {
    const body = await readBody(req);
    const store = openBookpack(cfg);
    setAssetAlt(store, String(body.asset_id), String(body.alt ?? ""));
    const asset = listCleaningAssets(store).find((a) => a.id === String(body.asset_id));
    return sendJson(res, 200, { ok: true, asset });
  }

  if (pathname === "/api/changes" && method === "GET") {
    const store = openBookpack(cfg);
    const m = new WorkbenchData(store).manifest();
    const changes = new AgentStore(store, m.series.id).changes();
    return sendJson(res, 200, { changes });
  }

  if (pathname === "/api/revert" && method === "POST") {
    const body = await readBody(req);
    const store = openBookpack(cfg);
    const m = new WorkbenchData(store).manifest();
    const agentStore = new AgentStore(store, m.series.id);
    const result = body.work_run_id
      ? agentStore.revertWorkRun(String(body.work_run_id))
      : agentStore.revertChange(String(body.change_id));
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { error: "未知接口" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname).catch((err) => sendJson(res, 400, { error: (err as Error).message }));
    return;
  }
  if (pathname === "/cleaning") {
    res.writeHead(302, { location: "/cleaning/" });
    res.end();
    return;
  }
  if (pathname === "/reader") {
    res.writeHead(302, { location: "/reader/" });
    res.end();
    return;
  }
  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`[workbench] 数据工作台已启动：http://localhost:${PORT}`);
  console.log(`[workbench] 静态目录：${WEB_DIR}`);
});
