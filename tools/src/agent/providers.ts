import type { ModelConfig } from "./config.js";
import type { ChatMessage } from "./llm.js";

export type ProviderId = "openai" | "deepseek" | "mimo" | "generic";

export interface ChatOptions {
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: "low" | "medium" | "high" | "max";
  thinking?: "enabled" | "disabled";
  signal?: AbortSignal;
}

export interface ChatRequestSpec {
  provider: ProviderId;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function resolveProvider(cfg: ModelConfig): ProviderId {
  if (cfg.provider && cfg.provider !== "auto") return cfg.provider;
  const base = cfg.base_url.toLowerCase();
  const model = cfg.model.toLowerCase();
  if (base.includes("deepseek.com") || model.startsWith("deepseek-")) return "deepseek";
  if (base.includes("mimo") || base.includes("xiaomimimo") || model.includes("mimo")) return "mimo";
  return "generic";
}

export function buildChatRequest(cfg: ModelConfig, messages: ChatMessage[], opts: ChatOptions = {}): ChatRequestSpec {
  const provider = resolveProvider(cfg);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
  };

  if (opts.temperature !== undefined && shouldSendTemperature(provider, opts)) {
    body.temperature = opts.temperature;
  }
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.maxCompletionTokens && provider === "mimo") body.max_completion_tokens = opts.maxCompletionTokens;
  if (opts.maxCompletionTokens && provider !== "mimo" && !opts.maxTokens) body.max_tokens = opts.maxCompletionTokens;
  if (opts.thinking && supportsThinking(provider)) body.thinking = { type: opts.thinking };
  if (opts.reasoningEffort && supportsReasoningEffort(provider)) body.reasoning_effort = opts.reasoningEffort;

  return {
    provider,
    url: joinUrl(cfg.base_url, "/chat/completions"),
    headers: authHeaders(provider, cfg.api_key),
    body,
  };
}

function authHeaders(provider: ProviderId, apiKey: string): Record<string, string> {
  const common = { "content-type": "application/json" };
  if (provider === "mimo") return { ...common, "api-key": apiKey };
  if (provider === "generic") return { ...common, authorization: `Bearer ${apiKey}`, "api-key": apiKey };
  return { ...common, authorization: `Bearer ${apiKey}` };
}

function shouldSendTemperature(provider: ProviderId, opts: ChatOptions): boolean {
  // DeepSeek/MiMo thinking mode ignores sampling params; avoid sending inert knobs.
  return !(supportsThinking(provider) && opts.thinking === "enabled");
}

function supportsThinking(provider: ProviderId): boolean {
  return provider === "deepseek" || provider === "mimo";
}

function supportsReasoningEffort(provider: ProviderId): boolean {
  return provider === "deepseek";
}

function joinUrl(base: string, suffix: string): string {
  return base.replace(/\/+$/, "") + suffix;
}
