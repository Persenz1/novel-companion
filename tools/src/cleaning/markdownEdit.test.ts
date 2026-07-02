import { test } from "node:test";
import assert from "node:assert/strict";
import { findMarkerIndex, setMarkerAttr, setMarkerAttrLine, deleteBlock } from "./markdownEdit.js";

function md(): string[] {
  return [
    "<!-- chapter: v01.c01 kind: chapter title: \"旧标题\" -->",
    "# 旧标题",
    "",
    "<!-- scene: v01.c01.s001 action: start title: \"场景\" -->",
    "",
    "<!-- block: v01.c01.b0001 kind: paragraph -->",
    "正文第一段。",
    "",
    "<!-- block: v01.c01.b0002 kind: paragraph -->",
    "1",
    "",
    "<!-- block: v01.c01.b0003 kind: image -->",
    "",
    "<!-- asset: v01.c01_img_001 anchor_type: after_block block: v01.c01.b0003 -->",
    "",
    "<!-- scene: v01.c01.s001 action: end -->",
    "",
  ];
}

test("findMarkerIndex locates the right marker", () => {
  const lines = md();
  assert.equal(findMarkerIndex(lines, "block", "v01.c01.b0002"), 8);
  assert.equal(findMarkerIndex(lines, "asset", "v01.c01_img_001"), 13);
  assert.equal(findMarkerIndex(lines, "block", "nope"), -1);
});

test("setMarkerAttrLine replaces existing unquoted attr in place", () => {
  const line = "<!-- block: v01.c01.b0002 kind: paragraph -->";
  assert.equal(setMarkerAttrLine(line, "kind", "separator"), "<!-- block: v01.c01.b0002 kind: separator -->");
});

test("setMarkerAttrLine replaces existing quoted attr and inserts missing attr", () => {
  const line = "<!-- asset: a1 anchor_type: after_block block: b1 alt: \"old\" -->";
  assert.equal(
    setMarkerAttrLine(line, "alt", "银发少女读信"),
    "<!-- asset: a1 anchor_type: after_block block: b1 alt: \"银发少女读信\" -->",
  );
  const noAlt = "<!-- asset: a1 anchor_type: after_block block: b1 -->";
  assert.equal(
    setMarkerAttrLine(noAlt, "alt", "封面"),
    "<!-- asset: a1 anchor_type: after_block block: b1 alt: \"封面\" -->",
  );
});

test("setMarkerAttr edits the marker with the given id", () => {
  const lines = md();
  assert.equal(setMarkerAttr(lines, "block", "v01.c01.b0002", "kind", "separator"), true);
  assert.match(lines[8]!, /kind: separator/);
  assert.equal(setMarkerAttr(lines, "asset", "v01.c01_img_001", "block", "v01.c01.b0001"), true);
  assert.match(lines[13]!, /block: v01\.c01\.b0001/);
  assert.equal(setMarkerAttr(lines, "block", "missing", "kind", "note"), false);
});

test("deleteBlock removes marker + body and collapses blanks", () => {
  const lines = md();
  const removed = deleteBlock(lines, "v01.c01.b0002");
  assert.ok(removed);
  assert.deepEqual(removed, ["<!-- block: v01.c01.b0002 kind: paragraph -->", "1"]);
  assert.equal(findMarkerIndex(lines, "block", "v01.c01.b0002"), -1);
  // Neighbouring blocks still intact.
  assert.ok(findMarkerIndex(lines, "block", "v01.c01.b0001") >= 0);
  assert.ok(findMarkerIndex(lines, "block", "v01.c01.b0003") >= 0);
  // No doubled blank line at the splice point.
  assert.ok(!lines.join("\n").includes("\n\n\n"));
});
