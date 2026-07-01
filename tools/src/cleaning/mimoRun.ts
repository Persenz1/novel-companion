import fs from "node:fs";
import path from "node:path";
import { FileStore } from "../fileStore.js";
import { chat, extractJson, imagePart, type ChatMessage, type ContentPart } from "../agent/llm.js";
import type { ModelConfig } from "../agent/config.js";
import { isModelReady, type WorkbenchConfig } from "../agent/config.js";

type Rec = Record<string, unknown>;

interface ImageRefPart {
  type: "image_ref";
  image_ref: {
    asset_id: string;
    relative_path: string | null;
    absolute_path: string | null;
    anchor_block: string;
  };
}

interface TextPart {
  type: "text";
  text: string;
}

interface MimoTask {
  task_id: string;
  chapter: { id: string };
  local_images?: Array<{ asset_id: string }>;
  blocks?: Array<{ id: string }>;
  messages: Array<{ role: "system" | "user"; content: string | Array<TextPart | ImageRefPart> }>;
}

export interface MimoRunResult {
  task_id: string;
  chapter_id: string;
  model: string;
  output_file: string;
  suggestion_count: number;
  usage?: Record<string, unknown>;
}

export async function runMimoCleaningTask(
  store: FileStore,
  cfg: WorkbenchConfig,
  taskFile: string,
): Promise<MimoRunResult> {
  if (!isModelReady(cfg.vision)) {
    throw new Error("vision 角色未配置：base_url / api_key / model 必填。");
  }

  const relTaskFile = path.isAbsolute(taskFile) ? path.relative(store.root, taskFile) : taskFile;
  const task = store.readJson<MimoTask>(relTaskFile);
  const messages = task.messages.map((msg): ChatMessage => ({
    role: msg.role,
    content: convertContent(store, msg.content),
  }));

  const outputRel = `reports/cleaning_mimo_outputs/${safeFileName(task.task_id)}.json`;
  const allowedTargets = new Set<string>([
    task.chapter.id,
    ...((task.blocks ?? []).map((block) => block.id)),
    ...((task.local_images ?? []).map((image) => image.asset_id)),
  ]);
  const result = await chat(cfg.vision, messages, {
    maxCompletionTokens: 2048,
    jsonMode: true,
    thinking: "disabled",
  });
  let parsed: Rec;
  try {
    parsed = await parseCleaningJson(cfg.vision, result.text, allowedTargets);
  } catch (err) {
    store.writeJson(outputRel, {
      schema_version: "0.1.0",
      task_type: "mimo_cleaning_review_output",
      task_id: task.task_id,
      chapter_id: task.chapter.id,
      model: result.model,
      usage: result.usage ?? null,
      raw_text: result.text,
      parse_error: (err as Error).message,
      parsed: { suggestions: [] },
    });
    throw new Error(`MiMo 输出无法解析为清洗 JSON，原始输出已保存：${outputRel}`);
  }
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  store.writeJson(outputRel, {
    schema_version: "0.1.0",
    task_type: "mimo_cleaning_review_output",
    task_id: task.task_id,
    chapter_id: task.chapter.id,
    model: result.model,
    usage: result.usage ?? null,
    raw_text: result.text,
    parsed,
  });

  return {
    task_id: task.task_id,
    chapter_id: task.chapter.id,
    model: result.model,
    output_file: outputRel,
    suggestion_count: suggestions.length,
    usage: result.usage,
  };
}

async function parseCleaningJson(model: ModelConfig, text: string, allowedTargets: Set<string>): Promise<Rec> {
  if (!text.trim()) throw new Error("模型返回空内容，通常是 max_completion_tokens 被推理过程耗尽。");
  try {
    return normalizeCleaningOutput(extractJson<Rec>(text), allowedTargets);
  } catch {
    const repaired = await chat(
      model,
      [
        {
          role: "system",
          content:
            "你是 JSON 修复器。把用户给出的清洗建议改写为严格 JSON 对象，只能输出 JSON，不要解释。",
        },
        {
          role: "user",
          content:
            `请把下面内容改写为这个格式：` +
            `{"suggestions":[{"id":"s001","type":"set_asset_alt","target":"asset_or_block_id","confidence":0.8,"risk":"medium","reason":"原因","patch":{}}]}。\n` +
            `字段名只能使用 id/type/target/confidence/risk/reason/patch；type 只能是 split_block、merge_blocks、drop_noise、retitle_chapter、set_block_kind、set_scene、set_asset_alt、move_asset_anchor；risk 只能是 low、medium、high。\n\n` +
            text,
        },
      ],
      { maxCompletionTokens: 1200, jsonMode: true, thinking: "disabled" },
    );
    return normalizeCleaningOutput(extractJson<Rec>(repaired.text), allowedTargets);
  }
}

function normalizeCleaningOutput(value: Rec, allowedTargets: Set<string>): Rec {
  const raw = Array.isArray(value.suggestions) ? value.suggestions : [];
  return {
    ...value,
    suggestions: raw
      .map((item, idx) => normalizeSuggestion(item as Rec, idx))
      .filter((item) => isRealSuggestion(item, allowedTargets)),
  };
}

function normalizeSuggestion(item: Rec, idx: number): Rec {
  const action = String(item.type ?? item.action ?? "set_asset_alt");
  const risk = normalizeRisk(item.risk ?? item.priority);
  const rawPatch = item.patch;
  const patch = typeof rawPatch === "object" && rawPatch !== null
    ? (rawPatch as Rec)
    : typeof rawPatch === "string" && rawPatch.trim()
      ? normalizePatchString(rawPatch.trim())
      : {};
  if (item.value !== undefined && patch.value === undefined) patch.value = item.value;
  return {
    id: String(item.id ?? `s${String(idx + 1).padStart(3, "0")}`),
    type: normalizeType(action),
    target: String(item.target ?? ""),
    confidence: normalizeConfidence(item.confidence),
    risk,
    reason: String(item.reason ?? item.detail ?? ""),
    patch,
  };
}

function normalizePatchString(value: string): Rec {
  const setAlt = /^set_asset_alt\(\s*["'][^"']+["']\s*,\s*["'](.+)["']\s*\)$/s.exec(value);
  if (setAlt) return { alt: setAlt[1] };
  return { alt: value };
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number") return Math.max(0, Math.min(1, value));
  const v = String(value ?? "").toLowerCase();
  if (v === "high" || v.includes("高")) return 0.9;
  if (v === "low" || v.includes("低")) return 0.5;
  return 0.7;
}

function isRealSuggestion(item: Rec, allowedTargets: Set<string>): boolean {
  const target = String(item.target ?? "");
  const reason = String(item.reason ?? "");
  if (!target || target === "asset_or_block_id" || target === "block_id" || target === "chapter_id" || target === "asset_id") return false;
  if (!allowedTargets.has(target)) return false;
  if (!reason || reason === "原因" || reason === "string") return false;
  return true;
}

function normalizeType(type: string): string {
  const known = new Set([
    "split_block",
    "merge_blocks",
    "drop_noise",
    "retitle_chapter",
    "set_block_kind",
    "set_scene",
    "set_asset_alt",
    "move_asset_anchor",
  ]);
  if (known.has(type)) return type;
  if (type === "modify_asset_ref") return "move_asset_anchor";
  return "set_asset_alt";
}

function normalizeRisk(value: unknown): "low" | "medium" | "high" {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("高") || v === "high") return "high";
  if (v.includes("低") || v === "low") return "low";
  return "medium";
}

function convertContent(store: FileStore, content: MimoTask["messages"][number]["content"]): string | ContentPart[] {
  if (typeof content === "string") return content;
  return content.map((part): ContentPart => {
    if (part.type === "text") return { type: "text", text: part.text };
    const imagePath = part.image_ref.absolute_path ?? (part.image_ref.relative_path ? store.abs(part.image_ref.relative_path) : null);
    if (!imagePath) throw new Error(`任务图片缺少路径：${part.image_ref.asset_id}`);
    const bytes = fs.readFileSync(imagePath);
    return imagePart(bytes, mimeFor(imagePath));
  });
}

function mimeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

function safeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]+/g, "_");
}
