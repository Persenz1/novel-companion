// 最低限度 Markdown 阅读器服务器（只读；零依赖：node:http）。
//
// 只读 manifest / Parsed / Compiled，不改 schema、parser、validator、样例数据
// （docs/modules/reader.md）。防剧透查询完全复用 CompiledQuery.getVisibleContext，
// read_boundary 是唯一可见边界，current_block 只决定当前位置相关性。
//
// 启动：
//   npm run reader                       （默认读 ../samples/gray-tower）
//   npx tsx src/reader.ts <bookpack-dir> （显式指定数据包目录）
//   NC_BOOKPACK=<dir> NC_PORT=4174 npm run reader
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "./fileStore.js";
import { CompiledQuery } from "./query.js";
import { buildReaderBook } from "./readerView.js";
import type { Asset } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(here, "..", "web", "reader");
const PORT = Number(process.env.NC_PORT ?? 4174);
const BOOKPACK_DIR = path.resolve(
  process.argv[2] ?? process.env.NC_BOOKPACK ?? path.resolve(here, "..", "..", "samples", "gray-tower"),
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
}

function assetById(store: FileStore, id: string): Asset | undefined {
  return store.readJsonl<Asset>("parsed/assets.jsonl").rows.find((a) => a.id === id);
}

function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const store = new FileStore(BOOKPACK_DIR);
  if (!store.exists("manifest.json")) {
    return sendJson(res, 500, { error: `数据包目录下没有 manifest.json：${BOOKPACK_DIR}` });
  }
  const pathname = url.pathname;

  if (pathname === "/api/book" && req.method === "GET") {
    return sendJson(res, 200, buildReaderBook(store));
  }

  // 防剧透查询：完全复用 compiled 查询，read_boundary 是唯一可见边界。
  if (pathname === "/api/context" && req.method === "GET") {
    const currentBlock = url.searchParams.get("current_block") ?? "";
    const readBoundary = url.searchParams.get("read_boundary") ?? "";
    const includeJa = url.searchParams.get("ja") === "1";
    if (!store.exists("compiled/reader_index.json")) {
      return sendJson(res, 409, { error: "缺少 compiled/reader_index.json，请先运行 validate + compile。" });
    }
    const ctx = CompiledQuery.load(store).getVisibleContext(currentBlock, readBoundary, { includeJa });
    return sendJson(res, 200, ctx);
  }

  // 图片本体（只读）。
  const assetReq = pathname.match(/^\/api\/asset\/([^/]+)$/);
  if (assetReq && req.method === "GET") {
    const asset = assetById(store, decodeURIComponent(assetReq[1]!));
    if (!asset?.path) return sendJson(res, 404, { error: "图片不存在" });
    const abs = path.resolve(store.root, asset.path);
    if (!abs.startsWith(path.resolve(store.root)) || !fs.existsSync(abs)) {
      return sendJson(res, 404, { error: "图片文件缺失" });
    }
    res.writeHead(200, { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(abs));
    return;
  }

  sendJson(res, 404, { error: "未知接口" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      handleApi(req, res, url);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`[reader] 阅读器已启动：http://localhost:${PORT}`);
  console.log(`[reader] 数据包：${BOOKPACK_DIR}`);
});
