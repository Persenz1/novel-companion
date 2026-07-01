# 模块：模型供应商适配

## 目标

模型调用必须通过统一 provider 层，不把供应商差异散落到清洗、起草、复核代码里。当前仍使用 OpenAI-compatible `/chat/completions` 路径，后续新增供应商时优先扩展 `tools/src/agent/providers.ts`。

## 当前实现

实现文件：

- `tools/src/agent/providers.ts`
- `tools/src/agent/llm.ts`

`ModelConfig` 支持：

```ts
provider?: "auto" | "openai" | "deepseek" | "mimo";
base_url: string;
api_key: string;
model: string;
```

`provider: "auto"` 时按 `base_url` / `model` 推断：

- DeepSeek：`api.deepseek.com` 或 `deepseek-*`
- MiMo：`mimo` / `xiaomimimo` 或模型名含 `mimo`
- 其它：generic OpenAI-compatible

## DeepSeek

官方要点：

- OpenAI-compatible base_url：`https://api.deepseek.com`
- 当前模型：`deepseek-v4-flash` / `deepseek-v4-pro`
- `deepseek-chat` / `deepseek-reasoner` 将于 `2026-07-24 23:59` 弃用。
- 思考开关：`thinking: { "type": "enabled" | "disabled" }`
- 思考强度：`reasoning_effort: "high" | "max"`；`low/medium` 会映射为 `high`。
- JSON 输出：`response_format: { "type": "json_object" }`，prompt 中也必须明确 JSON。
- 缓存默认开启；命中规则是完整前缀单元复用。返回字段包括 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。

当前策略：

- 起草 / 复核属于结构化抽取，默认 `jsonMode: true` + `thinking: "disabled"`。
- 起草 / 复核 `maxTokens: 8192`，避免候选 JSON 截断。
- `work_runs.token_usage` 记录 DeepSeek cache hit/miss 和 `prompt_cache_hit_ratio`，便于后续成本排查。

## MiMo

当前策略：

- 鉴权头使用 `api-key`。
- 图文输入走 OpenAI-compatible `image_url`，本地图片转 base64 data URI。
- 清洗建议和图片标注都使用 `jsonMode: true` + `thinking: "disabled"`。
- 清洗建议 `maxCompletionTokens: 2048`；关闭 thinking 后实测 `reasoning_tokens=0`，不再被推理过程吞完输出预算。

## 后续供应商接入

新增供应商时优先：

1. 先阅读该供应商官方文档，确认鉴权、模型名、上下文长度、token 参数、JSON 输出、思考模式、多模态输入和错误格式。
2. 在 `providers.ts` 增加 provider id 推断。
3. 定义鉴权头。
4. 定义 token 参数映射。
5. 定义 thinking / json / multimodal 支持情况。
6. 补一条最小实测命令或 fixture。
7. 保持调用方只传语义化选项：`jsonMode`、`thinking`、`maxTokens`、`maxCompletionTokens`。

不要在业务模块里直接判断供应商名称，也不要预留未阅读文档、未计划使用的供应商入口。
