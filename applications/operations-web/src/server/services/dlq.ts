import type { NextRequest } from "next/server";
import { LANG_CODES, PIPELINE_VERSIONS } from "@/lib/catalog";
import type {
  BatchReplayResult,
  DeadLetter,
  DeadLetterDetail,
  DeadLetterList,
  DlqStatus,
  FailureCategory,
  LangCode,
  ReplayResult,
} from "@/lib/types";
import { Query, badRequest, conflict, notFound, paginate } from "../http";
import { getEngine } from "../mock/runtime";
import { countBy, toSummary } from "../mock/projections";
import { readRange } from "../range";

export const DLQ_STATUSES: DlqStatus[] = ["PENDING_REVIEW", "APPROVED", "REPLAYING", "REPLAYED", "CLOSED"];
export const CATEGORIES: FailureCategory[] = [
  "PIPELINE_EXECUTION",
  "MODEL_TRANSIENT",
  "QUOTA",
  "TIMEOUT",
  "INPUT_SCHEMA",
  "AUTH_PERMISSION",
  "CODE_DEFECT",
];

export function getDeadLetterOr404(id: string): DeadLetter {
  const d = getEngine().getDeadLetter(id);
  if (!d) throw notFound({ key: "domain.dlqNotFound", vars: { id } });
  return d;
}

export function listDeadLetters(req: NextRequest): DeadLetterList {
  const e = getEngine();
  const q = Query.of(req);
  const statuses = q.enumList("status", DLQ_STATUSES);
  const langs = q.enumList("language", LANG_CODES);
  const cats = q.enumList("category", CATEGORIES);
  const code = q.str("error_code");
  const op = q.str("operator");
  const text = q.str("q")?.toLowerCase();
  const range = readRange(req);
  const { from, to } = range;
  const pids = q.list("pipeline_id");
  const sort = q.enumOne("sort", ["created_desc", "created_asc", "updated_desc", "attempts_desc"] as const, "created_desc")!;
  let rows = e.dlq.filter((d) => {
    if (statuses && !statuses.includes(d.status)) return false;
    if (langs && !langs.includes(d.language)) return false;
    if (cats && !cats.includes(d.failure_category)) return false;
    if (code && d.error_code !== code) return false;
    if (op && d.assigned_operator !== op) return false;
    if (d.created_at < from || d.created_at > to) return false;
    if (pids && !pids.includes(d.pipeline_id)) return false;
    if (text) {
      const hay = [d.dead_letter_id, d.workflow_id, d.batch_id, d.error_code, d.failure_reason, d.input_uri, d.failed_path ?? "", d.pipeline_id].join(" ").toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  const sorters: Record<typeof sort, (a: DeadLetter, b: DeadLetter) => number> = {
    created_desc: (a, b) => b.created_at - a.created_at,
    created_asc: (a, b) => a.created_at - b.created_at,
    updated_desc: (a, b) => b.updated_at - a.updated_at,
    attempts_desc: (a, b) => b.attempts - a.attempts,
  };
  rows = [...rows].sort(sorters[sort]);
  const { page, pageSize } = q.page(100, 500);
  return {
    ...paginate(rows, page, pageSize),
    facets: {
      status: countBy(rows, (d) => d.status) as Partial<Record<DlqStatus, number>>,
      category: countBy(rows, (d) => d.failure_category) as Partial<Record<FailureCategory, number>>,
      language: countBy(rows, (d) => d.language) as Partial<Record<LangCode, number>>,
    },
    range,
    outsideRange: {
      pendingReview: e.dlq.filter((d) => (d.created_at < from || d.created_at > to) && d.status === "PENDING_REVIEW").length,
      approved: e.dlq.filter((d) => (d.created_at < from || d.created_at > to) && d.status === "APPROVED").length,
      replaying: e.dlq.filter((d) => (d.created_at < from || d.created_at > to) && d.status === "REPLAYING").length,
    },
  };
}

export function deadLetterDetail(id: string): DeadLetterDetail {
  const e = getEngine();
  const d = getDeadLetterOr404(id);
  const wf = e.getWorkflow(d.workflow_id);
  const replays = e.replays.filter((r) => r.dead_letter_id === d.dead_letter_id);
  const replayWorkflows = replays
    .map((r) => (r.replay_workflow_id ? e.getWorkflow(r.replay_workflow_id) : null))
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map(toSummary);
  return {
    deadLetter: d,
    workflow: wf,
    replays,
    replayWorkflows,
    events: wf ? e.getEvents(wf.workflow_id) : [],
    recentLogs: wf ? e.getLogs(wf.workflow_id, { minSeverity: "WARNING" }).slice(-30) : [],
  };
}

export function validateVersion(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (!PIPELINE_VERSIONS.includes(v)) throw badRequest({ key: "domain.unknownVersion", vars: { version: v } }, { allowed: PIPELINE_VERSIONS });
  return v;
}

export function replayOne(id: string, operatorId: string, reason: string, version?: string, priority?: number): ReplayResult {
  const e = getEngine();
  const d = getDeadLetterOr404(id);
  if (d.status === "REPLAYING") throw conflict({ key: "domain.dlqReplayInProgress", vars: { id: d.dead_letter_id } });
  if (d.status === "REPLAYED") throw conflict({ key: "domain.dlqAlreadyReplayed", vars: { id: d.dead_letter_id } });
  if (d.status === "CLOSED") throw conflict({ key: "domain.dlqClosed", vars: { id: d.dead_letter_id } });
  const r = e.actions.replayDeadLetter(d.dead_letter_id, { operator: operatorId, reason, pipelineVersion: version, priority });
  if (!r) throw conflict({ key: "domain.replayFailed" });
  return { deadLetter: r.deadLetter, replay: r.replay, workflow: toSummary(r.workflow) };
}

export function replayBatch(ids: string[], operatorId: string, reason: string, version?: string): BatchReplayResult {
  const results: BatchReplayResult["results"] = [];
  for (const id of ids) {
    try {
      const r = replayOne(id, operatorId, reason, version);
      results.push({ id, ok: true, replay: r.replay, workflow: r.workflow });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

export function closeOne(id: string, operatorId: string, resolution: string): DeadLetter {
  const e = getEngine();
  const d = getDeadLetterOr404(id);
  if (d.status === "CLOSED") throw conflict({ key: "domain.dlqAlreadyClosed", vars: { id: d.dead_letter_id } });
  if (d.status === "REPLAYING") throw conflict({ key: "domain.dlqCloseWhileReplaying", vars: { id: d.dead_letter_id } });
  const r = e.actions.closeDeadLetter(d.dead_letter_id, { operator: operatorId, resolution });
  if (!r) throw conflict({ key: "domain.closeFailed" });
  return r;
}

export function assignOne(id: string, actorId: string, assigneeId: string | null, reason: string | null): DeadLetter {
  const e = getEngine();
  const d = getDeadLetterOr404(id);
  if (assigneeId && !e._internal.OP[assigneeId]) throw badRequest({ key: "domain.unknownOperator", vars: { id: assigneeId } }, { field: "operator_id" });
  const before = d.assigned_operator;
  const r = e.actions.assignDeadLetter(d.dead_letter_id, assigneeId)!;
  const t = e.now();
  e._internal.pushAudit(e._internal.audit(t, actorId, "DLQ_ASSIGNED", d.dead_letter_id, { assigned_operator: before }, { assigned_operator: assigneeId }, reason));
  return r;
}
