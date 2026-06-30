// Validator: hard checks + soft hints over a bookpack, per
// docs/modules/toolchain.md. Writes reports/validation_report.json.
//
// An `error` blocks the next stage (compile/import); a `warning` does not but
// must be recorded. Every issue tries to carry a fixable location so a human
// or cleaning AI can act on it (validation-spec §4, §12).
import { FileStore } from "./fileStore.js";
import { scanMarkers, type Marker } from "./markdown/scan.js";
import { splitList } from "./markdown/comment.js";
import { buildTimeline, type Timeline } from "./timeline.js";
import { ACCEPTED_TYPE_FILES } from "./acceptedTypes.js";
import type {
  Alignment,
  Asset,
  AssetAnchor,
  Block,
  Manifest,
  Scene,
  ValidationIssue,
  ValidationReport,
} from "./types.js";

const ACCEPTED_STATUSES = new Set(["accepted", "deprecated", "merged"]);
const CHANGE_OPERATIONS = new Set([
  "accept_candidate",
  "accept_candidate_with_edit",
  "manual_create",
  "manual_update",
  "merge_entities",
  "deprecate_object",
]);
const CANDIDATE_TYPES = new Set([
  "entity",
  "fact",
  "event",
  "relation_change",
  "speaker_label",
  "metric",
  "metric_change",
  "term_card",
  "character_card",
  "asset_subject",
  "open_question",
  "review_item",
]);
const BLOCK_PROGRESS_STATUSES = new Set([
  "unreviewed",
  "ai_generated",
  "reviewing",
  "reviewed",
  "has_open_question",
  "skipped",
]);
const REVIEW_ITEM_STATUSES = new Set(["open", "resolved", "dismissed", "converted_to_open_question"]);
const OPEN_QUESTION_STATUSES = new Set(["open", "resolved", "dismissed"]);

type Rec = Record<string, unknown>;

interface SourceSpan {
  start_block?: unknown;
  end_block?: unknown;
}

class Issues {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];
  error(i: Omit<ValidationIssue, "severity">): void {
    this.errors.push({ ...i, severity: "error" });
  }
  warn(i: Omit<ValidationIssue, "severity">): void {
    this.warnings.push({ ...i, severity: "warning" });
  }
}

export class Validator {
  private readonly store: FileStore;
  private readonly issues = new Issues();

  constructor(store: FileStore) {
    this.store = store;
  }

  /** Validate the whole pack and write reports/validation_report.json. */
  validateBookpack(): ValidationReport {
    let manifest: Manifest | null = null;
    if (!this.store.exists("manifest.json")) {
      this.issues.error({
        code: "MANIFEST_MISSING",
        message: "manifest.json 不存在。",
        file: "manifest.json",
        suggested_action: "在 bookpack 根目录创建 manifest.json。",
      });
    } else {
      try {
        manifest = this.store.readJson<Manifest>("manifest.json");
      } catch (err) {
        this.issues.error({
          code: "MANIFEST_INVALID_JSON",
          message: `manifest.json 不是合法 JSON：${(err as Error).message}`,
          file: "manifest.json",
        });
      }
    }

    if (manifest) {
      this.validateManifest(manifest);
      const parsed = this.loadAndValidateParsed(manifest);
      this.validateMarkdown(manifest, parsed);
      const timeline = buildTimeline(manifest, parsed.blocks);
      this.validateAccepted(parsed, timeline);
      this.validateCandidates(parsed, timeline);
      this.validateReview(parsed, timeline);
      this.validateCompiled();
    }

    const report: ValidationReport = {
      status: this.issues.errors.length > 0 ? "failed" : "passed",
      generated_at: new Date().toISOString(),
      generator: "novel-companion-tools/validator@0.1.0",
      errors: this.issues.errors,
      warnings: this.issues.warnings,
    };
    this.store.writeJson("reports/validation_report.json", report);
    return report;
  }

  // ----- §5 manifest -----

  private validateManifest(m: Manifest): void {
    const I = this.issues;
    if (!m.schema_version) I.error({ code: "MANIFEST_SCHEMA_VERSION_MISSING", message: "schema_version 缺失。", file: "manifest.json" });
    if (!m.pack_id) I.error({ code: "MANIFEST_PACK_ID_MISSING", message: "pack_id 缺失或非法。", file: "manifest.json" });
    if (m.pack_type !== "project" && m.pack_type !== "reader")
      I.error({ code: "MANIFEST_PACK_TYPE_INVALID", message: "pack_type 不是 project 或 reader。", file: "manifest.json" });
    if (!m.series?.id) I.error({ code: "MANIFEST_SERIES_ID_MISSING", message: "series.id 缺失。", file: "manifest.json" });
    if (!m.volumes || m.volumes.length === 0) {
      I.error({ code: "MANIFEST_VOLUMES_EMPTY", message: "volumes 为空。", file: "manifest.json" });
      return;
    }

    const volIds = new Set<string>();
    for (const v of m.volumes) {
      if (volIds.has(v.id)) I.error({ code: "MANIFEST_VOLUME_ID_DUPLICATE", message: `volume id 重复：${v.id}`, file: "manifest.json", object_id: v.id });
      volIds.add(v.id);
      if (!v.main_text || !this.store.exists(v.main_text))
        I.error({ code: "MANIFEST_MAIN_TEXT_MISSING", message: `volume ${v.id} 的 main_text 文件不存在：${v.main_text}`, file: "manifest.json", object_id: v.id });
      const chapterIds = new Set<string>();
      const chapterOrders = new Set<number>();
      for (const c of v.chapters ?? []) {
        if (chapterIds.has(c.id)) I.error({ code: "MANIFEST_CHAPTER_ID_DUPLICATE", message: `chapter id 重复：${c.id}`, file: "manifest.json", chapter_id: c.id });
        chapterIds.add(c.id);
        if (chapterOrders.has(c.order)) I.error({ code: "MANIFEST_CHAPTER_ORDER_DUPLICATE", message: `同卷内 chapter order 重复：${c.order}（${c.id}）`, file: "manifest.json", chapter_id: c.id });
        chapterOrders.add(c.order);
      }
    }

    if (m.pack_type === "reader") {
      for (const dir of ["candidates", "review"]) {
        if (this.store.listDir(dir).length > 0)
          I.error({ code: "READER_PACK_HAS_PROJECT_DIR", message: `reader 包中不应出现 ${dir}/ 目录。`, file: "manifest.json" });
      }
    }

    if (!m.rights || !(m.rights as Rec).rights_note)
      I.warn({ code: "MANIFEST_RIGHTS_NOTE_EMPTY", message: "rights.rights_note 为空。", file: "manifest.json" });
  }

  // ----- §7 parsed -----

  private loadAndValidateParsed(m: Manifest): {
    blocks: Block[];
    scenes: Scene[];
    assets: Asset[];
    anchors: AssetAnchor[];
    alignments: Alignment[];
    blockIds: Set<string>;
    chapterIds: Set<string>;
    assetIds: Set<string>;
    anchorIds: Set<string>;
  } {
    const I = this.issues;
    const chapterIds = new Set<string>();
    for (const v of m.volumes) for (const c of v.chapters ?? []) chapterIds.add(c.id);

    const blocks = this.readJsonlReporting<Block>("parsed/blocks.jsonl");
    const scenes = this.readJsonlReporting<Scene>("parsed/scenes.jsonl");
    const assets = this.readJsonlReporting<Asset>("parsed/assets.jsonl");
    const anchors = this.readJsonlReporting<AssetAnchor>("parsed/asset_anchors.jsonl");
    const alignments = this.readJsonlReporting<Alignment>("parsed/alignments.jsonl");

    const blockIds = new Set<string>();
    for (const b of blocks) {
      if (blockIds.has(b.id)) I.error({ code: "BLOCK_ID_DUPLICATE", message: `blocks.jsonl 中 block id 重复：${b.id}`, file: "parsed/blocks.jsonl", block_id: b.id });
      blockIds.add(b.id);
      if (b.chapter_id && !chapterIds.has(b.chapter_id))
        I.error({ code: "BLOCK_CHAPTER_MISSING", message: `block ${b.id} 引用不存在的 chapter ${b.chapter_id}`, file: "parsed/blocks.jsonl", block_id: b.id });
    }
    for (const s of scenes) {
      for (const ref of [s.start_block, s.end_block]) {
        if (ref && !blockIds.has(ref))
          I.error({ code: "SCENE_BLOCK_MISSING", message: `scene ${s.id} 引用不存在的 block ${ref}`, file: "parsed/scenes.jsonl", object_id: s.id });
      }
    }
    const assetIds = new Set<string>();
    for (const a of assets) {
      if (assetIds.has(a.id)) I.error({ code: "ASSET_ID_DUPLICATE", message: `assets.jsonl 中 asset id 重复：${a.id}`, file: "parsed/assets.jsonl", object_id: a.id });
      assetIds.add(a.id);
    }
    const anchorIds = new Set<string>();
    for (const an of anchors) {
      anchorIds.add(an.id);
      if (!assetIds.has(an.asset_id)) I.error({ code: "ANCHOR_ASSET_MISSING", message: `asset_anchor ${an.id} 引用不存在的 asset ${an.asset_id}`, file: "parsed/asset_anchors.jsonl", object_id: an.id });
      if (an.block_id && !blockIds.has(an.block_id)) I.error({ code: "ANCHOR_BLOCK_MISSING", message: `asset_anchor ${an.id} 引用不存在的 block ${an.block_id}`, file: "parsed/asset_anchors.jsonl", object_id: an.id });
    }
    for (const al of alignments) {
      for (const zb of al.zh_block_ids ?? []) {
        if (!blockIds.has(zb)) I.error({ code: "ALIGNMENT_BLOCK_MISSING", message: `alignment ${al.id} 引用不存在的中文 block ${zb}`, file: "parsed/alignments.jsonl", object_id: al.id });
      }
      if (al.status !== "reviewed") I.warn({ code: "ALIGNMENT_NOT_REVIEWED", message: `alignment ${al.id} 状态不是 reviewed。`, file: "parsed/alignments.jsonl", object_id: al.id });
    }

    return { blocks, scenes, assets, anchors, alignments, blockIds, chapterIds, assetIds, anchorIds };
  }

  // ----- §6 markdown -----

  private validateMarkdown(m: Manifest, parsed: { blockIds: Set<string> }): void {
    const I = this.issues;
    for (const volume of m.volumes) {
      if (!volume.main_text || !this.store.exists(volume.main_text)) continue;
      const md = this.store.readText(volume.main_text);
      const file = volume.main_text;
      const { markers, malformedComments } = scanMarkers(md);
      for (const line of malformedComments)
        I.error({ code: "COMMENT_FORMAT_INVALID", message: "已识别 HTML 注释不符合 `tag: primary key: value` 格式。", file, line });

      const declaredChapters = new Set((volume.chapters ?? []).map((c) => c.id));
      const seenChapters = new Set<string>();
      const blockIdsInMd = new Set<string>();
      let currentChapter: string | null = null;
      const openScenes: string[] = [];

      for (const mk of markers) {
        switch (mk.tag) {
          case "chapter": {
            currentChapter = mk.primary;
            seenChapters.add(mk.primary);
            if (!declaredChapters.has(mk.primary))
              I.error({ code: "CHAPTER_NOT_IN_MANIFEST", message: `Markdown 中的 chapter 未在 manifest 声明：${mk.primary}`, file, line: mk.line, chapter_id: mk.primary });
            this.checkChapterTitle(m, volume.id, mk, file);
            break;
          }
          case "block": {
            if (blockIdsInMd.has(mk.primary))
              I.error({ code: "BLOCK_ID_DUPLICATE", message: `block id 重复：${mk.primary}`, file, line: mk.line, block_id: mk.primary, suggested_action: "为重复 block 重新分配稳定 ID 并同步引用。" });
            blockIdsInMd.add(mk.primary);
            if (currentChapter && !mk.primary.startsWith(currentChapter + "."))
              I.error({ code: "BLOCK_PREFIX_MISMATCH", message: `block ${mk.primary} 前缀与当前章节 ${currentChapter} 不匹配。`, file, line: mk.line, block_id: mk.primary });
            if (!mk.attrs.kind) I.warn({ code: "BLOCK_KIND_OMITTED", message: `block ${mk.primary} 省略 kind。`, file, line: mk.line, block_id: mk.primary });
            break;
          }
          case "scene": {
            const action = mk.attrs.action;
            if (action !== "start" && action !== "end") {
              I.error({ code: "SCENE_ACTION_MISSING", message: `scene ${mk.primary} 缺少 action: start 或 action: end。`, file, line: mk.line, object_id: mk.primary });
              break;
            }
            if (mk.primary.split(".")[1] !== currentChapter?.split(".")[1])
              I.error({ code: "SCENE_CROSS_CHAPTER", message: `scene ${mk.primary} 跨章节或不属于当前章节 ${currentChapter}。`, file, line: mk.line, object_id: mk.primary });
            if (action === "start") {
              if (openScenes.length > 0)
                I.error({ code: "SCENE_NESTED", message: `scene ${mk.primary} 在 ${openScenes[openScenes.length - 1]} 未结束时开始（嵌套/交叉）。`, file, line: mk.line, object_id: mk.primary });
              openScenes.push(mk.primary);
            } else {
              const top = openScenes.pop();
              if (top !== mk.primary)
                I.error({ code: "SCENE_END_NO_START", message: `scene end ${mk.primary} 找不到对应的 start。`, file, line: mk.line, object_id: mk.primary });
            }
            break;
          }
          case "asset": {
            if (!mk.attrs.anchor_type || !mk.attrs.block)
              I.error({ code: "ASSET_ANCHOR_INCOMPLETE", message: `asset ${mk.primary} 缺少 anchor_type 或 block。`, file, line: mk.line, object_id: mk.primary });
            else if (!blockIdsInMd.has(mk.attrs.block) && !parsed.blockIds.has(mk.attrs.block))
              I.error({ code: "ASSET_BLOCK_MISSING", message: `asset ${mk.primary} 引用不存在的 block ${mk.attrs.block}`, file, line: mk.line, object_id: mk.primary });
            break;
          }
          case "alignment":
            break;
          default:
            I.warn({ code: "UNKNOWN_MARKER_TAG", message: `未识别的 HTML 注释标记：${mk.tag}`, file, line: mk.line, object_id: mk.primary });
        }
      }

      for (const open of openScenes)
        I.error({ code: "SCENE_NOT_CLOSED", message: `scene ${open} 缺少 end 标记。`, file, object_id: open });
      for (const c of declaredChapters) {
        if (!seenChapters.has(c))
          I.error({ code: "CHAPTER_MISSING_IN_MARKDOWN", message: `manifest 声明的章节未在 Markdown 中出现：${c}`, file, chapter_id: c });
      }
    }
  }

  private checkChapterTitle(m: Manifest, volumeId: string, mk: Marker, file: string): void {
    const declared = m.volumes.find((v) => v.id === volumeId)?.chapters.find((c) => c.id === mk.primary);
    if (declared && mk.attrs.title && declared.title !== mk.attrs.title)
      this.issues.warn({ code: "CHAPTER_TITLE_MISMATCH", message: `章节 ${mk.primary} 注释 title 与 manifest title 不一致。`, file, line: mk.line, chapter_id: mk.primary });
  }

  // ----- §8 accepted -----

  private validateAccepted(
    parsed: { blockIds: Set<string>; assetIds: Set<string>; anchorIds: Set<string> },
    timeline: Timeline,
  ): void {
    const I = this.issues;
    const changes = this.readJsonlReporting<Rec>("accepted/changes.jsonl");
    const changeById = new Map<string, Rec>();
    for (const ch of changes) {
      const id = ch.id as string;
      if (id) changeById.set(id, ch);
      for (const f of ["operation", "target_file", "target_type", "target_id", "approved_by", "created_at"]) {
        if (ch[f] === undefined || ch[f] === null || ch[f] === "")
          I.error({ code: "CHANGE_FIELD_MISSING", message: `change ${id ?? "?"} 缺少 ${f}。`, file: "accepted/changes.jsonl", object_id: id });
      }
      if (typeof ch.operation === "string" && !CHANGE_OPERATIONS.has(ch.operation))
        I.error({ code: "CHANGE_OPERATION_INVALID", message: `change ${id} operation 非法：${ch.operation}`, file: "accepted/changes.jsonl", object_id: id });
      if ((ch.operation === "accept_candidate" || ch.operation === "accept_candidate_with_edit") && !ch.candidate_id)
        I.error({ code: "CHANGE_CANDIDATE_ID_MISSING", message: `change ${id} 为 accept_candidate 类但缺少 candidate_id。`, file: "accepted/changes.jsonl", object_id: id });
    }

    // Collect all accepted objects with their declared type/file.
    const acceptedIds = new Set<string>();
    const idsByType = new Map<string, Set<string>>();
    const all: Array<{ type: string; file: string; obj: Rec }> = [];
    for (const { type, file } of ACCEPTED_TYPE_FILES) {
      const rows = this.readJsonlReporting<Rec>(file);
      const set = new Set<string>();
      idsByType.set(type, set);
      for (const obj of rows) {
        const id = obj.id as string;
        if (id) {
          if (acceptedIds.has(id)) I.error({ code: "ACCEPTED_ID_DUPLICATE", message: `Accepted 对象 ID 重复：${id}`, file, object_id: id });
          acceptedIds.add(id);
          set.add(id);
        }
        all.push({ type, file, obj });
      }
    }

    const entityIds = idsByType.get("entity")!;
    const eventIds = idsByType.get("event")!;
    const metricIds = idsByType.get("metric")!;

    const checkPos = (pos: unknown, field: string, file: string, id: string) => {
      if (typeof pos !== "string" || !timeline.order.hasOwnProperty(pos))
        I.error({ code: "ACCEPTED_POSITION_INVALID", message: `${id} 的 ${field} 引用无效时间线位置：${String(pos)}`, file, object_id: id });
    };
    const checkSpan = (span: SourceSpan | undefined, file: string, id: string) => {
      if (!span) return false;
      for (const ref of [span.start_block, span.end_block]) {
        if (ref !== undefined && (typeof ref !== "string" || !parsed.blockIds.has(ref)))
          I.error({ code: "ACCEPTED_SOURCE_SPAN_BLOCK_MISSING", message: `${id} 的 source_span 引用不存在的 block：${String(ref)}`, file, object_id: id });
      }
      return true;
    };
    const refEntity = (ref: unknown, file: string, id: string, field: string) => {
      if (typeof ref === "string" && ref && !entityIds.has(ref))
        I.error({ code: "ACCEPTED_ENTITY_REF_MISSING", message: `${id} 的 ${field} 引用不存在的 entity：${ref}`, file, object_id: id });
    };

    for (const { type, file, obj } of all) {
      const id = (obj.id as string) ?? "?";
      if (obj.status !== undefined && !ACCEPTED_STATUSES.has(obj.status as string))
        I.error({ code: "ACCEPTED_STATUS_INVALID", message: `${id} status 非法：${String(obj.status)}`, file, object_id: id });

      // visible_from required for everything except entity (entity uses first_seen/source_span).
      if (type !== "entity") checkPos(obj.visible_from, "visible_from", file, id);
      if (obj.valid_from !== undefined && obj.valid_from !== null) checkPos(obj.valid_from, "valid_from", file, id);
      if (obj.valid_until !== undefined && obj.valid_until !== null) checkPos(obj.valid_until, "valid_until", file, id);

      // created_change_id linkage (required for every Accepted object).
      const ccid = obj.created_change_id as string | undefined;
      if (!ccid) I.error({ code: "ACCEPTED_CHANGE_ID_MISSING", message: `${id} 缺少 created_change_id。`, file, object_id: id });
      if (ccid) {
        const ch = changeById.get(ccid);
        if (!ch) I.error({ code: "ACCEPTED_CHANGE_ID_DANGLING", message: `${id} 的 created_change_id 引用不存在的 Change：${ccid}`, file, object_id: id });
        else {
          if (ch.target_id !== id) I.error({ code: "CHANGE_TARGET_ID_MISMATCH", message: `${id} 的 Change ${ccid} target_id 与对象 ID 不一致。`, file, object_id: id });
          if (ch.target_file !== file) I.error({ code: "CHANGE_TARGET_FILE_MISMATCH", message: `${id} 的 Change ${ccid} target_file 与对象所在文件不一致。`, file, object_id: id });
          if (ch.target_type !== type) I.error({ code: "CHANGE_TARGET_TYPE_MISMATCH", message: `${id} 的 Change ${ccid} target_type 与类型映射不一致。`, file, object_id: id });
        }
      }
      for (const uc of (obj.updated_change_ids as string[]) ?? []) {
        if (!changeById.has(uc)) I.error({ code: "ACCEPTED_UPDATE_CHANGE_DANGLING", message: `${id} 的 updated_change_ids 引用不存在的 Change：${uc}`, file, object_id: id });
      }

      // Per-type source/reference rules.
      switch (type) {
        case "entity":
          checkSpan(obj.source_span as SourceSpan, file, id);
          if (obj.first_seen && !parsed.blockIds.has(obj.first_seen as string))
            I.error({ code: "ENTITY_FIRST_SEEN_MISSING", message: `${id} first_seen 引用不存在的 block：${String(obj.first_seen)}`, file, object_id: id });
          break;
        case "fact":
          checkSpan(obj.source_span as SourceSpan, file, id);
          refEntity(obj.subject_id, file, id, "subject_id");
          if (obj.value_type === "entity") {
            if (!obj.value_entity_id) I.error({ code: "FACT_VALUE_ENTITY_MISSING", message: `${id} value_type=entity 但缺少 value_entity_id。`, file, object_id: id });
            else refEntity(obj.value_entity_id, file, id, "value_entity_id");
          }
          break;
        case "event": {
          checkSpan(obj.source_span as SourceSpan, file, id);
          const parts = (obj.participants as string[]) ?? [];
          for (const p of parts) refEntity(p, file, id, "participants");
          for (const r of (obj.related_entities as string[]) ?? []) refEntity(r, file, id, "related_entities");
          if (parts.length === 0) I.warn({ code: "EVENT_NO_PARTICIPANTS", message: `event ${id} 没有关联参与者。`, file, object_id: id });
          break;
        }
        case "relation_change":
          checkSpan(obj.source_span as SourceSpan, file, id);
          for (const e of (obj.entities as string[]) ?? []) refEntity(e, file, id, "entities");
          if (obj.event_id) {
            if (!eventIds.has(obj.event_id as string)) I.error({ code: "RELATION_EVENT_MISSING", message: `${id} event_id 引用不存在的 event：${String(obj.event_id)}`, file, object_id: id });
          } else I.warn({ code: "RELATION_NO_EVENT", message: `relation_change ${id} 没有关联 event。`, file, object_id: id });
          break;
        case "metric":
          checkSpan(obj.source_span as SourceSpan, file, id);
          refEntity(obj.subject_id, file, id, "subject_id");
          break;
        case "metric_change":
          checkSpan(obj.source_span as SourceSpan, file, id);
          if (obj.metric_id && !metricIds.has(obj.metric_id as string))
            I.error({ code: "METRIC_CHANGE_METRIC_MISSING", message: `${id} metric_id 引用不存在的 metric：${String(obj.metric_id)}`, file, object_id: id });
          for (const f of ["old_value", "new_value", "delta"]) {
            if (obj[f] !== undefined && obj[f] !== null && typeof obj[f] !== "number")
              I.error({ code: "METRIC_CHANGE_VALUE_TYPE", message: `${id} 字段 ${f} 不是数值。`, file, object_id: id });
          }
          if (obj.reason_event_id && !eventIds.has(obj.reason_event_id as string))
            I.error({ code: "METRIC_CHANGE_EVENT_MISSING", message: `${id} reason_event_id 引用不存在的 event：${String(obj.reason_event_id)}`, file, object_id: id });
          break;
        case "term_card":
          checkSpan(obj.source_span as SourceSpan, file, id);
          refEntity(obj.term_entity_id, file, id, "term_entity_id");
          break;
        case "character_card": {
          const hasSpan = obj.source_span !== undefined;
          const refs = (obj.source_refs as string[]) ?? [];
          if (!hasSpan && refs.length === 0)
            I.error({ code: "CHARACTER_CARD_NO_SOURCE", message: `${id} 既没有 source_span 也没有 source_refs。`, file, object_id: id });
          if (hasSpan) checkSpan(obj.source_span as SourceSpan, file, id);
          if (refs.length === 0) I.warn({ code: "CHARACTER_CARD_NO_REFS", message: `character_card ${id} 没有 source_refs。`, file, object_id: id });
          for (const r of refs) {
            if (!acceptedIds.has(r)) I.error({ code: "CHARACTER_CARD_REF_MISSING", message: `${id} source_refs 引用不存在的 Accepted 对象：${r}`, file, object_id: id });
          }
          refEntity(obj.entity_id, file, id, "entity_id");
          break;
        }
        case "speaker_label":
          checkSpan(obj.source_span as SourceSpan, file, id);
          if (obj.block_id && !parsed.blockIds.has(obj.block_id as string))
            I.error({ code: "SPEAKER_BLOCK_MISSING", message: `${id} block_id 引用不存在的 block：${String(obj.block_id)}`, file, object_id: id });
          if (obj.speaker_type === "entity") refEntity(obj.speaker_entity_id, file, id, "speaker_entity_id");
          if (typeof obj.confidence === "number" && obj.confidence < 0.5)
            I.warn({ code: "SPEAKER_LOW_CONFIDENCE", message: `speaker_label ${id} 置信度低但进入 Accepted。`, file, object_id: id });
          break;
        case "asset_subject":
          for (const f of ["visible_from", "asset_id", "asset_anchor_id", "source", "created_change_id"]) {
            if (obj[f] === undefined || obj[f] === null || obj[f] === "")
              I.error({ code: "ASSET_SUBJECT_FIELD_MISSING", message: `asset_subject ${id} 缺少 ${f}。`, file, object_id: id });
          }
          if (obj.asset_id && !parsed.assetIds.has(obj.asset_id as string))
            I.error({ code: "ASSET_SUBJECT_ASSET_MISSING", message: `${id} asset_id 引用不存在的 asset：${String(obj.asset_id)}`, file, object_id: id });
          if (obj.asset_anchor_id && !parsed.anchorIds.has(obj.asset_anchor_id as string))
            I.error({ code: "ASSET_SUBJECT_ANCHOR_MISSING", message: `${id} asset_anchor_id 引用不存在的 anchor：${String(obj.asset_anchor_id)}`, file, object_id: id });
          if (obj.entity_id) refEntity(obj.entity_id, file, id, "entity_id");
          break;
      }
    }
  }

  // ----- §9 candidates -----

  private validateCandidates(parsed: { blockIds: Set<string> }, timeline: Timeline): void {
    const I = this.issues;
    const file = "candidates/candidates.jsonl";
    const rows = this.readJsonlReporting<Rec>(file);
    for (const c of rows) {
      const id = (c.id as string) ?? "?";
      if (!c.id) I.error({ code: "CANDIDATE_ID_MISSING", message: "Candidate 缺少 id。", file });
      if (!c.type) I.error({ code: "CANDIDATE_TYPE_MISSING", message: `Candidate ${id} 缺少 type。`, file, object_id: id });
      else if (!CANDIDATE_TYPES.has(c.type as string)) I.error({ code: "CANDIDATE_TYPE_INVALID", message: `Candidate ${id} type 非法：${c.type}`, file, object_id: id });
      const span = c.source_span as SourceSpan | undefined;
      if (!span) I.error({ code: "CANDIDATE_SOURCE_SPAN_MISSING", message: `Candidate ${id} 缺少 source_span。`, file, object_id: id });
      else {
        const sb = span.start_block as string | undefined;
        const eb = span.end_block as string | undefined;
        if (sb && !parsed.blockIds.has(sb)) I.error({ code: "CANDIDATE_SPAN_START_MISSING", message: `Candidate ${id} source_span.start_block 不存在：${sb}`, file, object_id: id });
        if (eb && !parsed.blockIds.has(eb)) I.error({ code: "CANDIDATE_SPAN_END_MISSING", message: `Candidate ${id} source_span.end_block 不存在：${eb}`, file, object_id: id });
        if (sb && eb && timeline.order[sb] !== undefined && timeline.order[eb] !== undefined && timeline.order[sb]! > timeline.order[eb]!)
          I.error({ code: "CANDIDATE_SPAN_ORDER_INVALID", message: `Candidate ${id} source_span 顺序非法。`, file, object_id: id });
        if (c.block_id && sb && eb && timeline.order[c.block_id as string] !== undefined) {
          const bo = timeline.order[c.block_id as string]!;
          if (bo < timeline.order[sb]! || bo > timeline.order[eb]!)
            I.error({ code: "CANDIDATE_BLOCK_OUT_OF_SPAN", message: `Candidate ${id} block_id 不在 source_span 范围内。`, file, object_id: id });
        }
      }
      for (const f of ["visible_from", "confidence", "model", "task_id", "payload"]) {
        if (c[f] === undefined || c[f] === null || c[f] === "")
          I.error({ code: "CANDIDATE_FIELD_MISSING", message: `Candidate ${id} 缺少 ${f}。`, file, object_id: id });
      }
      const payload = c.payload as Rec | undefined;
      const isSpecial = c.type === "open_question" || c.type === "review_item";
      if (payload && !isSpecial) {
        if (!payload.target_type || !payload.draft)
          I.error({ code: "CANDIDATE_PAYLOAD_INCOMPLETE", message: `Candidate ${id} 缺少 payload.target_type 或 payload.draft。`, file, object_id: id });
        else if (payload.target_type !== c.type)
          I.error({ code: "CANDIDATE_PAYLOAD_TYPE_MISMATCH", message: `Candidate ${id} payload.target_type 与 type 不可映射。`, file, object_id: id });
      }
    }
  }

  // ----- §10 review -----

  private validateReview(parsed: { blockIds: Set<string> }, timeline: Timeline): void {
    const I = this.issues;
    const progress = this.readJsonlReporting<Rec>("review/block_progress.jsonl");
    for (const p of progress) {
      if (p.block_id && !parsed.blockIds.has(p.block_id as string))
        I.error({ code: "PROGRESS_BLOCK_MISSING", message: `block_progress 中 block_id 不存在：${String(p.block_id)}`, file: "review/block_progress.jsonl", object_id: p.block_id as string });
      if (!BLOCK_PROGRESS_STATUSES.has(p.status as string))
        I.error({ code: "PROGRESS_STATUS_INVALID", message: `block_progress.status 非法：${String(p.status)}`, file: "review/block_progress.jsonl", object_id: p.block_id as string });
    }
    const checkSpanBlocks = (span: SourceSpan | undefined, file: string, id: string) => {
      if (!span) return;
      for (const ref of [span.start_block, span.end_block])
        if (ref !== undefined && (typeof ref !== "string" || !parsed.blockIds.has(ref)))
          I.error({ code: "REVIEW_SPAN_BLOCK_MISSING", message: `${id} source_span 引用无效 block：${String(ref)}`, file, object_id: id });
    };
    for (const r of this.readJsonlReporting<Rec>("review/review_items.jsonl")) {
      checkSpanBlocks(r.source_span as SourceSpan, "review/review_items.jsonl", r.id as string);
      if (!REVIEW_ITEM_STATUSES.has(r.status as string))
        I.error({ code: "REVIEW_ITEM_STATUS_INVALID", message: `review_item ${String(r.id)} status 非法：${String(r.status)}`, file: "review/review_items.jsonl", object_id: r.id as string });
    }
    for (const q of this.readJsonlReporting<Rec>("review/open_questions.jsonl")) {
      checkSpanBlocks(q.source_span as SourceSpan, "review/open_questions.jsonl", q.id as string);
      if (!OPEN_QUESTION_STATUSES.has(q.status as string))
        I.error({ code: "OPEN_QUESTION_STATUS_INVALID", message: `open_question ${String(q.id)} status 非法：${String(q.status)}`, file: "review/open_questions.jsonl", object_id: q.id as string });
      if (q.revisit_after !== undefined && q.revisit_after !== null && !timeline.order.hasOwnProperty(q.revisit_after as string))
        I.error({ code: "OPEN_QUESTION_REVISIT_INVALID", message: `open_question ${String(q.id)} revisit_after 不是可比较时间线位置：${String(q.revisit_after)}`, file: "review/open_questions.jsonl", object_id: q.id as string });
    }
  }

  // ----- §11 compiled -----

  private validateCompiled(): void {
    if (!this.store.exists("compiled/reader_index.json")) return;
    let compiled: Rec;
    try {
      compiled = this.store.readJson<Rec>("compiled/reader_index.json");
    } catch {
      return; // unparseable stub/placeholder; not yet a real compiled product
    }
    // A pre-compile placeholder (e.g. {"status":"not_compiled"}) carries no
    // schema_version. Compile is gated on validation passing, so we must not
    // let a placeholder block validation — only check real compiled products.
    if (compiled.schema_version === undefined) return;
    const I = this.issues;
    for (const f of ["schema_version", "series_id", "timeline", "accepted"]) {
      if (compiled[f] === undefined)
        I.error({ code: "COMPILED_FIELD_MISSING", message: `reader_index.json 缺少 ${f}。`, file: "compiled/reader_index.json" });
    }
    const vr = compiled.validation_report as Rec | undefined;
    if (vr && vr.status !== "passed")
      I.error({ code: "COMPILED_VALIDATION_NOT_PASSED", message: "compiled 声明的 validation report status 不是 passed。", file: "compiled/reader_index.json" });
    if (compiled.source_summary === undefined)
      I.warn({ code: "COMPILED_SOURCE_SUMMARY_MISSING", message: "compiled 缺少 source_summary。", file: "compiled/reader_index.json" });
  }

  // ----- helpers -----

  private readJsonlReporting<T>(file: string): T[] {
    const { rows, parseErrors } = this.store.readJsonl<T>(file);
    for (const e of parseErrors)
      this.issues.error({ code: "JSONL_INVALID_JSON", message: `JSONL 某行不是合法 JSON：${e.message}`, file, line: e.line });
    return rows;
  }
}
