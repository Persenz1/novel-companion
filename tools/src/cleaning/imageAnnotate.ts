// 清洗阶段·图片标注子流程（Phase 1）。
//
// 让 vision 角色（如 MiMo）看图，产出 alt + 详细描述；人工在界面确认/修改后，
// 把确认的 alt 写回卷 Markdown 的 asset 标记并重解析。识别结果在清洗阶段定死，
// 下游操作阶段（纯文本）直接信任，无需把多模态模型接进 agent。
import { readFileSync } from "node:fs";
import path from "node:path";
import { FileStore } from "../fileStore.js";
import type { Asset, AssetAnchor, Manifest } from "../types.js";
import type { WorkbenchConfig } from "../agent/config.js";
import { isModelReady } from "../agent/config.js";
import { chat, imagePart, extractJson } from "../agent/llm.js";
import { Parser } from "../parser.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export interface CleaningAsset {
  id: string;
  alt: string | null;
  path: string | null;
  volume: string;
  anchor_block: string | null;
  url: string;
}

/** 列出 bookpack 里全部图片资产，带当前 alt、锚点 block 和可访问 url。 */
export function listCleaningAssets(store: FileStore): CleaningAsset[] {
  const assets = store.readJsonl<Asset>("parsed/assets.jsonl").rows;
  const anchors = store.readJsonl<AssetAnchor>("parsed/asset_anchors.jsonl").rows;
  return assets.map((a) => ({
    id: a.id,
    alt: a.alt,
    path: a.path,
    volume: a.source_volume_id,
    anchor_block: anchors.find((an) => an.asset_id === a.id)?.block_id ?? null,
    url: `/api/asset/${encodeURIComponent(a.id)}`,
  }));
}

export interface VisionAnnotation {
  alt: string;
  description: string;
  model: string;
}

/** 用 vision 角色识别一张图，产出建议 alt + 详细描述。roster 可选，用于按名册认人。 */
export async function annotateAsset(
  store: FileStore,
  cfg: WorkbenchConfig,
  assetId: string,
  roster?: string,
): Promise<VisionAnnotation> {
  if (!isModelReady(cfg.vision))
    throw new Error("vision 角色未配置：在 tools/.workbench-config.json 填好 vision 的 base_url / api_key / model。");
  const asset = store.readJsonl<Asset>("parsed/assets.jsonl").rows.find((a) => a.id === assetId);
  if (!asset) throw new Error(`找不到图片：${assetId}`);
  if (!asset.path) throw new Error(`图片没有文件：${assetId}`);
  const abs = path.resolve(store.root, asset.path);
  const bytes = readFileSync(abs);
  const mime = MIME[path.extname(abs).toLowerCase()] ?? "image/png";
  const rosterLine = roster && roster.trim() ? `已知角色名册（用于认人）：${roster.trim()}\n` : "";
  const prompt =
    `${rosterLine}你在为小说配图做清洗标注。请看图，只输出一个 JSON 对象、不要多余文字：` +
    `{"alt":"一句话图注：图里是谁/是什么（能对上名册就用角色名，简洁）",` +
    `"description":"简洁客观描述（150字以内）：主要人物/物体/场景，以及画面中的关键文字（原样）"}。` +
    `description 务必控制在 150 字内，确保 JSON 完整闭合。`;
  const r = await chat(
    cfg.vision,
    [{ role: "user", content: [imagePart(bytes, mime), { type: "text", text: prompt }] }],
    { maxCompletionTokens: 1200, jsonMode: true, thinking: "disabled" },
  );
  const parsed = extractJson<{ alt?: string; description?: string }>(r.text);
  return {
    alt: String(parsed.alt ?? "").trim(),
    description: String(parsed.description ?? "").trim(),
    model: r.model,
  };
}

/** 把确认的 alt 写回卷 Markdown 的 asset 标记，然后重解析 bookpack。 */
export function setAssetAlt(store: FileStore, assetId: string, alt: string): void {
  const manifest = store.readJson<Manifest>("manifest.json");
  const asset = store.readJsonl<Asset>("parsed/assets.jsonl").rows.find((a) => a.id === assetId);
  if (!asset) throw new Error(`找不到图片：${assetId}`);
  const volume = manifest.volumes.find((v) => v.id === asset.source_volume_id);
  if (!volume) throw new Error(`找不到卷：${asset.source_volume_id}`);

  const lines = store.readText(volume.main_text).split(/\r?\n/);
  const escId = assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isAssetLine = new RegExp(`<!--\\s*asset:\\s*${escId}\\b`);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (isAssetLine.test(lines[i]!)) {
      lines[i] = setAltInMarker(lines[i]!, alt);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Markdown 里找不到 asset 标记：${assetId}`);
  store.writeText(volume.main_text, lines.join("\n"));
  new Parser(store).parseBookpack(); // 重新生成 parsed/*（清洗前置，不动 accepted）
}

/** 替换 asset 标记里的 alt 值；没有 alt 键则在结尾 --> 前插入。alt 内的双引号降级为单引号。 */
function setAltInMarker(line: string, alt: string): string {
  const safe = alt.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  if (/\balt:\s*"(?:[^"\\]|\\.)*"/.test(line)) {
    return line.replace(/\balt:\s*"(?:[^"\\]|\\.)*"/, `alt: "${safe}"`);
  }
  return line.replace(/\s*-->\s*$/, ` alt: "${safe}" -->`);
}
