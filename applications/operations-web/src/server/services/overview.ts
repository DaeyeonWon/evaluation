import type { NextRequest } from "next/server";
import { FAILURE_CATEGORY_META, LANG_CODES, STATES } from "@/lib/catalog";
import type { FailureCategory, LangCode, Overview, RangeKpis, WorkflowStatus } from "@/lib/types";
import { getEngine } from "../mock/runtime";
import { avg, pctl, round4, wfOverlaps } from "../mock/projections";
import { readRange } from "../range";

/** GET /overview?range= — live "today" KPIs (legacy fields) + `inRange` KPIs for the requested range. */
export function overview(req: NextRequest): Overview {
  const e = getEngine();
  const range = readRange(req);
  const base = e.overview();
  const inR = (t: number | null | undefined) => t != null && t >= range.from && t <= range.to;
  const ws = e.workflows.filter((w) => wfOverlaps(w, range));
  const created = e.workflows.filter((w) => inR(w.created_at));
  const done = e.workflows.filter((w) => inR(w.completed_at));
  const succ = done.filter((w) => w.status === "SUCCEEDED");
  const dl = done.filter((w) => w.status === "DEAD_LETTERED");
  const to = done.filter((w) => w.status === "TIMED_OUT");
  const failed = dl.length + to.length;
  const runs = succ.map((w) => w.attempts[w.attempts.length - 1].duration_ms ?? 0);
  const errs = Object.fromEntries(Object.keys(FAILURE_CATEGORY_META).map((c) => [c, 0])) as Record<FailureCategory, number>;
  let retries = 0;
  for (const w of e.workflows)
    for (const a of w.attempts) {
      if (a.error_category && inR(a.completed_at)) errs[a.error_category]++;
      if (a.attempt > 1 && inR(a.created_at)) retries++;
    }
  const statusDistribution = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<WorkflowStatus, number>;
  for (const w of ws) statusDistribution[w.status]++;
  const rows = e.results.rowsInRange(range.from, range.to);
  let pass = 0;
  for (const r of rows) if (r.result === "PASS") pass++;
  const byLanguage: RangeKpis["byLanguage"] = {};
  for (const l of LANG_CODES) {
    const s = succ.filter((w) => w.language === l).length;
    const f = done.filter((w) => w.language === l && (w.status === "DEAD_LETTERED" || w.status === "TIMED_OUT")).length;
    byLanguage[l as LangCode] = { created: created.filter((w) => w.language === l).length, succeeded: s, failed: f, successRate: s + f ? round4(s / (s + f)) : null };
  }
  const byPipeline: RangeKpis["byPipeline"] = {};
  for (const w of ws) {
    const b = (byPipeline[w.pipeline_id] ||= { runs: 0, succeeded: 0, failed: 0, running: 0, successRate: null });
    b.runs++;
    if (w.status === "SUCCEEDED") b.succeeded++;
    if (w.status === "DEAD_LETTERED" || w.status === "TIMED_OUT") b.failed++;
    if (w.status === "RUNNING") b.running++;
  }
  for (const b of Object.values(byPipeline)) b.successRate = b.succeeded + b.failed ? round4(b.succeeded / (b.succeeded + b.failed)) : null;
  const inRange: RangeKpis = {
    workflows: ws.length,
    created: created.length,
    completed: done.length,
    succeeded: succ.length,
    failed,
    deadLettered: dl.length,
    timedOut: to.length,
    cancelled: done.filter((w) => w.status === "CANCELLED").length,
    successRate: succ.length + failed ? round4(succ.length / (succ.length + failed)) : null,
    retries,
    retryRate: created.length ? round4(created.filter((w) => w.attempts.length > 1).length / created.length) : null,
    avgProcessingMs: Math.round(avg(runs)),
    p95ProcessingMs: pctl(runs, 0.95),
    avgWaitMs: Math.round(avg(succ.map((w) => w.waitMs ?? 0))),
    utterancesEvaluated: rows.length,
    utterancePassRate: rows.length ? round4(pass / rows.length) : null,
    errorDistribution: errs,
    statusDistribution,
    byLanguage,
    byPipeline,
    dlqCreated: e.dlq.filter((d) => inR(d.created_at)).length,
    alertsOpened: e.alerts.filter((a) => inR(a.opened_at)).length,
  };
  return { ...base, range, inRange };
}
