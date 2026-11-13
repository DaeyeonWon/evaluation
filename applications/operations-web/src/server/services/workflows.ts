import type { NextRequest } from "next/server";
import { DAG_TEMPLATE, LANG_CODES, PIPELINE_VERSIONS, STAGES, STATES, TERMINAL_STATES } from "@/lib/catalog";
import type {
  AttemptHistory,
  WorkflowPipelineRuns,
  LangCode,
  LogPage,
  Severity,
  StageId,
  Workflow,
  WorkflowDag,
  WorkflowListResponse,
  WorkflowStatus,
} from "@/lib/types";
import { Query, badRequest, conflict, notFound, paginate } from "../http";
import type { LogFilter, WorkflowFilter } from "../mock/engine-types";
import { getEngine } from "../mock/runtime";
import { countBy, toSummary, wfOverlaps } from "../mock/projections";
import { readRange } from "../range";

export const SEVERITIES: Severity[] = ["DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"];
const SORTS = ["created_desc", "created_asc", "wait_desc", "run_desc", "updated_desc", "attempts_desc"] as const;

export function getWorkflowOr404(id: string): Workflow {
  const w = getEngine().getWorkflow(id);
  if (!w) throw notFound({ key: "domain.workflowNotFound", vars: { id } });
  return w;
}

export function listWorkflows(req: NextRequest): WorkflowListResponse {
  const e = getEngine();
  const q = Query.of(req);
  const sort = q.enumOne("sort", SORTS, "created_desc")!;
  const f: WorkflowFilter = {
    language: q.enumList("language", LANG_CODES, "language"),
    status: q.enumList("status", STATES, "status"),
    pipeline_version: q.enumList("version", PIPELINE_VERSIONS, "version") ?? q.enumList("pipeline_version", PIPELINE_VERSIONS, "pipeline_version"),
    pipeline_id: q.list("pipeline_id") ?? q.list("pipeline"),
    model_version: q.list("model_version") ?? q.list("model"),
    stage: q.enumOne("stage", STAGES.map((s) => s.id) as StageId[]),
    event_type: q.str("event_type"),
    batch_id: q.str("batch_id"),
    error_code: q.str("error_code"),
    error_category: q.str("error_category"),
    hasRetries: q.bool("has_retries") || undefined,
    replay: q.bool("replay") || undefined,
    q: q.str("q"),
    sort: sort === "attempts_desc" ? "created_desc" : sort,
  };
  const range = readRange(req);
  const rangeBy = q.enumOne("range_by", ["active", "created", "updated"] as const, "active")!;
  let rows = e.listWorkflows(f).filter((w) =>
    rangeBy === "created" ? w.created_at >= range.from && w.created_at <= range.to : rangeBy === "updated" ? w.updated_at >= range.from && w.updated_at <= range.to : wfOverlaps(w, range),
  );
  const wid = q.str("workflow_id");
  if (wid) rows = rows.filter((w) => w.workflow_id === wid || w.workflow_id.includes(wid));
  const pj = q.str("pipeline_job_id");
  if (pj) rows = rows.filter((w) => w.attempts.some((a) => a.pipeline_job_id === pj || a.pipeline_job_id.includes(pj)));
  if (q.bool("active")) rows = rows.filter((w) => !TERMINAL_STATES.includes(w.status));
  if (sort === "attempts_desc") rows = [...rows].sort((a, b) => b.attempts.length - a.attempts.length || b.created_at - a.created_at);
  const { page, pageSize } = q.page(50, 500);
  const p = paginate(rows, page, pageSize);
  return {
    ...p,
    items: p.items.map(toSummary),
    facets: {
      status: countBy(rows, (w) => w.status) as Partial<Record<WorkflowStatus, number>>,
      language: countBy(rows, (w) => w.language) as Partial<Record<LangCode, number>>,
      version: countBy(rows, (w) => w.pipeline_version),
      pipeline_id: countBy(rows, (w) => w.pipeline_id),
      model_version: countBy(rows, (w) => w.model_version),
    },
    range,
  };
}

export function workflowLogs(id: string, req: NextRequest): LogPage {
  const e = getEngine();
  getWorkflowOr404(id);
  const q = Query.of(req);
  const f: LogFilter = {
    severity: q.enumList("severity", SEVERITIES),
    minSeverity: q.enumOne("min_severity", SEVERITIES),
    component: q.list("component"),
    service: q.list("service"),
    attempt: q.int("attempt", { min: 1, max: 10 }),
    event_type: q.str("event_type"),
    trace_id: q.str("trace_id"),
    pipeline_job_id: q.str("pipeline_job_id"),
    job_scope: q.enumOne("job_scope", ["self", "tree"] as const, "tree"),
    node_path: q.str("node_path"),
    error_code: q.str("error_code"),
    from: q.time("from"),
    to: q.time("to"),
    q: q.str("q"),
    order: q.enumOne("order", ["asc", "desc"] as const, "asc"),
  };
  const all = e.getLogs(id, {});
  const items = e.getLogs(id, f);
  const limit = q.int("limit", { min: 1, max: 5000 });
  return {
    items: limit ? items.slice(0, limit) : items,
    total: items.length,
    components: [...new Set(all.map((l) => l.component))],
    services: [...new Set(all.map((l) => l.service))],
  };
}

export function globalLogs(req: NextRequest): LogPage {
  const e = getEngine();
  const q = Query.of(req);
  const f: LogFilter = {
    workflow_id: q.str("workflow_id"),
    system: q.bool("system"),
    severity: q.enumList("severity", SEVERITIES),
    minSeverity: q.enumOne("min_severity", SEVERITIES),
    component: q.list("component"),
    service: q.list("service"),
    language: q.enumOne("language", LANG_CODES),
    trace_id: q.str("trace_id"),
    pipeline_job_id: q.str("pipeline_job_id"),
    job_scope: q.enumOne("job_scope", ["self", "tree"] as const, "tree"),
    pipeline_id: q.str("pipeline_id"),
    node_path: q.str("node_path"),
    error_code: q.str("error_code"),
    event_type: q.str("event_type"),
    q: q.str("q"),
    order: q.enumOne("order", ["asc", "desc"] as const, "desc"),
  };
  const range = readRange(req);
  f.from = range.from;
  f.to = Math.min(range.to, e.now());
  const items = e.logs.query(f);
  const limit = q.int("limit", { min: 1, max: 5000, def: 200 })!;
  const src = f.system ? e.logs.system : e.logs.all;
  return {
    items: items.slice(0, limit),
    total: items.length,
    components: [...new Set(src.slice(-2000).map((l) => l.component))],
    services: [...new Set(src.slice(-2000).map((l) => l.service))],
    range,
  };
}

export function workflowAttempts(id: string): AttemptHistory {
  const e = getEngine();
  const w = getWorkflowOr404(id);
  // walk to the original, then forward through replayed_by
  let root = w;
  const seen = new Set<string>();
  while (root.replay_of && !seen.has(root.workflow_id)) {
    seen.add(root.workflow_id);
    const prev = e.getWorkflow(root.replay_of);
    if (!prev) break;
    root = prev;
  }
  const chain: Workflow[] = [root];
  let cur: Workflow | null = root;
  while (cur && cur.replayed_by && chain.length < 20) {
    cur = e.getWorkflow(cur.replayed_by);
    if (cur) chain.push(cur);
  }
  const ids = new Set(chain.map((c) => c.workflow_id));
  return {
    workflow_id: w.workflow_id,
    attempts: w.attempts,
    retryPolicy: e.config.retry,
    replayChain: chain.map(toSummary),
    replays: e.replays.filter((r) => ids.has(r.original_workflow_id) || (r.replay_workflow_id != null && ids.has(r.replay_workflow_id))),
  };
}

export function workflowDag(id: string): WorkflowDag {
  const w = getWorkflowOr404(id);
  const last = w.attempts[w.attempts.length - 1];
  return {
    workflow_id: w.workflow_id,
    attempt: last ? last.attempt : null,
    pipeline_job_id: last ? last.pipeline_job_id : null,
    nodes: w.dag,
    edges: DAG_TEMPLATE.flatMap((n) => n.deps.map((d) => ({ from: d, to: n.id }))),
    current_node: w.current_node,
    attempts: w.attempts.map((a) => ({ attempt: a.attempt, pipeline_job_id: a.pipeline_job_id, status: a.status, nodes: a.dag })),
  };
}

export function cancelWorkflow(id: string, operatorId: string, reason: string) {
  const e = getEngine();
  const w = getWorkflowOr404(id);
  if (TERMINAL_STATES.includes(w.status)) throw conflict({ key: "domain.workflowTerminal", vars: { status: w.status } });
  if (w.status === "RETRY_WAIT" || w.status === "DISPATCHING") {
    // the prototype supports cancel for every non-terminal state; nothing extra to validate
  }
  const res = e.actions.cancelWorkflow(id, { operator: operatorId, reason });
  if (!res) throw badRequest({ key: "domain.workflowCancelFailed" });
  return toSummary(res);
}

/** GET /workflows/[id]/pipeline-runs — root + child job tree for every attempt. */
export function workflowPipelineRuns(id: string): WorkflowPipelineRuns {
  const e = getEngine();
  const w = getWorkflowOr404(id);
  const now = e.now();
  return {
    workflow_id: w.workflow_id,
    pipeline_id: w.pipeline_id,
    pipeline_version: w.pipeline_version,
    attempts: w.attempts.map((a) => ({ attempt: a.attempt, status: a.status, root: e.pipelines.jobTree(w, a, now) })),
  };
}
