// Cleaning readiness gate: the machine-checkable half of "perfect cleaning
// data". Runs the acceptance checklist and reports which items block moving on
// to drafting. Compile should only be allowed once ready is true.
import { FileStore } from "../fileStore.js";
import { Validator } from "../validator.js";
import type { Asset, AssetAnchor, Block, Manifest } from "../types.js";
import { isBodyChapterKind } from "./epubImport.js";
import { isIsolatedSeparator } from "./normalize.js";
import { readItems } from "./cleaningStore.js";

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  blocking: boolean;
  count: number;
  detail: string;
  examples: string[];
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
}

/** True when an alt is empty or a bare numeric/short placeholder, not a caption. */
export function isPlaceholderAlt(alt: string | null | undefined): boolean {
  const t = (alt ?? "").trim();
  if (!t) return true;
  if (/^\d{1,4}$/.test(t)) return true; // "001", "006"
  if (/^(彩页|插图|图|image|illustration|img)\s*\d*$/i.test(t)) return true;
  return false;
}

export function checkReadiness(store: FileStore): ReadinessReport {
  const manifest = store.readJson<Manifest>("manifest.json");
  const blocks = store.readJsonl<Block>("parsed/blocks.jsonl").rows;
  const assets = store.readJsonl<Asset>("parsed/assets.jsonl").rows;
  const anchors = store.readJsonl<AssetAnchor>("parsed/asset_anchors.jsonl").rows;
  const blockIds = new Set(blocks.map((b) => b.id));

  const validation = new Validator(store).validateBookpack();
  const noise = blocks.filter((b) => b.kind !== "separator" && isIsolatedSeparator(b.text));
  // A numeric/short placeholder alt (e.g. EPUB's "001", "彩页1") is not a real
  // caption — count it as missing so every image gets a proper cleaned caption.
  const noAlt = assets.filter((a) => isPlaceholderAlt(a.alt));
  const anchorByAsset = new Map(anchors.map((an) => [an.asset_id, an]));
  const badAnchor = assets.filter((a) => {
    const an = anchorByAsset.get(a.id);
    return !an || !an.block_id || !blockIds.has(an.block_id);
  });
  const openItems = readItems(store).filter((it) => it.status === "open");
  const bodyChapters = manifest.volumes.flatMap((v) => v.chapters).filter((c) => isBodyChapterKind(c.kind));

  const checks: ReadinessCheck[] = [
    {
      id: "validation",
      ok: validation.status === "passed",
      blocking: true,
      count: validation.errors.length,
      detail: validation.status === "passed" ? "校验通过" : `${validation.errors.length} 个校验错误`,
      examples: validation.errors.slice(0, 5).map((e) => `${e.code} ${e.message}`),
    },
    {
      id: "no_noise_blocks",
      ok: noise.length === 0,
      blocking: true,
      count: noise.length,
      detail: noise.length === 0 ? "无残留噪声/未归类分隔 block" : `${noise.length} 个孤立数字/符号 block 仍是正文（应 normalize）`,
      examples: noise.slice(0, 5).map((b) => `${b.id}="${b.text}"`),
    },
    {
      id: "images_have_alt",
      ok: noAlt.length === 0,
      blocking: true,
      count: noAlt.length,
      detail: noAlt.length === 0 ? "所有图片都有图注" : `${noAlt.length} 张图片缺图注`,
      examples: noAlt.slice(0, 5).map((a) => a.id),
    },
    {
      id: "images_anchored",
      ok: badAnchor.length === 0,
      blocking: true,
      count: badAnchor.length,
      detail: badAnchor.length === 0 ? "所有图片锚点有效" : `${badAnchor.length} 张图片锚点缺失/失效`,
      examples: badAnchor.slice(0, 5).map((a) => a.id),
    },
    {
      id: "suggestions_adjudicated",
      ok: openItems.length === 0,
      blocking: false,
      count: openItems.length,
      detail: openItems.length === 0 ? "清洗建议已全部裁决" : `${openItems.length} 条清洗建议未裁决`,
      examples: openItems.slice(0, 5).map((it) => `${it.id} ${it.type}`),
    },
    {
      id: "has_body_chapters",
      ok: bodyChapters.length > 0,
      blocking: true,
      count: bodyChapters.length,
      detail: `${bodyChapters.length} 个正文章节`,
      examples: [],
    },
  ];

  const ready = checks.every((c) => !c.blocking || c.ok);
  return { ready, checks };
}
