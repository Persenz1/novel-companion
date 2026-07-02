import fs from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { FileStore } from "../fileStore.js";
import { isCommentLine, parseComment } from "../markdown/comment.js";
import type { Manifest, ManifestChapter, ManifestVolume } from "../types.js";

interface MarkdownBlock {
  id: string;
  kind: string;
  text: string;
}

interface MarkdownAsset {
  id: string;
  block: string;
  anchorType: string;
  alt: string;
  sourcePath: string | null;
}

interface MarkdownChapter {
  id: string;
  kind: string;
  title: string;
  blocks: MarkdownBlock[];
  assets: MarkdownAsset[];
}

interface VolumeExport {
  volume: ManifestVolume;
  chapters: MarkdownChapter[];
}

interface ZipEntry {
  name: string;
  data: Buffer;
  store?: boolean;
}

export interface ExportEpubResult {
  output: string;
  volume_count: number;
  chapter_count: number;
  image_count: number;
}

export function exportBookpackToEpub(bookpackDir: string, outputPath: string, volumeId?: string): ExportEpubResult {
  const store = new FileStore(bookpackDir);
  const manifest = store.readJson<Manifest>("manifest.json");
  const volumes = volumeId ? manifest.volumes.filter((v) => v.id === volumeId) : manifest.volumes;
  if (volumes.length === 0) throw new Error(`volume not found: ${volumeId}`);

  const exports = volumes.map((volume) => parseVolumeMarkdown(store, volume));
  const entries = buildEpubEntries(store, manifest, exports);
  writeZip(outputPath, entries);

  return {
    output: path.resolve(outputPath),
    volume_count: exports.length,
    chapter_count: exports.reduce((n, v) => n + v.chapters.length, 0),
    image_count: countUniqueImages(exports),
  };
}

function parseVolumeMarkdown(store: FileStore, volume: ManifestVolume): VolumeExport {
  const raw = store.readText(volume.main_text);
  const lines = raw.split(/\r?\n/);
  const chapters: MarkdownChapter[] = [];
  let current: MarkdownChapter | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isCommentLine(line)) continue;
    const comment = parseComment(line);
    if (!comment) continue;

    if (comment.tag === "chapter") {
      current = {
        id: comment.primary,
        kind: comment.attrs.kind ?? chapterFromManifest(volume, comment.primary)?.kind ?? "chapter",
        title: comment.attrs.title ?? chapterFromManifest(volume, comment.primary)?.title ?? comment.primary,
        blocks: [],
        assets: [],
      };
      chapters.push(current);
      continue;
    }

    if (!current) continue;

    if (comment.tag === "block") {
      const { text, next } = collectBlockText(lines, i + 1);
      current.blocks.push({
        id: comment.primary,
        kind: comment.attrs.kind ?? "paragraph",
        text,
      });
      i = next - 1;
      continue;
    }

    if (comment.tag === "asset") {
      const sourcePath = findAssetFile(store, comment.primary);
      current.assets.push({
        id: comment.primary,
        block: comment.attrs.block ?? "",
        anchorType: comment.attrs.anchor_type ?? "after_block",
        alt: comment.attrs.alt ?? "",
        sourcePath,
      });
    }
  }

  return { volume, chapters };
}

function chapterFromManifest(volume: ManifestVolume, chapterId: string): ManifestChapter | undefined {
  return volume.chapters.find((ch) => ch.id === chapterId);
}

function collectBlockText(lines: string[], start: number): { text: string; next: number } {
  const parts: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.length === 0) break;
    if (isCommentLine(line)) break;
    if (trimmed.startsWith("#")) break;
    if (/^!\[.*\]\(.*\)$/.test(trimmed)) continue;
    parts.push(trimmed);
  }
  return { text: parts.join("\n"), next: i };
}

function findAssetFile(store: FileStore, assetId: string): string | null {
  const files = store.listDir("assets/images");
  const match = files.find((name) => name.slice(0, name.length - path.extname(name).length) === assetId);
  return match ? `assets/images/${match}` : null;
}

function buildEpubEntries(store: FileStore, manifest: Manifest, volumes: VolumeExport[]): ZipEntry[] {
  const entries: ZipEntry[] = [
    { name: "mimetype", data: Buffer.from("application/epub+zip", "utf8"), store: true },
    { name: "META-INF/container.xml", data: xml(containerXml()) },
    { name: "OEBPS/styles/book.css", data: xml(css()) },
  ];
  const imageEntries = new Map<string, string>();

  for (const volume of volumes) {
    for (const chapter of volume.chapters) {
      for (const asset of chapter.assets) {
        if (!asset.sourcePath || imageEntries.has(asset.id)) continue;
        const ext = path.extname(asset.sourcePath).toLowerCase() || ".png";
        const target = `OEBPS/images/${asset.id}${ext}`;
        imageEntries.set(asset.id, target);
        entries.push({ name: target, data: fs.readFileSync(store.abs(asset.sourcePath)) });
      }
    }
  }

  const spineItems: Array<{ id: string; href: string; title: string }> = [];
  for (const volume of volumes) {
    for (const chapter of volume.chapters) {
      const itemId = chapter.id.replace(/[^A-Za-z0-9_]+/g, "_");
      const href = `text/${chapter.id}.xhtml`;
      spineItems.push({ id: itemId, href, title: chapter.title });
      entries.push({
        name: `OEBPS/${href}`,
        data: xml(chapterXhtml(volume.volume, chapter, imageEntries)),
      });
    }
  }

  entries.push({ name: "OEBPS/nav.xhtml", data: xml(navXhtml(manifest, spineItems)) });
  entries.push({ name: "OEBPS/content.opf", data: xml(contentOpf(manifest, spineItems, imageEntries)) });
  return entries;
}

function chapterXhtml(volume: ManifestVolume, chapter: MarkdownChapter, imageEntries: Map<string, string>): string {
  const assetsByBlock = new Map<string, MarkdownAsset[]>();
  for (const asset of chapter.assets) {
    const list = assetsByBlock.get(asset.block) ?? [];
    list.push(asset);
    assetsByBlock.set(asset.block, list);
  }

  const body: string[] = [
    `<section epub:type="${escAttr(chapter.kind)}" data-nc-volume-id="${escAttr(volume.id)}" data-nc-volume-title="${escAttr(volume.title)}" data-nc-chapter-id="${escAttr(chapter.id)}">`,
    `<h1>${esc(chapter.title)}</h1>`,
  ];
  for (const block of chapter.blocks) {
    for (const asset of assetsByBlock.get(block.id)?.filter((a) => a.anchorType === "before_block") ?? []) {
      body.push(assetFigure(asset, imageEntries));
    }
    if (block.kind === "separator" || block.text.trim() === "---") {
      body.push(`<hr data-nc-block-id="${escAttr(block.id)}"/>`);
    } else if (block.text.trim().length > 0) {
      body.push(`<p class="${escAttr(block.kind)}" data-nc-block-id="${escAttr(block.id)}">${esc(block.text)}</p>`);
    }
    for (const asset of assetsByBlock.get(block.id)?.filter((a) => a.anchorType !== "before_block") ?? []) {
      body.push(assetFigure(asset, imageEntries));
    }
  }
  body.push("</section>");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head>
  <title>${esc(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>
${body.join("\n")}
</body>
</html>
`;
}

function assetFigure(asset: MarkdownAsset, imageEntries: Map<string, string>): string {
  const target = imageEntries.get(asset.id);
  if (!target) return "";
  const href = path.posix.relative("OEBPS/text", target);
  const caption = asset.alt ? `<figcaption>${esc(asset.alt)}</figcaption>` : "";
  return `<figure data-nc-asset-id="${escAttr(asset.id)}"><img src="${escAttr(href)}" alt="${escAttr(asset.alt)}"/>${caption}</figure>`;
}

function navXhtml(manifest: Manifest, items: Array<{ href: string; title: string }>): string {
  const navItems = items.map((item) => `<li><a href="${escAttr(item.href)}">${esc(item.title)}</a></li>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><title>${esc(manifest.series.title)}</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>${esc(manifest.series.title)}</h1>
<ol>
${navItems}
</ol>
</nav>
</body>
</html>
`;
}

function contentOpf(
  manifest: Manifest,
  items: Array<{ id: string; href: string; title: string }>,
  images: Map<string, string>,
): string {
  const xhtmlItems = items
    .map((item) => `<item id="${escAttr(item.id)}" href="${escAttr(item.href)}" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const imageItems = Array.from(images.entries())
    .map(([id, target]) => {
      const href = path.posix.relative("OEBPS", target);
      return `<item id="${escAttr(id)}" href="${escAttr(href)}" media-type="${escAttr(mediaTypeFor(target))}"/>`;
    })
    .join("\n");
  const spine = items.map((item) => `<itemref idref="${escAttr(item.id)}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="book-id">${esc(manifest.pack_id)}</dc:identifier>
  <dc:title>${esc(manifest.series.title || manifest.pack_name)}</dc:title>
  <dc:language>zh-CN</dc:language>
  <meta property="dcterms:modified">2026-07-01T00:00:00Z</meta>
</metadata>
<manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="css" href="styles/book.css" media-type="text/css"/>
${xhtmlItems}
${imageItems}
</manifest>
<spine>
${spine}
</spine>
</package>
`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function css(): string {
  return `body { font-family: serif; line-height: 1.75; margin: 2em; }
h1 { text-align: center; margin: 2em 0 1.5em; }
p { margin: 0 0 1em; }
p.dialogue { }
hr { border: 0; border-top: 1px solid #999; margin: 2em 20%; }
figure { margin: 1.5em 0; text-align: center; }
img { max-width: 100%; height: auto; }
figcaption { color: #666; font-size: 0.9em; margin-top: 0.5em; }
`;
}

function mediaTypeFor(filePath: string): string {
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

function countUniqueImages(volumes: VolumeExport[]): number {
  const ids = new Set<string>();
  for (const volume of volumes) {
    for (const chapter of volume.chapters) {
      for (const asset of chapter.assets) ids.add(asset.id);
    }
  }
  return ids.size;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(value: string): string {
  return esc(value).replace(/"/g, "&quot;");
}

function xml(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

const CRC_TABLE = buildCrcTable();

function writeZip(outputPath: string, entries: ZipEntry[]): void {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  const dosTime = 0;
  const dosDate = (2026 - 1980) << 9 | 7 << 5 | 1;
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.store ? 0 : 8;
    const compressed = entry.store ? entry.data : deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([...parts, ...central, end]));
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
