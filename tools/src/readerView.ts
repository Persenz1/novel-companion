// 阅读器读侧视图：把 manifest + Parsed + 双语日文组织成按阅读顺序展开的分节流。
// 只读，供独立阅读器（reader.ts）和合并后的工作台（server.ts）共用。
//
// 中文正文是唯一时间线主轴、防剧透基准；日文是每个 block 的 1:1 并列显示文本，
// 来自 source/ja/{volume}.blocks.json，不建立独立阅读进度（docs/modules/reader.md）。
import { FileStore } from "./fileStore.js";
import type { Asset, AssetAnchor, Block, Manifest } from "./types.js";
import { isReadableChapterKind } from "./chapterKind.js";

type Rec = Record<string, unknown>;

export function buildReaderBook(store: FileStore): Rec {
  const manifest = store.readJson<Manifest>("manifest.json");
  const blocks = store.readJsonl<Block>("parsed/blocks.jsonl").rows;
  const assets = store.readJsonl<Asset>("parsed/assets.jsonl").rows;
  const anchors = store.readJsonl<AssetAnchor>("parsed/asset_anchors.jsonl").rows;

  // 双语日文：每卷 source/ja/{volume}.blocks.json（block_id -> 日文），1:1 对应 block。
  const jaByBlock = new Map<string, string>();
  for (const v of manifest.volumes) {
    const rel = `source/ja/${v.id}.blocks.json`;
    if (!store.exists(rel)) continue;
    const map = store.readJson<Record<string, string>>(rel);
    for (const [bid, text] of Object.entries(map)) if (text) jaByBlock.set(bid, text);
  }

  // 说话人：accepted/speaker_labels.jsonl（Accepted 正式数据），按 block 挂到正文。
  // 一个 block 可有 0..N 个说话人（群体对话）；只有带标记的才显示，无标记不加。
  // 防剧透交给阅读器侧按 visible_from 与已读边界显隐（与 read/beyond 同一套）。
  const speakersByBlock = new Map<string, Rec[]>();
  if (store.exists("accepted/speaker_labels.jsonl")) {
    for (const s of store.readJsonl<Rec>("accepted/speaker_labels.jsonl").rows) {
      if (s.status && s.status !== "accepted") continue;
      const bid = s.block_id as string;
      if (!bid) continue;
      const arr = speakersByBlock.get(bid) ?? [];
      arr.push({
        name: (s.display_name as string) || (s.speaker_entity_id as string) || (s.speaker_type as string) || "说话人",
        speaker_type: s.speaker_type ?? null,
        visible_from: (s.visible_from as string) || bid,
      });
      speakersByBlock.set(bid, arr);
    }
  }

  const blocksByChapter = new Map<string, Block[]>();
  for (const b of blocks) {
    const arr = blocksByChapter.get(b.chapter_id) ?? [];
    arr.push(b);
    blocksByChapter.set(b.chapter_id, arr);
  }
  for (const arr of blocksByChapter.values()) arr.sort((a, b) => a.order - b.order);

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const anchorsByBlock = new Map<string, AssetAnchor[]>();
  for (const an of anchors) {
    const arr = anchorsByBlock.get(an.block_id) ?? [];
    arr.push(an);
    anchorsByBlock.set(an.block_id, arr);
  }
  const assetsForBlock = (blockId: string) =>
    (anchorsByBlock.get(blockId) ?? []).flatMap((an) => {
      const a = assetById.get(an.asset_id);
      return a ? [{ id: a.id, alt: a.alt, url: `/api/asset/${a.id}`, anchor_type: an.anchor_type }] : [];
    });

  const sections: Rec[] = [];
  const order: string[] = [];
  const toc: Rec[] = [];

  for (const volume of manifest.volumes) {
    sections.push({ type: "volume", id: volume.id, title: volume.title });
    const chapters = [...volume.chapters].sort((a, b) => a.order - b.order);
    for (const chapter of chapters) {
      if (!isReadableChapterKind(chapter.kind)) continue;
      sections.push({ type: "chapter", id: chapter.id, title: chapter.title, kind: chapter.kind });
      const chBlocks = blocksByChapter.get(chapter.id) ?? [];
      toc.push({
        id: chapter.id,
        title: chapter.title,
        kind: chapter.kind,
        volume_id: volume.id,
        first_block: chBlocks[0]?.id ?? null,
      });
      for (const b of chBlocks) {
        order.push(b.id);
        sections.push({
          type: "block",
          id: b.id,
          chapter_id: b.chapter_id,
          volume_id: b.volume_id,
          kind: b.kind,
          text: b.text,
          index: order.length - 1,
          assets: assetsForBlock(b.id),
          text_ja: jaByBlock.get(b.id) ?? null,
          speakers: speakersByBlock.get(b.id) ?? [],
        });
      }
    }
  }

  return {
    pack_name: manifest.pack_name,
    series: manifest.series,
    has_ja: jaByBlock.size > 0,
    has_speakers: speakersByBlock.size > 0,
    sections,
    order,
    toc,
  };
}
