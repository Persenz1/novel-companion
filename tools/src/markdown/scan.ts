// Markdown marker scanner with line numbers, used by the Validator for the
// Markdown checks (docs/modules/toolchain.md). Unlike the Parser, this
// preserves source positions and reports lines that look like markers but are
// malformed, so the report can point a human/AI at the exact line to fix.
import { isCommentLine, parseComment } from "./comment.js";

export interface Marker {
  tag: string;
  primary: string;
  attrs: Record<string, string>;
  line: number;
}

export interface ScanResult {
  markers: Marker[];
  /** Comment lines that start with `<!--` but do not parse as a marker. */
  malformedComments: number[];
  /** Non-blank, non-comment, non-heading, non-image body lines and their line numbers. */
  bodyLines: Array<{ line: number; text: string }>;
}

export function scanMarkers(md: string): ScanResult {
  const lines = md.split(/\r?\n/);
  const markers: Marker[] = [];
  const malformedComments: number[] = [];
  const bodyLines: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNo = i + 1;
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;

    if (isCommentLine(line)) {
      const parsed = parseComment(line);
      if (parsed) {
        markers.push({ ...parsed, line: lineNo });
      } else {
        malformedComments.push(lineNo);
      }
      continue;
    }
    if (/^!\[.*\]\(.*\)$/.test(trimmed)) continue; // image render line
    bodyLines.push({ line: lineNo, text: trimmed });
  }

  return { markers, malformedComments, bodyLines };
}
