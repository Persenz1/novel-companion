// Low-level marker editing over a volume Markdown, shared by the cleaning
// normalizer and the suggestion applier. All cleaning writes go through here so
// there is exactly one place that knows how the single-line HTML comment markers
// (docs/modules/bookpack-data.md) are edited on disk. Everything operates on a
// mutable `lines: string[]` array; callers join and write back.
import { parseComment } from "../markdown/comment.js";

/**
 * A value is left unquoted only when it is a simple token (ids, enums, numbers:
 * [A-Za-z0-9_.-]). Anything else — free text, CJK, spaces, punctuation, empty —
 * is quoted, matching how the parser treats quoted vs unquoted values.
 */
function needsQuote(value: string): boolean {
  return !/^[A-Za-z0-9_.-]+$/.test(value);
}

/** Render a marker attribute value, quoting when necessary (quotes downgraded). */
function renderValue(value: string): string {
  const safe = value.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  return needsQuote(safe) ? `"${safe}"` : safe;
}

/** Find the line index of a marker `<!-- tag: id ... -->`, or -1. */
export function findMarkerIndex(lines: string[], tag: string, id: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (!isCommentLine(lines[i]!)) continue;
    const c = parseComment(lines[i]!);
    if (c && c.tag === tag && c.primary === id) return i;
  }
  return -1;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("<!--") && t.endsWith("-->");
}

/**
 * Set (or insert) a `key: value` attribute on the marker at line `idx`.
 * Replaces an existing key in place; otherwise inserts before the closing `-->`.
 * Returns the new line (does not mutate the array).
 */
export function setMarkerAttrLine(line: string, key: string, value: string): string {
  const rendered = renderValue(value);
  const keyRe = new RegExp(`(\\b${escapeRe(key)}:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|[^\\s]+)`);
  if (keyRe.test(line)) return line.replace(keyRe, `$1${rendered}`);
  return line.replace(/\s*-->\s*$/, ` ${key}: ${rendered} -->`);
}

/** Set an attribute on the marker identified by tag+id. Returns true on success. */
export function setMarkerAttr(lines: string[], tag: string, id: string, key: string, value: string): boolean {
  const idx = findMarkerIndex(lines, tag, id);
  if (idx < 0) return false;
  lines[idx] = setMarkerAttrLine(lines[idx]!, key, value);
  return true;
}

/**
 * Delete a block: its `<!-- block: id ... -->` marker line plus the body lines
 * that follow, up to (but not including) the next marker/heading, then collapse
 * the resulting run of blank lines to a single blank. Asset markers anchored to
 * the block are NOT touched here (callers must re-anchor or delete them first).
 * Returns the removed lines, or null if the block was not found.
 */
export function deleteBlock(lines: string[], blockId: string): string[] | null {
  const idx = findMarkerIndex(lines, "block", blockId);
  if (idx < 0) return null;
  let end = idx + 1;
  for (; end < lines.length; end++) {
    const t = lines[end]!.trim();
    if (t.length === 0) break; // blank line separates blocks; keep it
    if (isCommentLine(lines[end]!) || t.startsWith("#")) break; // next marker/heading
  }
  const removed = lines.splice(idx, end - idx);
  // Collapse duplicate blank lines created at the splice point.
  if (idx > 0 && lines[idx - 1]?.trim() === "" && lines[idx]?.trim() === "") {
    lines.splice(idx, 1);
  }
  return removed;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
