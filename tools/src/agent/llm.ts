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
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Record<string, unknown>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LlmError("模型响应缺少 choices[0].message.content。");
  return { text, model: cfg.model, provider: req.provider, usage: data.usage };
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
