// Write-side controlled stores for the data-pack loop:
//   CandidateStore  - candidate status (candidates/candidates.jsonl)
//   AcceptedStore   - accepted/*.jsonl + accepted/changes.jsonl
//   ReviewQueue     - review/{block_progress,review_items,open_questions}.jsonl
//   WorkRunStore    - reports/work_runs.jsonl
//
// Per docs/modules/bookpack-data.md: Accepted is only written through this
// controlled path, every Accepted write also emits a Change, and AI may not
// silently write Accepted. These stores are the human-confirmation gate the
// future built-in Agent will call; they do not call any model themselves.
import { FileStore } from "./fileStore.js";
import { acceptedFileFor, ACCEPTED_TYPE_FILES } from "./acceptedTypes.js";
import type { Candidate, CandidateStatus } from "./types.js";

type Rec = Record<string, unknown>;

export class CandidateStore {
  private readonly store: FileStore;
  private rows: Candidate[] = [];
  private byId = new Map<string, Candidate>();

  constructor(store: FileStore) {
    this.store = store;
  }

  load(): this {
    this.rows = this.store.readJsonl<Candidate>("candidates/candidates.jsonl").rows;
    this.byId = new Map(this.rows.map((c) => [c.id, c]));
    return this;
  }

  all(): Candidate[] {
    return this.rows;
  }

  get(id: string): Candidate {
    const c = this.byId.get(id);
    if (!c) throw new Error(`candidate not found: ${id}`);
    return c;
  }

  setStatus(id: string, status: CandidateStatus): void {
    this.get(id).status = status;
  }

  save(): void {
    this.store.writeJsonl("candidates/candidates.jsonl", this.rows);
  }
}

export interface AcceptResult {
  acceptedId: string;
  changeId: string;
}

export class AcceptedStore {
  private readonly store: FileStore;
  private readonly seriesId: string;
  private readonly now: string;
  private changeSeq = 0;
  private readonly changes: Rec[] = [];
  private readonly acceptedByFile = new Map<string, Rec[]>();

  constructor(store: FileStore, seriesId: string, now: string) {
    this.store = store;
    this.seriesId = seriesId;
    this.now = now;
  }

  /** Accept a candidate's draft as Accepted data (+ Change). */
  acceptCandidate(
    candidate: Candidate,
    opts: { approvedBy: string; editedDraft?: Rec; reason?: string },
  ): AcceptResult {
    const draft = opts.editedDraft ?? candidate.payload.draft;
    if (!draft) throw new Error(`candidate ${candidate.id} has no payload.draft`);
    return this.write(candidate.type, draft as Rec, {
      operation: opts.editedDraft ? "accept_candidate_with_edit" : "accept_candidate",
      candidateId: candidate.id,
      approvedBy: opts.approvedBy,
      reason: opts.reason ?? "人工确认 AI 候选。",
    });
  }

  /** Create an Accepted object directly (human-authored, no candidate). */
  manualCreate(
    type: string,
    draft: Rec,
    opts: { approvedBy: string; reason?: string },
  ): AcceptResult {
    return this.write(type, draft, {
      operation: "manual_create",
      approvedBy: opts.approvedBy,
      reason: opts.reason ?? "人工直接创建。",
    });
  }

  private write(
    type: string,
    draft: Rec,
    meta: { operation: string; candidateId?: string; approvedBy: string; reason: string },
  ): AcceptResult {
    const file = acceptedFileFor(type);
    if (!file) throw new Error(`not an accepted type: ${type}`);
    const targetId = draft.id as string;
    if (!targetId) throw new Error(`draft for ${type} has no id`);

    const changeId = `change_${String(++this.changeSeq).padStart(6, "0")}`;
    const accepted: Rec = {
      ...draft,
      status: (draft.status as string) ?? "accepted",
      created_change_id: changeId,
      updated_change_ids: [],
    };
    const change: Rec = {
      id: changeId,
      series_id: this.seriesId,
      operation: meta.operation,
      target_file: file,
      target_type: type,
      target_id: targetId,
      ...(meta.candidateId ? { candidate_id: meta.candidateId } : {}),
      before: null,
      after: { target_id: targetId },
      reason: meta.reason,
      ...(draft.source_span ? { source_span: draft.source_span } : {}),
      approved_by: meta.approvedBy,
      created_at: this.now,
    };

    const list = this.acceptedByFile.get(file) ?? [];
    list.push(accepted);
    this.acceptedByFile.set(file, list);
    this.changes.push(change);
    return { acceptedId: targetId, changeId };
  }

  /** Overwrite every accepted file (empty ones too) + changes.jsonl. */
  save(): void {
    for (const { file } of ACCEPTED_TYPE_FILES) {
      this.store.writeJsonl(file, this.acceptedByFile.get(file) ?? []);
    }
    this.store.writeJsonl("accepted/changes.jsonl", this.changes);
  }

  changeCount(): number {
    return this.changes.length;
  }
}

export class ReviewQueue {
  private readonly store: FileStore;
  private readonly now: string;
  private readonly blockProgress: Rec[] = [];
  private readonly reviewItems: Rec[] = [];
  private readonly openQuestions: Rec[] = [];

  constructor(store: FileStore, now: string) {
    this.store = store;
    this.now = now;
  }

  setBlockProgress(row: {
    block_id: string;
    status: string;
    candidate_count?: number;
    open_question_count?: number;
    updated_by?: string;
  }): void {
    this.blockProgress.push({
      block_id: row.block_id,
      status: row.status,
      candidate_count: row.candidate_count ?? 0,
      open_question_count: row.open_question_count ?? 0,
      updated_by: row.updated_by ?? "user",
      updated_at: this.now,
    });
  }

  createReviewItem(row: Rec): void {
    this.reviewItems.push({ created_at: this.now, ...row });
  }

  createOpenQuestion(row: Rec): void {
    this.openQuestions.push({ created_at: this.now, updated_at: this.now, ...row });
  }

  save(): void {
    this.store.writeJsonl("review/block_progress.jsonl", this.blockProgress);
    this.store.writeJsonl("review/review_items.jsonl", this.reviewItems);
    this.store.writeJsonl("review/open_questions.jsonl", this.openQuestions);
  }
}

export class WorkRunStore {
  private readonly store: FileStore;
  private readonly now: string;
  private readonly runs: Rec[] = [];

  constructor(store: FileStore, now: string) {
    this.store = store;
    this.now = now;
  }

  createWorkRun(row: Rec): void {
    this.runs.push({ ...row, created_at: this.now });
  }

  save(): void {
    this.store.writeJsonl("reports/work_runs.jsonl", this.runs);
  }
}
