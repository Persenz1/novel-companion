// 起草/复核 v2 的无模型单测：窗口切分与容截断 JSONL 解析
// （docs/modules/drafting-review-v2-design.md §10 验证计划第 1 项）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraftWindows } from "./pipeline.js";
import { parseJsonlLoose } from "./llm.js";
import type { Block } from "../types.js";

function mkBlock(id: string, chapterId: string, kind: string, order: number): Block {
  return {
    id,
    series_id: "s",
    volume_id: "v01",
    chapter_id: chapterId,
    order,
    kind: kind as Block["kind"],
    text: kind === "dialogue" ? "「话」" : "叙述",
    source_markdown: "",
  };
}

/** 造一卷：chapters 里每项是 [章id, block数, separator 位置数组]。 */
function mkVolume(chapters: Array<[string, number, number[]]>): Block[] {
  const out: Block[] = [];
  for (const [chId, n, seps] of chapters) {
    for (let i = 1; i <= n; i++) {
      const kind = seps.includes(i) ? "separator" : i % 2 === 0 ? "dialogue" : "paragraph";
      out.push(mkBlock(`${chId}.b${String(i).padStart(4, "0")}`, chId, kind, i));
    }
  }
  return out;
}

// ---------- buildDraftWindows ----------

test("窗口在 separator 边界切分且不丢块", () => {
  // 100 块目标 40：软阈值 32，第 35 块是 separator -> 应在 35 切。
  const blocks = mkVolume([["v01.c01", 100, [35, 70]]]);
  const windows = buildDraftWindows(blocks, { target: 40 });
  assert.equal(windows[0]!.length, 35);
  assert.equal(windows[0]![34]!.kind, "separator");
  // 所有块无丢失、无重复
  const flat = windows.flat().map((b) => b.id);
  assert.deepEqual(flat, blocks.map((b) => b.id));
});

test("章节边界视为可切点", () => {
  const blocks = mkVolume([
    ["v01.c01", 35, []],
    ["v01.c02", 35, []],
  ]);
  const windows = buildDraftWindows(blocks, { target: 40 });
  // c01 35 块 >= 软阈值 32，章末即切。
  assert.equal(windows[0]!.length, 35);
  assert.ok(windows[0]!.every((b) => b.chapter_id === "v01.c01"));
});

test("无边界时按硬上限强制切分（长章不再饿死）", () => {
  const blocks = mkVolume([["v01.c01", 1400, []]]);
  const windows = buildDraftWindows(blocks, { target: 250 });
  // 硬上限 350：1400 块应切成 4 窗，每窗 <= 350。
  assert.ok(windows.length >= 4, `期望 >=4 窗，实际 ${windows.length}`);
  for (const w of windows) assert.ok(w.length <= 350);
  assert.equal(windows.flat().length, 1400);
});

test("说话人窗口按 dialogue 块计数", () => {
  // 200 块中约一半是 dialogue（偶数序号），目标 30 dialogue -> 软阈值 24。
  const blocks = mkVolume([["v01.c01", 200, [50, 100, 150]]]);
  const windows = buildDraftWindows(blocks, { target: 30, countDialogueOnly: true });
  assert.ok(windows.length >= 2);
  const firstDialogues = windows[0]!.filter((b) => b.kind === "dialogue").length;
  assert.ok(firstDialogues >= 24 && firstDialogues <= 42, `首窗 dialogue=${firstDialogues}`);
  assert.equal(windows.flat().length, 200);
});

test("碎尾窗并入上一窗", () => {
  const blocks = mkVolume([["v01.c01", 210, [200]]]);
  const windows = buildDraftWindows(blocks, { target: 250 });
  // 210 < 软阈值 200？不：软阈值 200，第 200 块是 separator -> 切一窗；剩 10 块远小于软阈值一半 -> 并回。
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.length, 210);
});

// ---------- parseJsonlLoose ----------

test("解析标准 JSONL 行", () => {
  const r = parseJsonlLoose('{"a":1}\n{"a":2}\n{"a":3}');
  assert.equal(r.rows.length, 3);
  assert.equal(r.badLines, 0);
});

test("截断尾行只丢一行，前面照收", () => {
  const r = parseJsonlLoose('{"a":1}\n{"a":2}\n{"a":3,"draft":{"na');
  assert.equal(r.rows.length, 2);
  assert.equal(r.badLines, 1);
});

test("容忍围栏与说明文字行", () => {
  const r = parseJsonlLoose('```jsonl\n{"a":1}\n以下继续\n{"a":2}\n```');
  assert.equal(r.rows.length, 2);
  assert.equal(r.badLines, 1);
});

test("兼容整体数组与包裹对象的旧式输出", () => {
  assert.equal(parseJsonlLoose('[{"a":1},{"a":2}]').rows.length, 2);
  assert.equal(parseJsonlLoose('{"candidates":[{"a":1},{"a":2},{"a":3}]}').rows.length, 3);
});

test("容忍行尾逗号", () => {
  const r = parseJsonlLoose('{"a":1},\n{"a":2},');
  assert.equal(r.rows.length, 2);
  assert.equal(r.badLines, 0);
});
