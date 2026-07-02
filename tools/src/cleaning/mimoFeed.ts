import { FileStore } from "../fileStore.js";
import type { Asset, AssetAnchor, Block, Manifest, ManifestChapter } from "../types.js";
import { isBodyChapterKind } from "../chapterKind.js";

type Rec = Record<string, unknown>;

export interface MimoFeedResult {
  output_dir: string;
  task_count: number;
  image_count: number;
  tasks: Array<{ id: string; chapter_id: string; file: string; block_count: number; image_count: number }>;
}

interface ChapterTask {
  schema_version: "0.1.0";
  task_type: "mimo_cleaning_review";
  task_id: string;
  series: Manifest["series"];
  volume: { id: string; title: string };
  chapter: ManifestChapter & { volume_id: string };
  constraints: string[];
  expected_output_schema: Rec;
  local_images: Array<{
    asset_id: string;
    relative_path: string | null;
    absolute_path: string | null;
    anchor_block: string;
    anchor_type: string;
    current_alt: string | null;
  }>;
  blocks: Array<{
    id: string;
    order: number;
    kind: string;
    text: string;
    anchored_assets: string[];
  }>;
  messages: Array<{
    role: "system" | "user";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | {
              type: "image_ref";
              image_ref: {
                asset_id: string;
                relative_path: string | null;
                absolute_path: string | null;
                anchor_block: string;
              };
            }
        >;
  }>;
}

export function prepareMimoCleaningInputs(store: FileStore, volumeId?: string): MimoFeedResult {
  const manifest = store.readJson<Manifest>("manifest.json");
  const blocks = store.readJsonl<Block>("parsed/blocks.jsonl").rows;
  const assets = store.readJsonl<Asset>("parsed/assets.jsonl").rows;
  const anchors = store.readJsonl<AssetAnchor>("parsed/asset_anchors.jsonl").rows;
  if (blocks.length === 0) throw new Error("parsed/blocks.jsonl 为空；请先 import-epub 或 parse。");

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const anchorsByBlock = new Map<string, AssetAnchor[]>();
  for (const anchor of anchors) {
    const list = anchorsByBlock.get(anchor.block_id) ?? [];
    list.push(anchor);
    anchorsByBlock.set(anchor.block_id, list);
  }

  const tasks: MimoFeedResult["tasks"] = [];
  const outDir = "reports/cleaning_mimo_inputs";
  let totalImages = 0;

  for (const volume of manifest.volumes) {
    if (volumeId && volume.id !== volumeId) continue;
    for (const chapter of [...volume.chapters].sort((a, b) => a.order - b.order)) {
      if (!isBodyChapterKind(chapter.kind)) continue;
      const chapterBlocks = blocks
        .filter((block) => block.chapter_id === chapter.id)
        .sort((a, b) => a.order - b.order);
      if (chapterBlocks.length === 0) continue;
      const task = buildTask(store, manifest, volume, chapter, chapterBlocks, anchorsByBlock, assetById);
      const file = `${outDir}/${safeFileName(chapter.id)}.json`;
      store.writeJson(file, task);
      tasks.push({
        id: task.task_id,
        chapter_id: chapter.id,
        file,
        block_count: task.blocks.length,
        image_count: task.local_images.length,
      });
      totalImages += task.local_images.length;
    }
  }

  if (tasks.length === 0) throw new Error(volumeId ? `没有可生成的章节任务：${volumeId}` : "没有可生成的章节任务。");

  store.writeJson(`${outDir}/index.json`, {
    schema_version: "0.1.0",
    task_type: "mimo_cleaning_review_index",
    generated_at: new Date().toISOString(),
    bookpack_dir: store.root,
    series: manifest.series,
    volume_id: volumeId ?? null,
    task_count: tasks.length,
    image_count: totalImages,
    tasks,
  });

  return {
    output_dir: store.abs(outDir),
    task_count: tasks.length,
    image_count: totalImages,
    tasks,
  };
}

function buildTask(
  store: FileStore,
  manifest: Manifest,
  volume: Manifest["volumes"][number],
  chapter: ManifestChapter,
  blocks: Block[],
  anchorsByBlock: Map<string, AssetAnchor[]>,
  assetById: Map<string, Asset>,
): ChapterTask {
  const localImages: ChapterTask["local_images"] = [];
  const feedBlocks: ChapterTask["blocks"] = [];

  for (const block of blocks) {
    const anchors = anchorsByBlock.get(block.id) ?? [];
    const anchoredAssets: string[] = [];
    for (const anchor of anchors) {
      const asset = assetById.get(anchor.asset_id);
      if (!asset) continue;
      anchoredAssets.push(asset.id);
      localImages.push({
        asset_id: asset.id,
        relative_path: asset.path,
        absolute_path: asset.path ? store.abs(asset.path) : null,
        anchor_block: block.id,
        anchor_type: anchor.anchor_type,
        current_alt: asset.alt,
      });
    }
    feedBlocks.push({
      id: block.id,
      order: block.order,
      kind: block.kind,
      text: block.text,
      anchored_assets: anchoredAssets,
    });
  }

  const taskId = `clean_${chapter.id}`;
  const chapterText = feedBlocks
    .map((block) => {
      const assets = block.anchored_assets.length ? `\n[assets: ${block.anchored_assets.join(", ")}]` : "";
      return `<!-- block: ${block.id} kind: ${block.kind} -->\n${block.text}${assets}`;
    })
    .join("\n\n");

  const imageRefs = localImages.map((image) => ({
    type: "image_ref" as const,
    image_ref: {
      asset_id: image.asset_id,
      relative_path: image.relative_path,
      absolute_path: image.absolute_path,
      anchor_block: image.anchor_block,
    },
  }));
  const outputRules =
    `输出必须是严格 JSON 对象，不要 Markdown 代码块，不要解释文字。格式如下：\n` +
    `顶层只能有 suggestions 数组；每个数组元素必须是对象。\n` +
    `字段名只能使用 id/type/target/confidence/risk/reason/patch；不要使用 action/detail/priority/value。\n` +
    `type 只能是 split_block、merge_blocks、drop_noise、retitle_chapter、set_block_kind、set_scene、set_asset_alt、move_asset_anchor。\n` +
    `target 必须是本任务里真实存在的 block_id、chapter_id 或 asset_id，禁止输出 asset_or_block_id 等占位值。\n` +
    `patch 必须是对象，且按类型给字段：\n` +
    `  set_asset_alt → {"alt":"一句话中文图注"}；alt 只描述画面本身（谁、在做什么、场景），一律用中文，30 字内，` +
    `不要写“设置 alt 为”之类的话，不要抄录图中大段日文/英文。\n` +
    `  set_block_kind → {"kind":"..."}；set_scene 不需要 patch；move_asset_anchor → {"block":"目标 block_id"}；` +
    `retitle_chapter → {"title":"中文章节名"}；drop_noise 不需要 patch。\n` +
    `消歧规则：仅含单独数字或符号、用作场景分隔的 block 已由系统自动规范为 separator；` +
    `不要再对这类 block 或已是 separator 的 block 提 drop_noise / set_scene / set_block_kind。\n` +
    `不要展开推理过程；快速检查后直接输出 JSON。\n` +
    `risk 只能是 low、medium、high。没有真实建议时输出空 suggestions 数组。`;

  return {
    schema_version: "0.1.0",
    task_type: "mimo_cleaning_review",
    task_id: taskId,
    series: manifest.series,
    volume: { id: volume.id, title: volume.title },
    chapter: { ...chapter, volume_id: volume.id },
    constraints: [
      "不要改写小说正文。",
      "只提出结构清洗建议、图片图注建议和明显噪声处理建议。",
      "删除、跨章移动、合并章节、人物身份判断都必须标为 high risk。",
      "图注一律用中文；alt 只描述画面，不抄图中大段外文，不写“设置 alt”之类的话。",
      "仅含数字/符号的场景分隔 block 已由系统规范化，不要再对其提 drop_noise/set_scene。",
      "输出必须是 JSON 对象，且只包含 suggestions 数组。",
      "每条建议都必须引用现有 block_id 或 asset_id。",
    ],
    expected_output_schema: {
      suggestions: [
        {
          id: "string",
          type: "split_block | merge_blocks | drop_noise | retitle_chapter | set_block_kind | set_scene | set_asset_alt | move_asset_anchor",
          target: "block_id | chapter_id | asset_id",
          confidence: "number 0..1",
          risk: "low | medium | high",
          reason: "string",
          patch: '按类型：set_asset_alt={"alt":"中文图注"}, set_block_kind={"kind":"..."}, move_asset_anchor={"block":"block_id"}, retitle_chapter={"title":"..."}, drop_noise/set_scene 可为空',
        },
      ],
    },
    local_images: localImages,
    blocks: feedBlocks,
    messages: [
      {
        role: "system",
        content:
          "你是小说 EPUB 清洗助手。你负责检查章节结构、block 切分、图片锚点和图注。不要改写正文，只输出 JSON 清洗建议。",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `请检查以下章节的清洗质量，并按 expected_output_schema 输出 JSON。\n\n` +
              `系列：${manifest.series.title}\n卷：${volume.title} (${volume.id})\n章节：${chapter.title} (${chapter.id})\n\n` +
              `已知图片会以 image_ref 给出；如果需要设置图注，请建议 set_asset_alt。\n\n` +
              `${outputRules}\n\n` +
              `正文：\n${chapterText}`,
          },
          ...imageRefs,
        ],
      },
    ],
  };
}

function safeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]+/g, "_");
}
