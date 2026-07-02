// OpenAI 通用协议的 chat 客户端（零依赖，用 Node 20+ 全局 fetch）。
//
// 起草与复核各自传入自己的 ModelConfig，因此可以指向不同厂商/不同模型。
// 只依赖 /chat/completions 这一通用端点，DeepSeek、MiMo 等兼容 OpenAI 协议
// 的供应商都能直接用。
import type { ModelConfig } from "./config.js";
import { buildChatRequest, type ChatOptions } from "./providers.js";

/** 多模态内容分片：文本或图片（OpenAI 通用格式，图片走 base64 data URI 或公网 URL）。 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** 把本地图片字节包成 OpenAI image_url 分片（base64 data URI）。 */
export function imagePart(bytes: Uint8Array, mime: string): ContentPart {
  const b64 = Buffer.from(bytes).toString("base64");
  return { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } };
}

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
  usage?: Record<string, unknown>;
  /** OpenAI 协议的 finish_reason；"length" 表示输出被 max_tokens 截断。 */
  finishReason?: string;
}

export class LlmError extends Error {}

/** 调用一次 chat completion，返回首条回复文本。 */
export async function chat(
  cfg: ModelConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResult> {
  if (!cfg.base_url || !cfg.api_key || !cfg.model)
    throw new LlmError("模型未配置：base_url / api_key / model 必填。");

  const req = buildChatRequest(cfg, messages, { temperature: 0.2, ...opts });

  let resp: Response;
  try {
    resp = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: opts.signal,
    });
  } catch (err) {
    throw new LlmError(`请求模型失败：${(err as Error).message}`);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new LlmError(`模型返回 ${resp.status}：${detail.slice(0, 400)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: Record<string, unknown>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LlmError("模型响应缺少 choices[0].message.content。");
  return {
    text,
    model: cfg.model,
    provider: req.provider,
    usage: data.usage,
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

export interface JsonlParseResult<T> {
  rows: T[];
  /** 无法解析的行数（截断尾行、模型夹带的说明文字等）。 */
  badLines: number;
}

/**
 * 容截断的 JSONL 解析：一行一个 JSON 对象，坏行跳过并计数。
 * 起草/复核 v2 的输出协议——截断只丢最后一行，已输出的行照收
 * （设计见 docs/modules/drafting-review-v2-design.md §6）。
 * 兼容 ```json 围栏与整段被包成 {"candidates":[...]} / [...] 的旧式输出。
 */
export function parseJsonlLoose<T = Record<string, unknown>>(text: string): JsonlParseResult<T> {
  const fenced = text.match(/```(?:json[l5]?)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();

  // 模型不听话时可能仍输出单个数组/包裹对象，先试整体解析。
  try {
    const whole = JSON.parse(body) as unknown;
    if (Array.isArray(whole)) return { rows: whole as T[], badLines: 0 };
    if (whole && typeof whole === "object") {
      for (const v of Object.values(whole as Record<string, unknown>)) {
        if (Array.isArray(v)) return { rows: v as T[], badLines: 0 };
      }
      return { rows: [whole as T], badLines: 0 };
    }
  } catch {
    /* 逐行解析 */
  }

  const rows: T[] = [];
  let badLines = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,\s*$/, "");
    if (!line) continue;
    if (!line.startsWith("{") && !line.startsWith("[")) {
      badLines += 1;
      continue;
    }
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      badLines += 1;
    }
  }
  return { rows, badLines };
}

/**
 * 从模型文本里抽出 JSON。兼容三种情况：纯 JSON、```json 围栏、文本中夹带 JSON。
 * 解析失败时抛 LlmError，附带原文片段方便排查。
 */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // 退而求其次：截取第一个 { 或 [ 到最后一个 } 或 ]。
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        /* fallthrough */
      }
    }
    throw new LlmError(`无法从模型输出解析 JSON：${trimmed.slice(0, 300)}`);
  }
}
