// Closed-loop integration test over the gray-tower fixture: compiles the
// reader index from the on-disk pack and asserts the spoiler + relevance
// behaviour from docs/test-book-gray-tower.md §10.6/§10.10.
//
// Assumes the pack has been parsed + fixture-built + validated:
//   npx tsx scripts/gray-tower-fixture.ts ../samples/gray-tower
//   npx tsx src/cli.ts validate ../samples/gray-tower
import { test } from "node:test";
import assert from "node:assert/strict";
import { FileStore } from "./fileStore.js";
import { Compiler } from "./compiler.js";
import { CompiledQuery } from "./query.js";

const store = new FileStore(new URL("../../samples/gray-tower", import.meta.url).pathname);
const index = new Compiler(store).compileReaderIndex();
const q = new CompiledQuery(index);

const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.id as string);
const REVEAL_EVENT = "event_unsent_list_revealed";
const REVEAL_REL = "relation_linche_shenyan_v01_epilogue";

test("early read_boundary hides the epilogue reveal", () => {
  const c = q.getVisibleContext("v01.c01.b0005", "v01.c01.b0005");
  assert.equal(c.is_ahead_of_boundary, false);
  assert.ok(!ids(c.events).includes(REVEAL_EVENT));
  assert.ok(!ids(c.relation_changes).includes(REVEAL_REL));
  assert.deepEqual(ids(c.character_cards), []);
});

test("jumping current_block ahead does not widen visibility", () => {
  const c = q.getVisibleContext("v01.epilogue.b0004", "v01.c01.b0005");
  assert.equal(c.is_ahead_of_boundary, true);
  assert.ok(!ids(c.events).includes(REVEAL_EVENT), "reveal must stay hidden behind read_boundary");
});

test("epilogue read_boundary returns the reveal event and relation", () => {
  const c = q.getVisibleContext("v01.epilogue.b0004", "v01.epilogue.end");
  assert.ok(ids(c.events).includes(REVEAL_EVENT));
  assert.ok(ids(c.relation_changes).includes(REVEAL_REL));
});

test("character card appears at its volume-end visibility", () => {
  assert.deepEqual(ids(q.getVisibleContext("v01.epilogue.b0008", "v01.epilogue.end").character_cards), []);
  assert.deepEqual(ids(q.getVisibleContext("v01.epilogue.b0008", "v01.end").character_cards), ["card_xu_yingbai_v01_end"]);
});

test("current block returns its speaker label, term card and scene", () => {
  const c = q.getVisibleContext("v01.c01.b0003", "v01.c01.b0009");
  assert.equal(c.current_scene?.id, "v01.c01.s001");
  assert.deepEqual(ids(c.speaker_labels), ["speaker_v01_c01_b0003_001"]);
  assert.ok(ids(c.term_cards).includes("term_card_class_points_v01"));
});

test("current block returns its anchored asset with visible subject", () => {
  const c = q.getVisibleContext("v01.prologue.b0007", "v01.prologue.b0007");
  assert.equal(c.assets.length, 1);
  assert.equal((c.assets[0] as { id: string }).id, "v01_img_001");
  assert.deepEqual(
    ((c.assets[0] as { subjects: Array<{ id: string }> }).subjects).map((s) => s.id),
    ["asset_subject_img001_linche"],
  );
});

test("speaker labels are filtered by read_boundary too", () => {
  // b0003 speaker is visible_from b0003; a boundary before it must not return it.
  const c = q.getVisibleContext("v01.c01.b0003", "v01.c01.b0002");
  assert.deepEqual(ids(c.speaker_labels), []);
});

test("japanese refs only render with --ja and only for reviewed alignments", () => {
  const off = q.getVisibleContext("v01.c01.b0002", "v01.c01.b0002");
  assert.equal(off.ja_refs.length, 0, "ja off by default");
  const oneToOne = q.getVisibleContext("v01.c01.b0002", "v01.c01.b0002", { includeJa: true });
  assert.equal(oneToOne.ja_refs.length, 1);
  const oneToMany = q.getVisibleContext("v01.c01.b0005", "v01.c01.b0005", { includeJa: true });
  assert.equal(oneToMany.ja_refs.length, 2);
  const manyToOne = q.getVisibleContext("v01.c02.b0001", "v01.c02.b0009", { includeJa: true });
  assert.equal(manyToOne.ja_refs.length, 1);
  const pending = q.getVisibleContext("v01.c03.b0007", "v01.epilogue.end", { includeJa: true });
  assert.equal(pending.ja_refs.length, 0, "pending_review alignment must not render by default");
});

test("group photo returns multiple confirmed subjects for one image", () => {
  const c = q.getVisibleContext("v01.c02.b0002", "v01.c02.b0002");
  const img = c.assets.find((a) => (a as { id: string }).id === "v01_img_005") as
    | { subjects: Array<{ entity_id: string }> }
    | undefined;
  assert.ok(img);
  assert.deepEqual(img!.subjects.map((s) => s.entity_id).sort(), ["entity_linche", "entity_shenyan"]);
});

test("individual points: known value is a metric_change, unknown stays an open question", () => {
  const c = q.getVisibleContext("v01.c03.b0007", "v01.c03.b0007");
  assert.ok(ids(c.metric_changes).includes("metric_change_linche_personal_points_test"));
  // 许映白's individual points are deliberately NOT modelled as a metric_change.
  assert.ok(!ids(c.metric_changes).some((id) => id.includes("xu_yingbai")));
});
