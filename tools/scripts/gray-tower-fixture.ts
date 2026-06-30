// Reproducible gray-tower fixture generator.
//
// This stands in for the (out-of-scope, phase-1) AI making-Agent: it authors a
// candidate set (as if an AI produced it) and then replays a human review
// session through the real write-side stores (AcceptedStore / ReviewQueue /
// WorkRunStore). Running it regenerates candidates + accepted + review +
// work_runs deterministically. No model is called.
//
//   npx tsx scripts/gray-tower-fixture.ts [bookpack-dir]
import { FileStore } from "../src/fileStore.js";
import { AcceptedStore, ReviewQueue, WorkRunStore } from "../src/stores.js";
import type { Candidate, Manifest } from "../src/types.js";

const root = process.argv[2] ?? "../samples/gray-tower";
const store = new FileStore(root);
const manifest = store.readJson<Manifest>("manifest.json");
const SERIES = manifest.series.id;
const NOW = "2026-06-30T00:00:00Z";
const MODEL = "fixture-v0.1";

type Draft = Record<string, unknown>;
const span = (start: string, end = start) => ({ start_block: start, end_block: end });

let candSeq = 0;
const candidates: Candidate[] = [];

/** Register a normal (draft-bearing) candidate. */
function cand(
  type: string,
  block_id: string,
  source_span: { start_block: string; end_block: string },
  visible_from: string,
  confidence: number,
  draft: Draft,
  opts: { evidence?: string; risk_flags?: string[]; task?: string } = {},
): Candidate {
  const id = `cand_${String(++candSeq).padStart(3, "0")}`;
  const c: Candidate = {
    id,
    series_id: SERIES,
    type,
    block_id,
    source_span,
    visible_from,
    confidence,
    status: "pending_review",
    model: MODEL,
    task_id: opts.task ?? "task_gray_tower_001",
    payload: {
      target_type: type,
      draft: { id: draft.id, series_id: SERIES, ...draft },
      evidence: opts.evidence ?? "见 source_span 正文。",
      risk_flags: opts.risk_flags ?? [],
    },
  };
  candidates.push(c);
  return c;
}

/** Register a review_item / open_question candidate (special payload). */
function specialCand(
  type: "review_item" | "open_question",
  block_id: string,
  source_span: { start_block: string; end_block: string },
  visible_from: string,
  payload: Record<string, unknown>,
): Candidate {
  const id = `cand_${String(++candSeq).padStart(3, "0")}`;
  const c: Candidate = {
    id,
    series_id: SERIES,
    type,
    block_id,
    source_span,
    visible_from,
    confidence: 0.5,
    status: "pending_review",
    model: MODEL,
    task_id: "task_gray_tower_review",
    payload,
  };
  candidates.push(c);
  return c;
}

// ---- entity candidates (some accepted, one edited, one duplicate rejected) ----
const cXu = cand("entity", "v01.prologue.b0005", span("v01.prologue.b0005", "v01.prologue.b0007"), "v01.prologue.b0007", 0.9, {
  id: "entity_xu_yingbai", type: "character", name: "许映白", aliases: ["扎低马尾的女生"], first_seen: "v01.prologue.b0005", status: "accepted", source_span: span("v01.prologue.b0005", "v01.prologue.b0007"),
}, { evidence: "prologue 末尾点名她叫许映白。" });

const cZhou = cand("entity", "v01.c01.b0002", span("v01.c01.b0002", "v01.c01.b0007"), "v01.c01.b0007", 0.8, {
  id: "entity_zhoumi", type: "character", name: "圆脸男生", aliases: [], first_seen: "v01.c01.b0002", status: "accepted", source_span: span("v01.c01.b0002", "v01.c01.b0007"),
}, { evidence: "圆脸男生在 b0007 被点名周弥；草案名待人工修正。", risk_flags: ["name_unconfirmed"] });

const cBai = cand("entity", "v01.c01.b0009", span("v01.c01.b0009"), "v01.c01.b0009", 0.85, {
  id: "entity_baichuan_yao", type: "character", name: "白川遥", aliases: [], first_seen: "v01.c01.b0009", status: "accepted", source_span: span("v01.c01.b0009"),
});

const cShen = cand("entity", "v01.c02.b0002", span("v01.c02.b0002"), "v01.c02.b0002", 0.9, {
  id: "entity_shenyan", type: "character", name: "沈砚", aliases: [], first_seen: "v01.c02.b0002", status: "accepted", source_span: span("v01.c02.b0002"),
});

const cBClass = cand("entity", "v01.c02.b0002", span("v01.c02.b0002"), "v01.c02.b0002", 0.85, {
  id: "entity_b_class", type: "group", name: "一年B班", aliases: ["B班"], first_seen: "v01.c02.b0002", status: "accepted", source_span: span("v01.c02.b0002"),
});

const cCouncil = cand("entity", "v01.c01.b0009", span("v01.c01.b0009"), "v01.c01.b0009", 0.85, {
  id: "entity_student_council", type: "organization", name: "学生会", aliases: [], first_seen: "v01.c01.b0009", status: "accepted", source_span: span("v01.c01.b0009"),
});

const cPointsTerm = cand("entity", "v01.c01.b0005", span("v01.c01.b0005"), "v01.c01.b0005", 0.9, {
  id: "term_class_points", type: "term", name: "班级点数", aliases: [], first_seen: "v01.c01.b0005", status: "accepted", source_span: span("v01.c01.b0005"),
});

const cWctTerm = cand("entity", "v01.c02.b0009", span("v01.c02.b0009"), "v01.c02.b0009", 0.85, {
  id: "term_white_card_test", type: "term", name: "白卡测试", aliases: [], first_seen: "v01.c02.b0009", status: "accepted", source_span: span("v01.c02.b0009"),
});

const cListTerm = cand("entity", "v01.c02.b0005", span("v01.c02.b0005"), "v01.c02.b0005", 0.6, {
  id: "term_unsent_list", type: "event_concept", name: "未寄出的名单", aliases: [], first_seen: "v01.c02.b0005", status: "accepted", source_span: span("v01.c02.b0005"),
}, { risk_flags: ["possible_foreshadowing", "low_confidence"] });

// duplicate / merge candidate: "圆脸男生" proposed as a NEW entity (really 周弥).
const cDup = cand("entity", "v01.c01.b0002", span("v01.c01.b0002"), "v01.c01.b0002", 0.55, {
  id: "entity_circle_face_boy", type: "character", name: "圆脸男生", aliases: [], first_seen: "v01.c01.b0002", status: "accepted", source_span: span("v01.c01.b0002"),
}, { evidence: "可能与 entity_zhoumi 是同一人。", risk_flags: ["possible_duplicate", "low_confidence"] });

// ---- fact candidates ----
const cFLin = cand("fact", "v01.prologue.b0006", span("v01.prologue.b0006"), "v01.prologue.b0006", 0.9, {
  id: "fact_linche_class_v01", subject_id: "entity_linche", predicate: "class", value: "D班", value_type: "entity", value_entity_id: "entity_d_class", valid_from: "v01.prologue.b0006", valid_until: null, visible_from: "v01.prologue.b0006", status: "accepted", source_span: span("v01.prologue.b0006"),
});
const cFXu = cand("fact", "v01.c01.b0003", span("v01.c01.b0003"), "v01.c01.b0003", 0.85, {
  id: "fact_xu_yingbai_class_v01", subject_id: "entity_xu_yingbai", predicate: "class", value: "D班", value_type: "entity", value_entity_id: "entity_d_class", valid_from: "v01.c01.b0003", valid_until: null, visible_from: "v01.c01.b0003", status: "accepted", source_span: span("v01.c01.b0003"),
});
const cFShen = cand("fact", "v01.c02.b0002", span("v01.c02.b0002"), "v01.c02.b0002", 0.9, {
  id: "fact_shenyan_class_v01", subject_id: "entity_shenyan", predicate: "class", value: "B班", value_type: "entity", value_entity_id: "entity_b_class", valid_from: "v01.c02.b0002", valid_until: null, visible_from: "v01.c02.b0002", status: "accepted", source_span: span("v01.c02.b0002"),
});
const cFBai = cand("fact", "v01.c01.b0009", span("v01.c01.b0009"), "v01.c01.b0009", 0.5, {
  id: "fact_baichuan_role_v01", subject_id: "entity_baichuan_yao", predicate: "role", value: "学生会记录员", value_type: "string", valid_from: "v01.c01.b0009", valid_until: null, visible_from: "v01.c01.b0009", status: "accepted", source_span: span("v01.c01.b0009"),
}, { risk_flags: ["low_confidence"] });

// ---- event candidates (incl. spoiler reveal + a duplicate to reject) ----
const cEPoints = cand("event", "v01.c01.b0005", span("v01.c01.b0004", "v01.c01.b0008"), "v01.c01.b0005", 0.85, {
  id: "event_points_announced", type: "rule_announced", title: "班级点数制度公布", summary: "班主任向D班公布初始班级点数与待遇规则。", summary_source: "ai_draft", position: "v01.c01.b0005", participants: ["entity_linche", "entity_d_class"], related_entities: ["entity_student_council"], importance: "major", visible_from: "v01.c01.b0005", status: "accepted", source_span: span("v01.c01.b0004", "v01.c01.b0008"),
});
const cEPointsDup = cand("event", "v01.c01.b0006", span("v01.c01.b0005", "v01.c01.b0006"), "v01.c01.b0006", 0.6, {
  id: "event_points_announced_dup", type: "rule_announced", title: "点数公布(重复候选)", summary: "与 event_points_announced 高度重复。", summary_source: "ai_draft", position: "v01.c01.b0006", participants: ["entity_linche"], importance: "minor", visible_from: "v01.c01.b0006", status: "accepted", source_span: span("v01.c01.b0005", "v01.c01.b0006"),
}, { risk_flags: ["possible_duplicate"] });
const cETest = cand("event", "v01.c03.b0002", span("v01.c03.b0001", "v01.c03.b0008"), "v01.c03.b0002", 0.85, {
  id: "event_white_card_test", type: "special_exam", title: "白卡测试举行", summary: "四班学生参加白卡测试，D班平均分居中。", summary_source: "ai_draft", position: "v01.c03.b0002", participants: ["entity_linche", "entity_xu_yingbai", "entity_zhoumi", "entity_shenyan"], related_entities: ["entity_d_class"], importance: "major", visible_from: "v01.c03.b0002", status: "accepted", source_span: span("v01.c03.b0001", "v01.c03.b0008"),
});
// SPOILER: reveal event. source_span points back to c02, but visible_from is the epilogue reveal.
const cEReveal = cand("event", "v01.epilogue.b0002", span("v01.c02.b0005", "v01.epilogue.b0004"), "v01.epilogue.b0002", 0.9, {
  id: "event_unsent_list_revealed", type: "reveal", title: "未寄出名单真相揭示", summary: "沈砚揭示未寄出的名单实为暗中分组的对照记录。", summary_source: "ai_draft", position: "v01.epilogue.b0002", participants: ["entity_shenyan", "entity_linche"], related_entities: ["entity_student_council"], importance: "critical", visible_from: "v01.epilogue.b0002", status: "accepted", source_span: span("v01.c02.b0005", "v01.epilogue.b0004"),
}, { evidence: "epilogue b0002/b0004 揭示伏笔。", risk_flags: ["late_reveal"] });

// ---- relation_change candidates (one spoiler-bound) ----
const cRel = cand("relation_change", "v01.c03.b0004", span("v01.c02.b0002", "v01.c03.b0004"), "v01.c03.b0004", 0.7, {
  id: "relation_linche_shenyan_v01_c03", entities: ["entity_linche", "entity_shenyan"], before: "C02 初识，互相试探。", after: "白卡测试中沈砚提醒林澈，关系略有靠近但仍存戒备。", event_id: "event_white_card_test", valid_from: "v01.c03.b0004", visible_from: "v01.c03.b0004", status: "accepted", source_span: span("v01.c02.b0002", "v01.c03.b0004"),
}, { risk_flags: ["subjective"] });
const cRelReveal = cand("relation_change", "v01.epilogue.b0004", span("v01.epilogue.b0002", "v01.epilogue.b0004"), "v01.epilogue.b0004", 0.8, {
  id: "relation_linche_shenyan_v01_epilogue", entities: ["entity_linche", "entity_shenyan"], before: "戒备但好奇。", after: "沈砚坦白名单真相后，林澈对其复杂动机有了新认识。", event_id: "event_unsent_list_revealed", valid_from: "v01.epilogue.b0004", visible_from: "v01.epilogue.b0004", status: "accepted", source_span: span("v01.epilogue.b0002", "v01.epilogue.b0004"),
});

// ---- speaker_label candidates ----
const cSpZhou = cand("speaker_label", "v01.c01.b0002", span("v01.c01.b0002"), "v01.c01.b0002", 0.55, {
  id: "speaker_v01_c01_b0002_001", block_id: "v01.c01.b0002", speaker_type: "entity", speaker_entity_id: "entity_zhoumi", display_name: "圆脸男生", confidence: 0.55, visible_from: "v01.c01.b0002", status: "accepted", source_span: span("v01.c01.b0002"),
}, { risk_flags: ["low_confidence"] });
const cSpXu = cand("speaker_label", "v01.c01.b0003", span("v01.c01.b0003"), "v01.c01.b0003", 0.9, {
  id: "speaker_v01_c01_b0003_001", block_id: "v01.c01.b0003", speaker_type: "entity", speaker_entity_id: "entity_xu_yingbai", display_name: "许映白", confidence: 0.9, visible_from: "v01.c01.b0003", status: "accepted", source_span: span("v01.c01.b0003"),
});
const cSpShen = cand("speaker_label", "v01.c03.b0004", span("v01.c03.b0004"), "v01.c03.b0004", 0.85, {
  id: "speaker_v01_c03_b0004_001", block_id: "v01.c03.b0004", speaker_type: "entity", speaker_entity_id: "entity_shenyan", display_name: "沈砚", confidence: 0.85, visible_from: "v01.c03.b0004", status: "accepted", source_span: span("v01.c03.b0004"),
});

// ---- metric + metric_change candidates ----
const cMetric = cand("metric", "v01.c01.b0006", span("v01.c01.b0006"), "v01.c01.b0006", 0.9, {
  id: "metric_d_class_points", subject_id: "entity_d_class", name: "D班班级点数", metric_type: "class_points", unit: "points", value_type: "integer", visible_from: "v01.c01.b0006", status: "accepted", source_span: span("v01.c01.b0006"),
});
const cMcInit = cand("metric_change", "v01.c01.b0006", span("v01.c01.b0006"), "v01.c01.b0006", 0.9, {
  id: "metric_change_d_class_points_init", metric_id: "metric_d_class_points", old_value: 0, new_value: 100, delta: 100, reason: "公布初始班级点数。", reason_event_id: "event_points_announced", valid_from: "v01.c01.b0006", visible_from: "v01.c01.b0006", status: "accepted", source_span: span("v01.c01.b0006"),
});
const cMcTest = cand("metric_change", "v01.c03.b0007", span("v01.c03.b0007", "v01.c03.b0008"), "v01.c03.b0007", 0.85, {
  id: "metric_change_d_class_points_test", metric_id: "metric_d_class_points", old_value: 100, new_value: 150, delta: 50, reason: "白卡测试后班级点数增加五十点。", reason_event_id: "event_white_card_test", valid_from: "v01.c03.b0007", visible_from: "v01.c03.b0007", status: "accepted", source_span: span("v01.c03.b0007", "v01.c03.b0008"),
});
// individual points with a KNOWN value (contrast: 许映白's value is unknown -> OpenQuestion).
const cMetricInd = cand("metric", "v01.c03.b0007", span("v01.c03.b0007"), "v01.c03.b0007", 0.9, {
  id: "metric_linche_personal_points", subject_id: "entity_linche", name: "林澈个人点数", metric_type: "personal_points", unit: "points", value_type: "integer", visible_from: "v01.c03.b0007", status: "accepted", source_span: span("v01.c03.b0007"),
});
const cMcInd = cand("metric_change", "v01.c03.b0007", span("v01.c03.b0007"), "v01.c03.b0007", 0.85, {
  id: "metric_change_linche_personal_points_test", metric_id: "metric_linche_personal_points", old_value: 0, new_value: 20, delta: 20, reason: "白卡测试个人排名前三获得个人点数二十点。", reason_event_id: "event_white_card_test", valid_from: "v01.c03.b0007", visible_from: "v01.c03.b0007", status: "accepted", source_span: span("v01.c03.b0007"),
});

// ---- term_card + character_card candidates ----
const cTermCard = cand("term_card", "v01.c01.b0005", span("v01.c01.b0005", "v01.c01.b0006"), "v01.c01.b0006", 0.85, {
  id: "term_card_class_points_v01", term_entity_id: "term_class_points", title: "班级点数", summary: "决定班级待遇与资源分配的核心数值，初始一百分。", summary_source: "ai_draft", visible_from: "v01.c01.b0006", status: "accepted", source_span: span("v01.c01.b0005", "v01.c01.b0006"),
});
const cCharCard = cand("character_card", "v01.c03.b0008", span("v01.c01.b0003", "v01.c03.b0008"), "v01.end", 0.8, {
  id: "card_xu_yingbai_v01_end", entity_id: "entity_xu_yingbai", version_position: "v01.end", short_summary: "成绩优秀、社交冷淡的D班学生，个人点数有未公开变动。", reader_memory: "读者此时应记得她与D班制度、白卡测试的关系，以及其点数变化尚不明朗。", source_refs: ["fact_xu_yingbai_class_v01", "event_white_card_test"], visible_from: "v01.end", summary_source: "ai_draft", status: "accepted",
});

// ---- asset_subject candidates (one accepted, one low-conf -> review) ----
const cAsset1 = cand("asset_subject", "v01.prologue.b0007", span("v01.prologue.b0007"), "v01.prologue.b0007", 1.0, {
  id: "asset_subject_img001_linche", asset_id: "v01_img_001", asset_anchor_id: "asset_anchor_002", subject_type: "entity", entity_id: "entity_linche", role: "depicted", confidence: 1.0, visible_from: "v01.prologue.b0007", source: "manual", status: "accepted",
});
const cAsset2 = cand("asset_subject", "v01.c01.b0009", span("v01.c01.b0009"), "v01.c01.b0009", 0.4, {
  id: "asset_subject_img002_person", asset_id: "v01_img_002", asset_anchor_id: "asset_anchor_003", subject_type: "entity", entity_id: "entity_xu_yingbai", role: "depicted", confidence: 0.4, visible_from: "v01.c01.b0009", source: "ai_vision", status: "accepted",
}, { risk_flags: ["image_person_id", "low_confidence"] });
// group photo (合照): one image -> multiple confirmed subjects (林澈 + 沈砚).
const cAssetG1 = cand("asset_subject", "v01.c02.b0002", span("v01.c02.b0002"), "v01.c02.b0002", 1.0, {
  id: "asset_subject_img005_linche", asset_id: "v01_img_005", asset_anchor_id: "asset_anchor_004", subject_type: "entity", entity_id: "entity_linche", role: "depicted", confidence: 1.0, visible_from: "v01.c02.b0002", source: "manual", status: "accepted",
});
const cAssetG2 = cand("asset_subject", "v01.c02.b0002", span("v01.c02.b0002"), "v01.c02.b0002", 1.0, {
  id: "asset_subject_img005_shenyan", asset_id: "v01_img_005", asset_anchor_id: "asset_anchor_004", subject_type: "entity", entity_id: "entity_shenyan", role: "depicted", confidence: 1.0, visible_from: "v01.c02.b0002", source: "manual", status: "accepted",
});

// ---- open_question + review_item candidates ----
const cOQ = specialCand("open_question", "v01.c03.b0007", span("v01.c03.b0007", "v01.c03.b0008"), "v01.c03.b0007", {
  question: "许映白的个人点数发生了变化，但正文未公布具体数值，是否后文揭示？",
  risk_level: "medium",
  related_entity_ids: ["entity_xu_yingbai"],
  revisit_after: "v01.epilogue.end",
  review_reason: "知道发生变化但缺具体数值，不能生成精确 metric_change。",
});
const cRI = specialCand("review_item", "v01.c01.b0002", span("v01.c01.b0002"), "v01.c01.b0002", {
  review_reason: "候选实体 entity_circle_face_boy 可能与 entity_zhoumi 是同一人，需人工裁决是否合并。",
  recommended_action: "merge_or_reject",
  related_candidate_ids: ["entity_circle_face_boy"],
});

// =====================================================================
// Human review session (replayed through the controlled write path).
// =====================================================================
const accepted = new AcceptedStore(store, SERIES, NOW);
const review = new ReviewQueue(store, NOW);
const workRuns = new WorkRunStore(store, NOW);
const statusOf = new Map<string, Candidate["status"]>();
const acceptC = (c: Candidate) => {
  accepted.acceptCandidate(c, { approvedBy: "user" });
  statusOf.set(c.id, "accepted");
};

// Entities first so later refs resolve. linche / d_class / gray_tower are
// created manually (no candidate); the rest are accepted from candidates.
accepted.manualCreate("entity", { id: "entity_linche", series_id: SERIES, type: "character", name: "林澈", aliases: [], first_seen: "v01.prologue.b0001", status: "accepted", source_span: span("v01.prologue.b0001") }, { approvedBy: "user", reason: "主角，人工建立。" });
accepted.manualCreate("entity", { id: "entity_d_class", series_id: SERIES, type: "group", name: "一年D班", aliases: ["D班"], first_seen: "v01.prologue.b0005", status: "accepted", source_span: span("v01.prologue.b0005") }, { approvedBy: "user" });
accepted.manualCreate("entity", { id: "entity_gray_tower", series_id: SERIES, type: "organization", name: "灰塔学院", aliases: [], first_seen: "v01.prologue.b0001", status: "accepted", source_span: span("v01.prologue.b0001") }, { approvedBy: "user" });

acceptC(cXu);
acceptC(cBai);
acceptC(cShen);
acceptC(cBClass);
acceptC(cCouncil);
acceptC(cPointsTerm);
acceptC(cWctTerm);
acceptC(cListTerm);

// modified-accept: edit 周弥 candidate's name before accepting.
accepted.acceptCandidate(cZhou, {
  approvedBy: "user",
  editedDraft: { ...(cZhou.payload.draft as Draft), name: "周弥", aliases: ["圆脸男生"] },
});
statusOf.set(cZhou.id, "accepted_with_edit");

// duplicate entity rejected (NOT auto-merged); raised as a ReviewItem instead.
statusOf.set(cDup.id, "rejected");
review.createReviewItem({
  id: "review_v01_c01_0001", type: "candidate_conflict", status: "open", priority: "medium",
  block_id: "v01.c01.b0002", source_span: span("v01.c01.b0002"),
  candidate_id: cDup.id, message: cRI.payload.review_reason, recommended_action: "merge_or_reject", created_by: "agent",
});
statusOf.set(cRI.id, "converted_to_review_item");

// facts / events / relations / speakers / metrics / cards.
acceptC(cFLin); acceptC(cFXu); acceptC(cFShen); acceptC(cFBai);
acceptC(cEPoints); acceptC(cETest); acceptC(cEReveal);
statusOf.set(cEPointsDup.id, "rejected"); // duplicate event rejected
acceptC(cRel); acceptC(cRelReveal);
acceptC(cSpZhou); acceptC(cSpXu); acceptC(cSpShen);
acceptC(cMetric); acceptC(cMcInit); acceptC(cMcTest);
acceptC(cMetricInd); acceptC(cMcInd);
acceptC(cTermCard); acceptC(cCharCard);
acceptC(cAsset1); acceptC(cAssetG1); acceptC(cAssetG2);

// low-confidence image person-id -> ReviewItem, not accepted.
statusOf.set(cAsset2.id, "converted_to_review_item");
review.createReviewItem({
  id: "review_v01_c01_0002", type: "image_person_id", status: "open", priority: "low",
  block_id: "v01.c01.b0009", source_span: span("v01.c01.b0009"),
  candidate_id: cAsset2.id, message: "图片人物身份置信度低，需人工确认。", recommended_action: "confirm_or_reject", created_by: "agent",
});

// unknown individual points -> OpenQuestion (no precise metric_change).
statusOf.set(cOQ.id, "converted_to_open_question");
review.createOpenQuestion({
  id: "oq_v01_c03_0001", type: "missing_metric_value", status: "open", risk_level: "medium",
  source_span: span("v01.c03.b0007", "v01.c03.b0008"),
  question: cOQ.payload.question, related_entity_ids: ["entity_xu_yingbai"], related_candidate_ids: [cOQ.id], related_accepted_ids: [],
  revisit_after: "v01.epilogue.end", resolution: null, resolved_by_change_id: null, created_by: "agent",
});

// ---- block progress: blocks that carry candidates ----
const byBlock = new Map<string, number>();
for (const c of candidates) byBlock.set(c.block_id!, (byBlock.get(c.block_id!) ?? 0) + 1);
const openQuestionBlocks = new Set(["v01.c03.b0007"]);
for (const [block_id, count] of [...byBlock.entries()].sort()) {
  review.setBlockProgress({
    block_id,
    status: openQuestionBlocks.has(block_id) ? "has_open_question" : "reviewed",
    candidate_count: count,
    open_question_count: openQuestionBlocks.has(block_id) ? 1 : 0,
  });
}

// ---- work run record ----
workRuns.createWorkRun({
  id: "work_v01_full_001", start_block: "v01.prologue.b0001", end_block: "v01.epilogue.b0008",
  status: "completed", task_types: ["entity", "fact", "event", "relation_change", "speaker_label", "metric", "metric_change", "term_card", "character_card", "asset_subject", "open_question", "review_item"],
  context_estimate: { text_tokens: 4200, history_tokens: 0, schema_tokens: 3000, output_budget_tokens: 4000, total_tokens: 11200 },
  created_candidate_count: candidates.length,
});

// ---- apply candidate statuses + persist everything ----
for (const c of candidates) c.status = statusOf.get(c.id) ?? "pending_review";
store.writeJsonl("candidates/candidates.jsonl", candidates);
accepted.save();
review.save();
workRuns.save();

console.log(`[fixture] candidates=${candidates.length} changes=${accepted.changeCount()}`);
console.log("[fixture] wrote candidates + accepted + review + work_runs");
