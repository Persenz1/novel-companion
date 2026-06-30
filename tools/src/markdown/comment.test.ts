import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComment, splitList, isCommentLine } from "./comment.js";

test("parses chapter marker with quoted title containing colon", () => {
  const c = parseComment('<!-- chapter: v01.c01 kind: chapter title: "第一章：试探" -->');
  assert.deepEqual(c, {
    tag: "chapter",
    primary: "v01.c01",
    attrs: { kind: "chapter", title: "第一章：试探" },
  });
});

test("parses block marker", () => {
  const c = parseComment("<!-- block: v01.c01.b0001 kind: paragraph -->");
  assert.deepEqual(c, { tag: "block", primary: "v01.c01.b0001", attrs: { kind: "paragraph" } });
});

test("parses multi-value comma list with no spaces", () => {
  const c = parseComment("<!-- alignment: v01.c02.a001 blocks: v01.c02.b0001,v01.c02.b0002 -->");
  assert.equal(c?.attrs.blocks, "v01.c02.b0001,v01.c02.b0002");
  assert.deepEqual(splitList(c?.attrs.blocks), ["v01.c02.b0001", "v01.c02.b0002"]);
});

test("parses asset marker with multiple keys and quoted alt", () => {
  const c = parseComment(
    '<!-- asset: v01_img_001 anchor_type: after_block block: v01.c01.b0002 alt: "教室 插图" -->',
  );
  assert.deepEqual(c, {
    tag: "asset",
    primary: "v01_img_001",
    attrs: { anchor_type: "after_block", block: "v01.c01.b0002", alt: "教室 插图" },
  });
});

test("parses scene end marker", () => {
  const c = parseComment("<!-- scene: v01.c01.s001 action: end -->");
  assert.deepEqual(c, { tag: "scene", primary: "v01.c01.s001", attrs: { action: "end" } });
});

test("returns null for free-form (non-marker) comment", () => {
  assert.equal(parseComment("<!-- just a note, no key here -->"), null);
});

test("returns null for non-comment lines", () => {
  assert.equal(parseComment("今天的教室有些安静。"), null);
  assert.equal(parseComment("# 第一章"), null);
});

test("isCommentLine detects single-line comments only", () => {
  assert.equal(isCommentLine("<!-- block: x -->"), true);
  assert.equal(isCommentLine("  <!-- block: x -->  "), true);
  assert.equal(isCommentLine("plain text"), false);
});

test("splitList handles empty/undefined", () => {
  assert.deepEqual(splitList(undefined), []);
  assert.deepEqual(splitList(""), []);
  assert.deepEqual(splitList("a, b ,c"), ["a", "b", "c"]);
});
