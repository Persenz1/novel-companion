// 增量受控写入层：在已有 accepted/*.jsonl 之上追加，而不是从空重建。
//
// 与 src/stores.ts 的 AcceptedStore 区别：那个是批处理夹具用的"整体覆盖"模型，
// 会从空开始重写所有文件；本模块面向长驻服务器，按对象增量追加 + 即时落盘，
// 并支持三级回滚（单对象 / 单 Change / 整批 work_run）。
//
// 硬边界（docs/modules/ai-workbench.md）：
//   每次写 Accepted 必须同步生成一条 Change；自动写入标 auto_accepted + reviewer_model；
//   每条都能按 Change 或 work_run 整批撤销。
import { FileStore } from "../fileStore.js";
import { acceptedFileFor } from "../acceptedTypes.js";

type Rec = Record<string, unknown>;

export interface WriteMeta {
  operation:
    | "accept_candidate"
    | "accept_candidate_with_edit"
    | "manual_create"
    | "manual_update"
    | "merge_entities"
    | "deprecate_object";
  decidedBy: "reviewer_agent" | "user";
  autoAccepted: boolean;
  approvedBy: string; // 复核模型名 或 用户名
  reason: string;
  candidateId?: string;
  reviewerModel?: string;
  workRunId?: string;
}

export interface WriteResult {
  acceptedId: string;
  changeId: string;
  targetFile: string;
  targetType: string;
}

export class AgentStore {
  private readonly store: FileStore;
  private readonly seriesId: string;

  constructor(store: FileStore, seriesId: string) {
    this.store = store;
    this.seriesId = seriesId;
  }

  // ----- 读取 -----

  changes(): Rec[] {
    return this.store.readJsonl<Rec>("accepted/changes.jsonl").rows;
  }

  acceptedRows(file: string): Rec[] {
    return this.store.readJsonl<Rec>(file).rows;
  }

  private nextChangeId(): string {
    let max = 0;
    for (const c of this.changes()) {
      const m = String((c as { id?: string }).id ?? "").match(/(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `change_${String(max + 1).padStart(6, "0")}`;
  }

  // ----- 写入（每次都生成 Change） -----

  /** 受控写入一个 Accepted 对象 + 一条 Change，即时落盘。 */
  write(type: string, draft: Rec, meta: WriteMeta): WriteResult {
    const file = acceptedFileFor(type);
    if (!file) throw new Error(`不是 Accepted 类型：${type}`);
    const targetId = draft.id as string;
    if (!targetId) throw new Error(`${type} 草案缺少 id`);

    const now = new Date().toISOString();
    const changeId = this.nextChangeId();

    const rows = this.acceptedRows(file);
    const existingIdx = rows.findIndex((r) => (r as { id?: string }).id === targetId);
    const before = existingIdx >= 0 ? rows[existingIdx]! : null;
    const accepted = mergeAccepted(type, before, {
      ...draft,
      series_id: this.seriesId,
      status: (draft.status as string) ?? "accepted",
      created_change_id: before ? before.created_change_id : changeId,
      updated_change_ids: before ? [...(((before.updated_change_ids as string[]) ?? [])), changeId] : [],
    });
    const change: Rec = {
      id: changeId,
      series_id: this.seriesId,
      operation: meta.operation,
      target_file: file,
      target_type: type,
      target_id: targetId,
      ...(meta.candidateId ? { candidate_id: meta.candidateId } : {}),
      before: before ? { target_id: targetId } : null,
      after: { target_id: targetId },
      reason: meta.reason,
      ...(draft.source_span ? { source_span: draft.source_span } : {}),
      decided_by: meta.decidedBy,
      auto_accepted: meta.autoAccepted,
      ...(meta.reviewerModel ? { reviewer_model: meta.reviewerModel } : {}),
      ...(meta.workRunId ? { work_run_id: meta.workRunId } : {}),
      approved_by: meta.approvedBy,
      created_at: now,
    };

    // 同 id 已存在则视为更新（替换），避免重复落盘。
    if (existingIdx >= 0) rows[existingIdx] = accepted;
    else rows.push(accepted);
    this.store.writeJsonl(file, rows);

    const allChanges = this.changes();
    allChanges.push(change);
    this.store.writeJsonl("accepted/changes.jsonl", allChanges);

    return { acceptedId: targetId, changeId, targetFile: file, targetType: type };
  }

  // ----- 回滚 -----

  /** 撤销单条 Change：删掉它创建的 Accepted 对象，并移除该 Change。 */
  revertChange(changeId: string): { reverted: string[] } {
    const changes = this.changes();
    const change = changes.find((c) => (c as { id?: string }).id === changeId);
    if (!change) throw new Error(`找不到 Change：${changeId}`);

    const file = (change as { target_file?: string }).target_file;
    const targetId = (change as { target_id?: string }).target_id;
    if (file && targetId) {
      const rows = this.acceptedRows(file).filter((r) => (r as { id?: string }).id !== targetId);
      this.store.writeJsonl(file, rows);
    }
    const remaining = changes.filter((c) => (c as { id?: string }).id !== changeId);
    this.store.writeJsonl("accepted/changes.jsonl", remaining);
    return { reverted: [changeId] };
  }

  /** 整批撤销一次 work_run 产生的全部自动写入。 */
  revertWorkRun(workRunId: string): { reverted: string[] } {
    const ids = this.changes()
      .filter((c) => (c as { work_run_id?: string }).work_run_id === workRunId)
      .map((c) => (c as { id: string }).id);
    const reverted: string[] = [];
    for (const id of ids) {
      this.revertChange(id);
      reverted.push(id);
    }
    return { reverted };
  }
}

function mergeAccepted(type: string, before: Rec | null, next: Rec): Rec {
  if (!before) return next;
  const merged: Rec = { ...before, ...next };
  merged.created_change_id = before.created_change_id ?? next.created_change_id;
  merged.updated_change_ids = next.updated_change_ids;

  if (type === "entity") {
    merged.first_seen = before.first_seen ?? next.first_seen;
    merged.source_span = before.source_span ?? next.source_span;
    const aliases = new Set<string>();
    for (const alias of (before.aliases as string[]) ?? []) aliases.add(alias);
    for (const alias of (next.aliases as string[]) ?? []) aliases.add(alias);
    merged.aliases = [...aliases];
  }
  if (type === "metric") {
    for (const key of ["subject_id", "name", "metric_type", "unit", "value_type", "visible_from", "source_span"]) {
      merged[key] = before[key] ?? next[key];
    }
  }

  return merged;
}
