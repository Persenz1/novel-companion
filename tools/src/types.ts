// Shared types for the novel-companion phase 1 toolchain.
//
// These mirror the on-disk JSON/JSONL shapes defined in
// docs/modules/bookpack-data.md. The Chinese main text is the single spine;
// Japanese only ever appears as reference content inside alignments.

export type BlockKind = "paragraph" | "dialogue" | "separator" | "note";

export type AlignmentStatus = "parsed" | "pending_review" | "reviewed";

export type AnchorType = "after_block" | "before_block" | "replace_block";

// ----- manifest.json -----

export interface ManifestChapter {
  id: string;
  order: number;
  kind: string;
  title: string;
}

export interface ManifestVolume {
  id: string;
  title: string;
  main_text: string;
  chapters: ManifestChapter[];
}

export interface Manifest {
  schema_version: string;
  pack_id: string;
  pack_name: string;
  pack_type: "project" | "reader";
  series: { id: string; title: string };
  volumes: ManifestVolume[];
  features?: Record<string, boolean>;
  rights?: Record<string, unknown>;
}

// ----- parsed/*.jsonl -----

export interface Block {
  id: string;
  series_id: string;
  volume_id: string;
  chapter_id: string;
  order: number;
  kind: BlockKind;
  text: string;
  source_markdown: string;
}

export interface Scene {
  id: string;
  series_id: string;
  volume_id: string;
  chapter_id: string;
  order: number;
  title: string | null;
  start_block: string | null;
  end_block: string | null;
  pov: string | null;
  location_entity_id: string | null;
  status: "parsed";
}

export interface Asset {
  id: string;
  type: "image";
  path: string | null;
  alt: string | null;
  source_volume_id: string;
}

export interface AssetAnchor {
  id: string;
  asset_id: string;
  anchor_type: AnchorType;
  block_id: string;
}

export interface JaRef {
  id: string;
  order: number;
  text: string;
}

export interface Alignment {
  id: string;
  series_id: string;
  volume_id: string;
  chapter_id: string;
  zh_block_ids: string[];
  ja_refs: JaRef[];
  confidence: number | null;
  status: AlignmentStatus;
}

// ----- reports/cleaning_report.json -----

export interface CleaningNote {
  code: string;
  severity: "info" | "warning";
  message: string;
  file?: string;
  line?: number;
  object_id?: string;
}

export interface CleaningReport {
  status: "ok" | "ok_with_warnings";
  generated_at: string;
  generator: string;
  volumes: Array<{
    volume_id: string;
    main_text: string;
    chapter_count: number;
    block_count: number;
    scene_count: number;
    asset_count: number;
    alignment_count: number;
  }>;
  counts: {
    blocks: number;
    scenes: number;
    assets: number;
    asset_anchors: number;
    alignments: number;
  };
  notes: CleaningNote[];
}

export interface ParsedBundle {
  blocks: Block[];
  scenes: Scene[];
  assets: Asset[];
  asset_anchors: AssetAnchor[];
  alignments: Alignment[];
}

// ----- candidates/candidates.jsonl -----

export interface SourceSpan {
  start_block: string;
  end_block: string;
}

export type CandidateStatus =
  | "pending_review"
  | "accepted"
  | "accepted_with_edit"
  | "rejected"
  | "converted_to_review_item"
  | "converted_to_open_question"
  | "superseded";

export interface Candidate {
  id: string;
  series_id: string;
  type: string;
  block_id?: string;
  source_span: SourceSpan;
  visible_from: string;
  confidence: number;
  status: CandidateStatus;
  model: string;
  task_id: string;
  payload: {
    target_type?: string;
    draft?: Record<string, unknown>;
    evidence?: string;
    risk_flags?: string[];
    question?: string;
    review_reason?: string;
    [k: string]: unknown;
  };
}

// ----- reports/validation_report.json -----

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  block_id?: string;
  chapter_id?: string;
  object_id?: string;
  suggested_action?: string;
}

export interface ValidationReport {
  status: "passed" | "failed";
  generated_at: string;
  generator: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
