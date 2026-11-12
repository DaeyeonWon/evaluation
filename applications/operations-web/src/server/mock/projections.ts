/**
 * Pure projections over engine state → typed, JSON-safe API payloads.
 */
import { LANG_CODES, STAGES, STATES, TERMINAL_STATES } from "@/lib/catalog";
import type {
  ActiveWorkflowPos,
  LangCode,
  RateStat,
  ResultRow,
  ResultsAggregates,
  StageId,
  TickSnapshot,
  Workflow,
  WorkflowStatus,
  WorkflowSummary,
} from "@/lib/types";
import type { MockEngine } from "./engine-types";
import type { Runtime } from "./runtime";

export function toSummary(w: Workflow): WorkflowSummary {
  const last = w.attempts[w.attempts.length - 1];
  const lastErr = [...w.attempts].reverse().find((a) => a.error_code);
  return {
    workflow_id: w.workflow_id,
    batch_id: w.batch_id,
    language: w.language,
    status: w.status,
    stage: w.stage,
    pipeline_version: w.pipeline_version,
    priority: w.priority,
    event_type: w.event_type,
    replay_cycle: w.replay_cycle,
    replay_of: w.replay_of,
    replayed_by: w.replayed_by,
    dead_letter_id: w.dead_letter_id,
    pipeline_job_id: last ? last.pipeline_job_id : null,
    input: { uri: w.input.uri, object: w.input.object, utteranceCount: w.input.utteranceCount, sizeBytes: w.input.sizeBytes },
    result: w.result
      ? { uri: w.result.uri, rows: w.result.rows, passRate: w.result.passRate, passCount: w.result.passCount, failCount: w.result.failCount }
      : null,
    attempt: w.attempt,
    attemptsCount: w.attempts.length,
    retries: Math.max(0, w.attempts.length - 1),
    current_node: w.current_node,
    progress: { ...w.progress },
    error: w.error ? { ...w.error } : null,
    lastErrorCode: lastErr ? lastErr.error_code : null,
    created_at: w.created_at,
    queued_at: w.queued_at,
    started_at: w.started_at,
    completed_at: w.completed_at,
    updated_at: w.updated_at,
    retry_at: w.retry_at,
    waitMs: w.waitMs,
    runMs: w.runMs,
    totalMs: w.totalMs,
    trace_id: w.trace_id,
  };
}

export function toActivePos(w: Workflow): ActiveWorkflowPos {
  return {
    workflow_id: w.workflow_id,
    language: w.language,
    status: w.status,
    stage: w.stage,
    pct: w.progress ? w.progress.pct : 0,
    current_node: w.current_node,
    attempt: w.attempt,
    priority: w.priority,
    replay_cycle: w.replay_cycle,
    updated_at: w.updated_at,
    queued_at: w.queued_at,
    retry_at: w.retry_at,
  };
}

/** Full workflow document, JSON-safe (drops nothing; arrays are shared refs, serialize immediately). */
export function toWorkflow(w: Workflow): Workflow {
  return w;
}

export function buildTick(rt: Runtime): TickSnapshot {
  const e = rt.engine;
  const ov = e.overview();
  const stageCounts = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
  const active: ActiveWorkflowPos[] = [];
  for (const w of e.workflows) {
    stageCounts[w.stage]++;
    if (!TERMINAL_STATES.includes(w.status)) active.push(toActivePos(w));
  }
  const { capacity, statusDistribution, ...kpis } = ov;
  const now = e.now();
  return {
    tick: rt.tickNo,
    now,
    nowIso: e._internal.isoKst(now),
    speed: rt.speed,
    running: !rt.paused,
    counts: statusDistribution,
    stageCounts,
    kpis,
    capacity,
    active,
    totalWorkflows: e.workflows.length,
    dlqTotal: e.dlq.length,
    auditCount: e.audit.length,
  };
}

export function statusCounts(ws: Workflow[]): Record<WorkflowStatus, number> {
  const o = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<WorkflowStatus, number>;
  for (const w of ws) o[w.status]++;
  return o;
}

export function countBy<T>(arr: T[], fn: (x: T) => string | null | undefined): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of arr) {
    const k = fn(x);
    if (k == null) continue;
    o[k] = (o[k] || 0) + 1;
  }
  return o;
}

// ───────────────────────────────────────── results ──
function rate(rows: ResultRow[]): RateStat {
  let p = 0;
  for (const r of rows) if (r.result === "PASS") p++;
  return { total: rows.length, pass: p, fail: rows.length - p, passRate: rows.length ? Math.round((p / rows.length) * 10000) / 10000 : null };
}

function groupRate(rows: ResultRow[], key: (r: ResultRow) => string): Record<string, RateStat> {
  const g: Record<string, ResultRow[]> = {};
  for (const r of rows) (g[key(r)] ||= []).push(r);
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, rate(v)]));
}

export function resultsAggregates(e: MockEngine, rows: ResultRow[]): ResultsAggregates {
  const base = e.results.summary(rows);
  const capsuleLanguage: ResultsAggregates["capsuleLanguage"] = {};
  const byCap: Record<string, ResultRow[]> = {};
  for (const r of rows) (byCap[r.capsule_id] ||= []).push(r);
  for (const [cap, rs] of Object.entries(byCap)) {
    const byLang = groupRate(rs, (r) => r.language);
    capsuleLanguage[cap] = Object.fromEntries(LANG_CODES.filter((l) => byLang[l]).map((l) => [l, byLang[l]])) as Partial<
      Record<LangCode, RateStat>
    >;
  }
  const judgeScoreHistogram = new Array(10).fill(0);
  const latencyHistogram = new Array(13).fill(0);
  for (const r of rows) {
    judgeScoreHistogram[Math.min(9, Math.floor(r.judge_score * 10))]++;
    latencyHistogram[Math.min(12, Math.floor(r.latency_ms / 1000))]++;
  }
  // prototype bins (designs/a-flowline.html): 0.5s up to 3s, then 3–4, 4–6, 6–8, 8s+
  const fineEdges = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 8000];
  const fineCounts = new Array(fineEdges.length).fill(0);
  for (const r of rows) {
    let i = fineEdges.length - 1;
    while (i > 0 && r.latency_ms < fineEdges[i]) i--;
    fineCounts[i]++;
  }
  return {
    ...base,
    byIntent: groupRate(rows, (r) => r.intent_expected),
    byDate: groupRate(rows, (r) => (r.eval_ts ? e._internal.kstDate(r.eval_ts) : "-")),
    byHour: groupRate(rows, (r) => (r.eval_timestamp ? r.eval_timestamp.slice(11, 13) : "-")),
    capsuleLanguage,
    judgeScoreHistogram,
    latencyHistogram,
    latencyHistogramFine: { edgesMs: fineEdges, counts: fineCounts },
  };
}
