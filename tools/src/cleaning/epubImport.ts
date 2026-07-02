import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { FileStore } from "../fileStore.js";
import { Parser } from "../parser.js";
import { Validator } from "../validator.js";
import type { BlockKind, Manifest, ValidationReport } from "../types.js";

interface ZipFileEntry {
  name: string;
  data: Buffer;
}

interface OpfManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface OpfPackage {
  rootDir: string;
  title: string;
  language: string | null;
  manifest: OpfManifestItem[];
  spineIds: string[];
}

interface ImportedBlock {
  id: string;
  kind: BlockKind;
  text: string;
}

interface ImportedAsset {
  id: string;
  block: string;
  anchorType: "after_block" | "before_block";
  alt: string;
  sourceZipPath: string;
  targetRelPath: string;
}

interface ImportedChapter {
  volumeId: string;
  volumeTitle: string | null;
  id: string;
  kind: string;
  order: number;
  title: string;
  blocks: ImportedBlock[];
  assets: ImportedAsset[];
}

export interface ImportEpubOptions {
  volumeId?: string;
  seriesId?: string;
  packId?: string;
  packName?: string;
  force?: boolean;
  append?: boolean;
  parseAndValidate?: boolean;
}

export interface ImportEpubResult {
  bookpack_dir: string;
  title: string;
  volume_id: string;
  volume_ids: string[];
  volume_count: number;
  chapter_count: number;
  block_count: number;
  image_count: number;
  validation?: ValidationReport;
}

export function importEpubToBookpack(
  epubPath: string,
  bookpackDir: string,
  options: ImportEpubOptions = {},
): ImportEpubResult {
  const fallbackVolumeId = options.volumeId ?? "v01";
  const target = new FileStore(bookpackDir);
  if (target.exists("manifest.json") && !options.force && !options.append) {
    throw new Error(`target already contains manifest.json: ${target.root}. Pass --force to overwrite or --append to add volumes.`);
  }

  const zip = readZip(epubPath);
  const container = textEntry(zip, "META-INF/container.xml");
  const opfPath = attr(container, "rootfile", "full-path");
  if (!opfPath) throw new Error("EPUB container.xml does not declare rootfile full-path.");
  const opf = parseOpf(textEntry(zip, opfPath), opfPath);
  const spineItems = opf.spineIds
    .map((idref) => opf.manifest.find((item) => item.id === idref))
    .filter((item): item is OpfManifestItem => Boolean(item))
    .filter((item) => item.mediaType === "application/xhtml+xml");

  const chapters = spineItems.map((item, idx) => {
    const itemPath = joinZipPath(opf.rootDir, item.href);
    return parseChapterXhtml(textEntry(zip, itemPath), {
      href: itemPath,
      volumeId: fallbackVolumeId,
      forceVolumeId: options.volumeId,
      order: idx,
      opfRoot: opf.rootDir,
    });
  });

  const allAssets = chapters.flatMap((chapter) => chapter.assets);
  const volumes = groupChaptersByVolume(chapters);
  writeImportedBookpack(target, zip, {
    title: options.packName ?? opf.title,
    seriesId: options.seriesId ?? slug(opf.title || "imported_book"),
    packId: options.packId ?? `${slug(opf.title || "imported_book")}_project_v1`,
    volumes,
    assets: allAssets,
    force: options.force === true,
    append: options.append === true,
  });

  let validation: ValidationReport | undefined;
  if (options.parseAndValidate !== false) {
    new Parser(target).parseBookpack();
    validation = new Validator(target).validateBookpack();
  }

  return {
    bookpack_dir: target.root,
    title: opf.title,
    volume_id: volumes[0]?.id ?? fallbackVolumeId,
    volume_ids: volumes.map((volume) => volume.id),
    volume_count: volumes.length,
    chapter_count: chapters.length,
    block_count: chapters.reduce((n, ch) => n + ch.blocks.length, 0),
    image_count: allAssets.length,
    validation,
  };
}

function parseOpf(xml: string, opfPath: string): OpfPackage {
  const rootDir = path.posix.dirname(opfPath) === "." ? "" : path.posix.dirname(opfPath);
  const title = textOf(xml, "dc:title") || textOf(xml, "title") || "Imported Book";
  const language = textOf(xml, "dc:language") || textOf(xml, "language") || null;
  const manifestBlock = blockOf(xml, "manifest");
  const spineBlock = blockOf(xml, "spine");
  const manifest: OpfManifestItem[] = [...manifestBlock.matchAll(/<item\b([^>]*)\/?>/g)].map((m) => ({
    id: attrFromAttrs(m[1]!, "id") ?? "",
    href: attrFromAttrs(m[1]!, "href") ?? "",
    mediaType: attrFromAttrs(m[1]!, "media-type") ?? "",
    properties: attrFromAttrs(m[1]!, "properties") ?? undefined,
  }));
  const spineIds = [...spineBlock.matchAll(/<itemref\b([^>]*)\/?>/g)]
    .map((m) => attrFromAttrs(m[1]!, "idref"))
    .filter((id): id is string => Boolean(id));
  if (manifest.length === 0) throw new Error("OPF manifest is empty or unparseable.");
  if (spineIds.length === 0) throw new Error("OPF spine is empty or unparseable.");
  return { rootDir, title: decodeEntities(stripTags(title)).trim(), language, manifest, spineIds };
}

function parseChapterXhtml(
  xhtml: string,
  ctx: { href: string; volumeId: string; forceVolumeId?: string; order: number; opfRoot: string },
): ImportedChapter {
  const sectionAttrs = firstAttrs(xhtml, "section");
  const declaredChapterId = attrFromAttrs(sectionAttrs, "data-nc-chapter-id");
  const volumeId =
    ctx.forceVolumeId ??
    attrFromAttrs(sectionAttrs, "data-nc-volume-id") ??
    volumeIdFromChapterId(declaredChapterId) ??
    ctx.volumeId;
  const volumeTitle = attrFromAttrs(sectionAttrs, "data-nc-volume-title");
  const chapterId = declaredChapterId ?? generatedChapterId(volumeId, ctx.order, xhtml);
  const title = decodeEntities(stripTags(textOf(xhtml, "h1") || textOf(xhtml, "title") || `Chapter ${ctx.order + 1}`)).trim();
  const kind = attrFromAttrs(sectionAttrs, "epub:type") ?? inferChapterKind(title, ctx.order);
  const body = blockOf(xhtml, "body") || xhtml;
  const tokens = [...body.matchAll(/<(p|hr|figure)\b([^>]*)>([\s\S]*?)<\/\1>|<hr\b([^>]*)\/?>/gi)];
  const blocks: ImportedBlock[] = [];
  const assets: ImportedAsset[] = [];
  let nextBlockNo = 1;
  let nextImageNo = 1;
  let lastBlockId = "";

  for (const token of tokens) {
    const tag = (token[1] ?? "hr").toLowerCase();
    const attrsText = token[2] ?? token[4] ?? "";
    const inner = token[3] ?? "";

    if (tag === "p") {
      const text = decodeEntities(stripTags(inner)).trim();
      if (!text) continue;
      const id = attrFromAttrs(attrsText, "data-nc-block-id") ?? `${chapterId}.b${String(nextBlockNo).padStart(4, "0")}`;
      const kind = normalizeBlockKind(attrFromAttrs(attrsText, "class"), text);
      blocks.push({ id, kind, text });
      lastBlockId = id;
      nextBlockNo += 1;
      continue;
    }

    if (tag === "hr") {
      const id = attrFromAttrs(attrsText, "data-nc-block-id") ?? `${chapterId}.b${String(nextBlockNo).padStart(4, "0")}`;
      blocks.push({ id, kind: "separator", text: "---" });
      lastBlockId = id;
      nextBlockNo += 1;
      continue;
    }

    if (tag === "figure") {
      const imgAttrs = firstAttrs(inner, "img");
      const src = attrFromAttrs(imgAttrs, "src");
      if (!src) continue;
      const sourceZipPath = normalizeZipPath(path.posix.join(path.posix.dirname(ctx.href), decodeEntities(src)));
      const fallbackId = `${volumeId}_img_${String(nextImageNo).padStart(3, "0")}`;
      const id = attrFromAttrs(attrsText, "data-nc-asset-id") ?? fallbackId;
      const alt = decodeEntities(attrFromAttrs(imgAttrs, "alt") ?? "");
      const ext = path.posix.extname(sourceZipPath) || ".png";
      assets.push({
        id,
        block: lastBlockId,
        anchorType: "after_block",
        alt,
        sourceZipPath,
        targetRelPath: `assets/images/${id}${ext}`,
      });
      nextImageNo += 1;
    }
  }

  // For image-first chapters, attach the image to the first block once known.
  for (const asset of assets) {
    if (!asset.block && blocks[0]) asset.block = blocks[0].id;
  }

  return { volumeId, volumeTitle, id: chapterId, kind, order: ctx.order, title, blocks, assets };
}

function groupChaptersByVolume(chapters: ImportedChapter[]): Array<{ id: string; title: string; chapters: ImportedChapter[] }> {
  const volumes: Array<{ id: string; title: string; chapters: ImportedChapter[] }> = [];
  const byId = new Map<string, { id: string; title: string; chapters: ImportedChapter[] }>();

  for (const chapter of chapters) {
    let volume = byId.get(chapter.volumeId);
    if (!volume) {
      volume = {
        id: chapter.volumeId,
        title: chapter.volumeTitle || titleForVolume(chapter.volumeId, volumes.length),
        chapters: [],
      };
      byId.set(chapter.volumeId, volume);
      volumes.push(volume);
    } else if (chapter.volumeTitle && volume.title === titleForVolume(chapter.volumeId, volumes.indexOf(volume))) {
      volume.title = chapter.volumeTitle;
    }
    volume.chapters.push({ ...chapter, order: volume.chapters.length });
  }

  return volumes;
}

function writeImportedBookpack(
  store: FileStore,
  zip: Map<string, ZipFileEntry>,
  input: {
    title: string;
    seriesId: string;
    packId: string;
    volumes: Array<{ id: string; title: string; chapters: ImportedChapter[] }>;
    assets: ImportedAsset[];
    force: boolean;
    append: boolean;
  },
): void {
  if (input.force) {
    for (const rel of ["manifest.json", "parsed/volumes", "assets/images"]) {
      const abs = store.abs(rel);
      if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
    }
  }

  const importedVolumes: Manifest["volumes"] = input.volumes.map((volume) => ({
    id: volume.id,
    title: volume.title,
    main_text: `parsed/volumes/${volume.id}.md`,
    chapters: volume.chapters.map((chapter) => ({
      id: chapter.id,
      order: chapter.order,
      kind: chapter.kind,
      title: chapter.title,
    })),
  }));

  const existing = input.append && store.exists("manifest.json") ? store.readJson<Manifest>("manifest.json") : null;
  const manifest: Manifest = existing
    ? mergeManifestVolumes(existing, importedVolumes, input.assets.length > 0)
    : {
        schema_version: "0.1.0",
        pack_id: input.packId,
        pack_name: `${input.title} 工程包`,
        pack_type: "project",
        series: { id: input.seriesId, title: input.title },
        volumes: importedVolumes,
        features: {
          contains_text: true,
          contains_assets: input.assets.length > 0,
          contains_ja_reference: false,
        },
        rights: {
          usage_scope: "local_user_import",
          rights_note: "用户本地导入 EPUB；请确认来源与使用权利。",
        },
      };

  store.writeJson("manifest.json", manifest);
  for (const volume of input.volumes) {
    store.writeText(`parsed/volumes/${volume.id}.md`, renderMarkdown(volume.chapters));
  }
  for (const asset of input.assets) {
    const entry = zip.get(asset.sourceZipPath);
    if (!entry) continue;
    const target = store.abs(asset.targetRelPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
}

function mergeManifestVolumes(existing: Manifest, importedVolumes: Manifest["volumes"], containsAssets: boolean): Manifest {
  const volumes = [...existing.volumes];
  for (const volume of importedVolumes) {
    const idx = volumes.findIndex((v) => v.id === volume.id);
    if (idx >= 0) volumes[idx] = volume;
    else volumes.push(volume);
  }
  return {
    ...existing,
    volumes,
    features: {
      ...(existing.features ?? {}),
      contains_text: true,
      contains_assets: Boolean(existing.features?.contains_assets || containsAssets),
    },
  };
}

function renderMarkdown(chapters: ImportedChapter[]): string {
  const out: string[] = [];
  for (const chapter of chapters) {
    out.push(`<!-- chapter: ${chapter.id} kind: ${chapter.kind} title: "${markerText(chapter.title)}" -->`);
    out.push(`# ${chapter.title}`);
    out.push("");
    const sceneId = `${chapter.id}.s001`;
    out.push(`<!-- scene: ${sceneId} action: start title: "${markerText(chapter.title)}" -->`);
    out.push("");
    const assetsByBlock = new Map<string, ImportedAsset[]>();
    for (const asset of chapter.assets) {
      if (!asset.block) continue;
      const list = assetsByBlock.get(asset.block) ?? [];
      list.push(asset);
      assetsByBlock.set(asset.block, list);
    }
    for (const block of chapter.blocks) {
      out.push(`<!-- block: ${block.id} kind: ${block.kind} -->`);
      out.push(block.text);
      out.push("");
      for (const asset of assetsByBlock.get(block.id) ?? []) {
        out.push(
          `<!-- asset: ${asset.id} anchor_type: ${asset.anchorType} block: ${asset.block} alt: "${markerText(asset.alt)}" -->`,
        );
        out.push("");
      }
    }
    out.push(`<!-- scene: ${sceneId} action: end -->`);
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

function readZip(filePath: string): Map<string, ZipFileEntry> {
  const data = fs.readFileSync(filePath);
  const eocdOffset = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new Error("Not a zip file: missing end of central directory.");
  const total = data.readUInt16LE(eocdOffset + 10);
  const centralOffset = data.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, ZipFileEntry>();
  let pos = centralOffset;
  for (let i = 0; i < total; i++) {
    if (data.readUInt32LE(pos) !== 0x02014b50) throw new Error("Invalid zip central directory.");
    const method = data.readUInt16LE(pos + 10);
    const compressedSize = data.readUInt32LE(pos + 20);
    const uncompressedSize = data.readUInt32LE(pos + 24);
    const nameLen = data.readUInt16LE(pos + 28);
    const extraLen = data.readUInt16LE(pos + 30);
    const commentLen = data.readUInt16LE(pos + 32);
    const localOffset = data.readUInt32LE(pos + 42);
    const name = data.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
    pos += 46 + nameLen + extraLen + commentLen;

    if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid local header for ${name}.`);
    const localNameLen = data.readUInt16LE(localOffset + 26);
    const localExtraLen = data.readUInt16LE(localOffset + 28);
    const bodyStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = data.slice(bodyStart, bodyStart + compressedSize);
    let body: Buffer;
    if (method === 0) body = compressed;
    else if (method === 8) body = inflateRawSync(compressed);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    if (uncompressedSize !== 0 && body.length !== uncompressedSize) {
      throw new Error(`Zip entry size mismatch for ${name}.`);
    }
    entries.set(normalizeZipPath(name), { name: normalizeZipPath(name), data: body });
  }
  return entries;
}

function textEntry(zip: Map<string, ZipFileEntry>, name: string): string {
  const entry = zip.get(normalizeZipPath(name));
  if (!entry) throw new Error(`EPUB entry not found: ${name}`);
  return entry.data.toString("utf8");
}

function attr(xml: string, tag: string, name: string): string | null {
  const m = new RegExp(`<${tag}\\b([^>]*)>`, "i").exec(xml);
  return m ? attrFromAttrs(m[1]!, name) : null;
}

function attrFromAttrs(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${escapeRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}

function firstAttrs(xml: string, tag: string): string {
  return new RegExp(`<${tag}\\b([^>]*)>`, "i").exec(xml)?.[1] ?? "";
}

function blockOf(xml: string, tag: string): string {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml)?.[1] ?? "";
}

function textOf(xml: string, tag: string): string {
  return new RegExp(`<${escapeRe(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRe(tag)}>`, "i").exec(xml)?.[1] ?? "";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function normalizeBlockKind(cls: string | null, text: string): BlockKind {
  const c = cls?.split(/\s+/).find((part) => ["paragraph", "dialogue", "separator", "note"].includes(part));
  if (c) return c as BlockKind;
  if (text === "---") return "separator";
  if (/^[「『“"']/.test(text)) return "dialogue";
  return "paragraph";
}

function generatedChapterId(volumeId: string, order: number, xhtml: string): string {
  const title = decodeEntities(stripTags(textOf(xhtml, "h1") || "")).trim();
  const kind = inferChapterKind(title, order);
  if (kind === "prologue") return `${volumeId}.prologue`;
  if (kind === "epilogue") return `${volumeId}.epilogue`;
  return `${volumeId}.c${String(order + 1).padStart(2, "0")}`;
}

function volumeIdFromChapterId(chapterId: string | null): string | null {
  const m = /^([A-Za-z0-9_-]+)\./.exec(chapterId ?? "");
  return m?.[1] ?? null;
}

function titleForVolume(volumeId: string, index: number): string {
  const m = /^v0*([1-9]\d*)$/i.exec(volumeId);
  if (m) return chineseVolumeTitle(Number(m[1]));
  return `第 ${index + 1} 卷`;
}

function chineseVolumeTitle(n: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n <= 10) return `第${n === 10 ? "十" : digits[n]}卷`;
  if (n < 20) return `第十${digits[n % 10]}卷`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `第${digits[tens]}十${ones ? digits[ones] : ""}卷`;
  }
  return `第${n}卷`;
}

function inferChapterKind(title: string, order: number): string {
  if (/序章|prologue/i.test(title)) return "prologue";
  if (/终章|尾声|epilogue/i.test(title)) return "epilogue";
  if (/番外|extra/i.test(title)) return "extra";
  if (/幕间|interlude/i.test(title)) return "interlude";
  return order === 0 && /序/.test(title) ? "prologue" : "chapter";
}

function markerText(value: string): string {
  return value.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

function slug(value: string): string {
  const s = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return s || "imported_book";
}

function normalizeZipPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return normalized.replace(/^\/+/, "");
}

function joinZipPath(base: string, href: string): string {
  return normalizeZipPath(path.posix.join(base, href));
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
