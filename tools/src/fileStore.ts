// FileStore: the only module that touches the filesystem for a bookpack.
// All other tools (Parser, Validator, Compiler, ...) go through it so that a
// future database/repository layer can replace it without changing callers,
// per docs/modules/bookpack-data.md and docs/modules/toolchain.md.
import fs from "node:fs";
import path from "node:path";

export class FileStore {
  /** Absolute path to the bookpack root (the dir holding manifest.json). */
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  abs(relative: string): string {
    return path.join(this.root, relative);
  }

  exists(relative: string): boolean {
    return fs.existsSync(this.abs(relative));
  }

  readText(relative: string): string {
    return fs.readFileSync(this.abs(relative), "utf8");
  }

  /** Read a JSON file. */
  readJson<T>(relative: string): T {
    return JSON.parse(this.readText(relative)) as T;
  }

  /**
   * Read a JSONL file. Returns parsed rows plus per-line parse errors
   * (so the validator can report "line N is not valid JSON"). Missing file
   * yields empty results. `line` is 1-based within the file.
   */
  readJsonl<T>(relative: string): { rows: T[]; parseErrors: Array<{ line: number; message: string }> } {
    if (!this.exists(relative)) return { rows: [], parseErrors: [] };
    const rows: T[] = [];
    const parseErrors: Array<{ line: number; message: string }> = [];
    const lines = this.readText(relative).split(/\r?\n/);
    lines.forEach((raw, idx) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      try {
        rows.push(JSON.parse(trimmed) as T);
      } catch (err) {
        parseErrors.push({ line: idx + 1, message: (err as Error).message });
      }
    });
    return { rows, parseErrors };
  }

  writeText(relative: string, content: string): void {
    const target = this.abs(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }

  writeJson(relative: string, value: unknown): void {
    this.writeText(relative, JSON.stringify(value, null, 2) + "\n");
  }

  /** Write an array as JSONL (one compact JSON object per line). */
  writeJsonl(relative: string, rows: unknown[]): void {
    const body = rows.map((row) => JSON.stringify(row)).join("\n");
    this.writeText(relative, rows.length ? body + "\n" : "");
  }

  /** List file names directly under a relative directory (empty if absent). */
  listDir(relative: string): string[] {
    const dir = this.abs(relative);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  }
}
