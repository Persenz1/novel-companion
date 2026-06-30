// Parser for the single-line HTML comment markers defined in
// docs/phase-1-design-decisions-v0.1.md §5 and docs/data-format-v0.1.md §2.
//
// Format:  <!-- tag: primary key: value key: "quoted value" -->
//
// Rules honoured here:
// - The comment is a flat sequence of `key: value` pairs.
// - The FIRST pair is special: its key is the tag name, its value is `primary`
//   (the object id).
// - Unquoted values never contain spaces; multi-value fields are comma-joined
//   with no spaces (e.g. blocks: a,b). Values with spaces/colons are double
//   quoted. This lets us treat an unquoted value as a run of non-space chars.

export interface ParsedComment {
  tag: string;
  primary: string;
  attrs: Record<string, string>;
}

/** True for any line that is a single-line HTML comment. */
export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("<!--") && t.endsWith("-->");
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;

/**
 * Parse a single-line HTML comment into tag/primary/attrs.
 * Returns null when the line is not a comment or does not start with a
 * `key:` token (i.e. a free-form comment that carries no marker semantics).
 */
export function parseComment(line: string): ParsedComment | null {
  const t = line.trim();
  if (!t.startsWith("<!--") || !t.endsWith("-->")) return null;

  const inner = t.slice(4, -3).trim();
  if (inner.length === 0) return null;

  const pairs: Array<{ key: string; value: string }> = [];
  let pos = 0;
  while (pos < inner.length) {
    // Skip whitespace between pairs.
    while (pos < inner.length && /\s/.test(inner[pos]!)) pos++;
    if (pos >= inner.length) break;

    const rest = inner.slice(pos);
    const keyMatch = KEY_RE.exec(rest);
    if (!keyMatch) {
      // Not a `key:` token: this is a free-form comment, not a marker.
      return null;
    }
    const key = keyMatch[1]!;
    pos += keyMatch[0].length;
    while (pos < inner.length && /\s/.test(inner[pos]!)) pos++;

    let value: string;
    if (inner[pos] === '"') {
      const end = inner.indexOf('"', pos + 1);
      if (end === -1) {
        // Unterminated quote: take the remainder verbatim.
        value = inner.slice(pos + 1);
        pos = inner.length;
      } else {
        value = inner.slice(pos + 1, end);
        pos = end + 1;
      }
    } else {
      const start = pos;
      while (pos < inner.length && !/\s/.test(inner[pos]!)) pos++;
      value = inner.slice(start, pos);
    }
    pairs.push({ key, value });
  }

  if (pairs.length === 0) return null;
  const [first, ...restPairs] = pairs;
  const attrs: Record<string, string> = {};
  for (const p of restPairs) attrs[p.key] = p.value;
  return { tag: first!.key, primary: first!.value, attrs };
}

/** Split a comma-joined multi-value field (e.g. "a,b,c") into trimmed parts. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
