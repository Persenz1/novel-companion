// 本地工作台配置：API/供应商设置 + 当前 bookpack 路径。
//
// 配置存在 tools/.workbench-config.json（已 gitignore，不进 bookpack、不含正文）。
// 采用 OpenAI 通用协议：每个角色一组 { base_url, api_key, model }。
// 起草与复核模型分离，复核模型应不同于起草模型（双 AI 制衡，见
// docs/modules/ai-workbench.md）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// tools/.workbench-config.json
const CONFIG_PATH = path.resolve(here, "..", "..", ".workbench-config.json");

export interface ModelConfig {
  base_url: string; // 例如 https://api.deepseek.com/v1
  api_key: string;
  model: string; // 例如 ds4flash / dsv4pro / mimov2.5
}

export interface WorkbenchConfig {
  bookpack_dir: string; // 当前打开的 bookpack 根目录
  drafter: ModelConfig; // 起草角色
  reviewer: ModelConfig; // 复核角色
  vision: ModelConfig; // 识图角色（多模态，如 mimo-v2.5）；未配则图片仍走人工队列
}

const EMPTY_MODEL: ModelConfig = { base_url: "", api_key: "", model: "" };

export function defaultConfig(bookpackDir = ""): WorkbenchConfig {
  return {
    bookpack_dir: bookpackDir,
    drafter: { ...EMPTY_MODEL },
    reviewer: { ...EMPTY_MODEL },
    vision: { ...EMPTY_MODEL },
  };
}

export function loadConfig(): WorkbenchConfig {
  if (!fs.existsSync(CONFIG_PATH)) return defaultConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<WorkbenchConfig>;
    return {
      bookpack_dir: raw.bookpack_dir ?? "",
      drafter: { ...EMPTY_MODEL, ...(raw.drafter ?? {}) },
      reviewer: { ...EMPTY_MODEL, ...(raw.reviewer ?? {}) },
      vision: { ...EMPTY_MODEL, ...(raw.vision ?? {}) },
    };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: WorkbenchConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/** 不向前端回传 api_key 明文：只标注是否已配置。 */
export function redactConfig(cfg: WorkbenchConfig): unknown {
  const redactModel = (m: ModelConfig) => ({
    base_url: m.base_url,
    model: m.model,
    api_key_set: Boolean(m.api_key),
  });
  return {
    bookpack_dir: cfg.bookpack_dir,
    drafter: redactModel(cfg.drafter),
    reviewer: redactModel(cfg.reviewer),
    vision: redactModel(cfg.vision),
  };
}

export function isModelReady(m: ModelConfig): boolean {
  return Boolean(m.base_url && m.api_key && m.model);
}
