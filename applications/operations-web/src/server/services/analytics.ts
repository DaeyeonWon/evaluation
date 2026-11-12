import type { NextRequest } from "next/server";
import { FAILURE_CATEGORY_META, LANG_CODES } from "@/lib/catalog";
import type {
  AnalyticsSummary,
  CapacityHistory,
  ComponentDuration,
  CostAnalytics,
  DailyMetrics,
  DurationStat,
  ErrorAnalytics,
  ErrorCategoryCount,
  FailureCategory,
  FiveMinMetrics,
  HourlyMetrics,
  LangCode,
  LanguageSummary,
  QualitySeries,
  RangedList,
  RateStat,
  ResolvedRange,
  ResultRow,
  ThroughputSeries,
  VersionComparison,
  Workflow,
} from "@/lib/types";
import { Query } from "../http";
import { getEngine } from "../mock/runtime";
import { avg, pctl, round4, wfOverlaps } from "../mock/projections";
import { rangedList, readRange } from "../range";
import { pipelineSummaries } from "./pipelines";

const HOUR = 3_600_000;
const FIVE = 300_000;
const DAY = 86_400_000;
const CATS = Object.keys(FAILURE_CATEGORY_META) as FailureCategory[];

/** indices of buckets [ts, ts+width) that overlap the range */
function idx(ts: number[], width: number, r: ResolvedRange): number[] {
  const out: number[] = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] + width > r.from && ts[i] <= r.to) out.push(i);
  return out;
}
const pick = <T,>(arr: T[], ix: number[]) => ix.map((i) => arr[i]);
const pickLang = (o: Record<LangCode, number[]>, ix: number[]) => Object.fromEntries(LANG_CODES.map((l) => [l, pick(o[l], ix)])) as Record<LangCode, number[]>;

export function sliceHourly(h: HourlyMetrics & { active?: Record<LangCode, number[]> }, r: ResolvedRange): HourlyMetrics & { active?: Record<LangCode, number[]> } {
  const ix = idx(h.ts, HOUR, r);
  return {
    ts: pick(h.ts, ix),
    throughput: pickLang(h.throughput, ix),
    utterances: pickLang(h.utterances, ix),
    queueDepth: pickLang(h.queueDepth, ix),
    ...(h.active ? { active: pickLang(h.active, ix) } : {}),
    successRate: pick(h.successRate, ix),
    retryRate: pick(h.retryRate, ix),
    avgDurationSec: pick(h.avgDurationSec, ix),
    p95DurationSec: pick(h.p95DurationSec, ix),
    errors: Object.fromEntries(CATS.map((c) => [c, pick(h.errors[c], ix)])) as Record<FailureCategory, number[]>,
  };
}
export function sliceFive(f: FiveMinMetrics, r: ResolvedRange): FiveMinMetrics {
  const ix = idx(f.ts, FIVE, r);
  return {
    ts: pick(f.ts, ix),
    utterances: pickLang(f.utterances, ix),
    completed: pickLang(f.completed, ix),
    active: pickLang(f.active, ix),
    queue: pickLang(f.queue, ix),
    successRate: pick(f.successRate, ix),
    passRate: pick(f.passRate, ix),
  };
}
function dayOverlaps(date: string, r: ResolvedRange): boolean {
  const start = Date.parse(date + "T00:00:00+09:00");
  return start <= r.to && start + DAY > r.from;
}
export function sliceDaily(d: DailyMetrics[], r: ResolvedRange): DailyMetrics[] {
  return d.filter((x) => dayOverlaps(x.date, r));
}

/** granularity choice: explicit param, else 5m for spans ≤ 26h when 5m data covers the range */
function chooseGranularity(q: Query, r: ResolvedRange, fiveStart: number): "5m" | "hour" {
  const g = q.enumOne("granularity", ["hour", "1h", "5m", "auto"] as const, "auto")!;
  if (g === "hour" || g === "1h") return "hour";
  const fits = r.from >= fiveStart - FIVE;
  if (g === "5m") return fits ? "5m" : "hour";
  return r.to - r.from <= 26 * HOUR && fits ? "5m" : "hour";
}

export function throughput(req: NextRequest): ThroughputSeries {
  const e = getEngine();
  const q = Query.of(req);
  const range = readRange(req);
  const gran = chooseGranularity(q, range, e.metrics.fiveMin.ts[0]);
  if (gran === "5m") {
    const f = sliceFive(e.metrics.fiveMin, range);
    return {
      granularity: "5m",
      ts: f.ts,
      byLanguage: f.completed,
      utterances: f.utterances,
      total: f.ts.map((_, i) => LANG_CODES.reduce((s, l) => s + f.utterances[l][i], 0)),
      queueDepth: f.queue,
      active: f.active,
      range,
    };
  }
  const h = sliceHourly(e.metrics.hourly, range);
  return {
    granularity: "hour",
    ts: h.ts,
    byLanguage: h.throughput,
    utterances: h.utterances,
    total: h.ts.map((_, i) => LANG_CODES.reduce((s, l) => s + h.throughput[l][i], 0)),
    queueDepth: h.queueDepth,
    active: h.active,
    range,
  };
}

export function quality(req: NextRequest): QualitySeries {
  const range = readRange(req);
  const h = sliceHourly(getEngine().metrics.hourly, range);
  return { ts: h.ts, successRate: h.successRate, retryRate: h.retryRate, avgDurationSec: h.avgDurationSec, p95DurationSec: h.p95DurationSec, range };
}

function errorTop(h: HourlyMetrics): ErrorCategoryCount[] {
  return CATS.map((c) => ({ category: c, label: FAILURE_CATEGORY_META[c].label, count: h.errors[c].reduce((s, x) => s + x, 0) })).sort((a, b) => b.count - a.count);
}

export function errors(req: NextRequest): ErrorAnalytics {
  const e = getEngine();
  const q = Query.of(req);
  const range = readRange(req);
  const top = q.int("top", { min: 1, max: 50, def: 20 })!;
  const h = sliceHourly(e.metrics.hourly, range);
  const codes: Record<string, { code: string; category: FailureCategory; count: number; lastAt: number; paths: Record<string, number> }> = {};
  for (const w of e.workflows)
    for (const a of w.attempts) {
      if (!a.error_code || !a.error_category || a.completed_at == null || a.completed_at < range.from || a.completed_at > range.to) continue;
      const c = (codes[a.error_code] ||= { code: a.error_code, category: a.error_category, count: 0, lastAt: 0, paths: {} });
      c.count++;
      c.lastAt = Math.max(c.lastAt, a.completed_at || 0);
      if (a.failed_path) c.paths[a.failed_path] = (c.paths[a.failed_path] || 0) + 1;
    }
  return {
    top: errorTop(h),
    hourly: { ts: h.ts, byCategory: h.errors },
    topErrorCodes: Object.values(codes)
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
      .slice(0, top),
    range,
  };
}

function stat(a: number[]): DurationStat {
  return { avgSec: Math.round(avg(a) / 1000), p95Sec: Math.round(pctl(a, 0.95) / 1000), n: a.length };
}

/** Attempts that SUCCEEDED and completed within the range. */
function succeededAttempts(r: ResolvedRange) {
  const out: { w: Workflow; a: Workflow["attempts"][number] }[] = [];
  for (const w of getEngine().workflows)
    for (const a of w.attempts) if (a.status === "SUCCEEDED" && a.completed_at != null && a.completed_at >= r.from && a.completed_at <= r.to) out.push({ w, a });
  return out;
}

/** Per leaf component (all pipelines, incl. sub-pipelines): avg/p95 duration of succeeded attempts. */
export function componentDurations(r: ResolvedRange): ComponentDuration[] {
  const e = getEngine();
  const comps = e.pipelines.components;
  const acc: Record<string, { all: number[]; byL: Record<string, number[]>; byV: Record<string, number[]>; byP: Record<string, number[]> }> = {};
  for (const { w, a } of succeededAttempts(r)) {
    const plan = e.pipelines.plan(a.pipeline_job_id);
    if (!plan) continue;
    for (const leaf of plan.leaves) {
      const d = plan.durationMs * (leaf.e - leaf.s);
      const c = (acc[leaf.component!] ||= { all: [], byL: {}, byV: {}, byP: {} });
      c.all.push(d);
      (c.byL[w.language] ||= []).push(d);
      (c.byV[a.pipeline_version] ||= []).push(d);
      (c.byP[w.pipeline_id] ||= []).push(d);
    }
  }
  return Object.keys(comps)
    .filter((id) => acc[id])
    .map((id) => {
      const c = acc[id];
      const m = (o: Record<string, number[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, stat(v)]));
      return { component: id, label: comps[id].label, labelKo: comps[id].labelKo, byLanguage: m(c.byL), byVersion: m(c.byV), byPipeline: m(c.byP), ...stat(c.all) } as ComponentDuration;
    });
}

function rate(rows: ResultRow[]): RateStat {
  let p = 0;
  for (const r of rows) if (r.result === "PASS") p++;
  return { total: rows.length, pass: p, fail: rows.length - p, passRate: rows.length ? round4(p / rows.length) : null };
}

const TERMINAL_NC = ["SUCCEEDED", "DEAD_LETTERED", "TIMED_OUT"];

export function versionComparison(r: ResolvedRange): VersionComparison[] {
  const e = getEngine();
  const ws = e.workflows.filter((w) => wfOverlaps(w, r));
  const cost: Record<string, number> = { "v1.0": 1.38, "v1.1": 1.52, "v1.2-rc": 1.71 };
  return e._internal.PIPELINE_VERSIONS.map((v) => {
    const vw = ws.filter((w) => w.pipeline_version === v.version);
    const term = vw.filter((w) => TERMINAL_NC.includes(w.status));
    const succ = term.filter((w) => w.status === "SUCCEEDED");
    const durs = succ.map((w) => w.attempts[w.attempts.length - 1].duration_ms ?? 0);
    const rows: ResultRow[] = [];
    for (const w of succ) for (const x of e.results.rowsFor(w)) if (x.eval_ts >= r.from && x.eval_ts <= r.to) rows.push(x);
    const rs = rate(rows);
    const byCap: Record<string, ResultRow[]> = {};
    for (const x of rows) (byCap[x.capsule_id] ||= []).push(x);
    const lat = rows.map((x) => x.latency_ms);
    return {
      version: v.version,
      status: v.status,
      trafficPct: v.trafficPct,
      modelUnderTest: v.modelUnderTest,
      judgeModel: v.judgeModel,
      runs: vw.length,
      terminal: term.length,
      succeeded: succ.length,
      pipelineSuccessRate: term.length ? round4(succ.length / term.length) : null,
      retryRate: vw.length ? round4(vw.filter((w) => w.attempts.length > 1).length / vw.length) : null,
      avgDurationSec: Math.round(avg(durs) / 1000),
      p95DurationSec: Math.round(pctl(durs, 0.95) / 1000),
      utterances: rs.total,
      utterancePassRate: rs.passRate,
      byCapsule: Object.fromEntries(Object.entries(byCap).map(([k, v2]) => [k, rate(v2)])),
      avgLatencyMs: Math.round(avg(lat)),
      p95LatencyMs: pctl(lat, 0.95),
      avgJudgeScore: Math.round(avg(rows.map((x) => x.judge_score)) * 1000) / 1000,
      costPerRunUsd: cost[v.version] ?? 1.5,
    };
  });
}

export function languageSummary(r: ResolvedRange): LanguageSummary[] {
  const e = getEngine();
  const cap = e.getCapacity();
  const h = sliceHourly(e.metrics.hourly, r);
  const rows = e.results.rowsInRange(r.from, r.to);
  return e.languages.map((l, i) => {
    const ws = e.workflows.filter((w) => w.language === l.code && wfOverlaps(w, r));
    const term = ws.filter((w) => TERMINAL_NC.includes(w.status));
    const succ = term.filter((w) => w.status === "SUCCEEDED");
    const durs = succ.map((w) => w.attempts[w.attempts.length - 1].duration_ms ?? 0);
    const lr = rows.filter((x) => x.language === l.code);
    return {
      code: l.code,
      name: l.name,
      workflows: ws.length,
      succeeded: succ.length,
      successRate: term.length ? round4(succ.length / term.length) : null,
      deadLettered: ws.filter((w) => w.status === "DEAD_LETTERED").length,
      avgDurationSec: Math.round(avg(durs) / 1000),
      p95DurationSec: Math.round(pctl(durs, 0.95) / 1000),
      utterancesToday: lr.length,
      passRateToday: rate(lr).passRate,
      capacity: cap.languages[i],
      throughput7d: h.throughput[l.code].reduce((s, x) => s + x, 0),
    };
  });
}

const COST_KEYS = ["vertex", "llmJudge", "workflows", "cloudRun", "firestore", "bigquery", "storage"] as const;
export function cost(req: NextRequest): CostAnalytics {
  const range = readRange(req);
  const daily = sliceDaily(getEngine().metrics.daily, range).map((d) => ({ date: d.date, partial: d.partial, costUsd: d.costUsd }));
  const byComponent7d = Object.fromEntries(COST_KEYS.map((k) => [k, Math.round(daily.reduce((s, d) => s + d.costUsd[k], 0) * 100) / 100])) as CostAnalytics["byComponent7d"];
  return { daily, total7d: Math.round(daily.reduce((s, d) => s + d.costUsd.total, 0) * 100) / 100, byComponent7d, range };
}

export function daily(req: NextRequest): RangedList<DailyMetrics> {
  const range = readRange(req);
  return rangedList(sliceDaily(getEngine().metrics.daily, range), range);
}
export function components(req: NextRequest): RangedList<ComponentDuration> {
  const range = readRange(req);
  return rangedList(componentDurations(range), range);
}
export function versions(req: NextRequest): RangedList<VersionComparison> {
  const range = readRange(req);
  return rangedList(versionComparison(range), range);
}
export function languages(req: NextRequest): RangedList<LanguageSummary> {
  const range = readRange(req);
  return rangedList(languageSummary(range), range);
}

export function summary(req: NextRequest): AnalyticsSummary {
  const e = getEngine();
  const range = readRange(req);
  const m = e.metrics;
  const hourly = sliceHourly(m.hourly, range);
  return {
    hourly,
    fiveMin: sliceFive(m.fiveMin, range),
    daily: sliceDaily(m.daily, range),
    errorCategories7d: errorTop(hourly),
    componentDurations: componentDurations(range),
    versionComparison: versionComparison(range),
    languageSummary: languageSummary(range),
    pipelineSummary: pipelineSummaries(range),
    range,
  };
}

/** GET /capacity/history — per-language active slots & queue depth over the range. */
export function capacityHistory(req: NextRequest): CapacityHistory {
  const e = getEngine();
  const q = Query.of(req);
  const range = readRange(req);
  const f = e.metrics.fiveMin;
  const want = q.enumOne("granularity", ["auto", "5m", "1h", "6h"] as const, "auto")!;
  const span = range.to - range.from;
  const fits = range.from >= f.ts[0] - FIVE;
  let g: CapacityHistory["granularity"] = want === "auto" ? (span <= 26 * HOUR && fits ? "5m" : span <= 8 * DAY ? "1h" : "6h") : want;
  if (g === "5m" && !fits) g = "1h";
  const limit = Object.fromEntries(e.languages.map((l) => [l.code, l.maxConcurrent])) as Record<LangCode, number>;
  let ts: number[];
  let active: Record<LangCode, number[]>;
  let queue: Record<LangCode, number[]>;
  if (g === "5m") {
    const s = sliceFive(f, range);
    ts = s.ts;
    active = s.active;
    queue = s.queue;
  } else {
    const h = sliceHourly(e.metrics.hourly, range);
    ts = h.ts;
    active = h.active!;
    queue = h.queueDepth;
    if (g === "6h") {
      const groups: number[][] = [];
      ts.forEach((t, i) => {
        const k = Math.floor((t + 9 * HOUR) / (6 * HOUR));
        const last = groups[groups.length - 1];
        if (last && Math.floor((ts[last[0]] + 9 * HOUR) / (6 * HOUR)) === k) last.push(i);
        else groups.push([i]);
      });
      const agg = (arr: number[]) => groups.map((gi) => Math.round(Math.max(...gi.map((i) => arr[i]))));
      ts = groups.map((gi) => ts[gi[0]]);
      active = Object.fromEntries(LANG_CODES.map((l) => [l, agg(active[l])])) as Record<LangCode, number[]>;
      queue = Object.fromEntries(LANG_CODES.map((l) => [l, agg(queue[l])])) as Record<LangCode, number[]>;
    }
  }
  return {
    granularity: g,
    ts,
    active,
    queue,
    limit,
    globalActive: ts.map((_, i) => LANG_CODES.reduce((s, l) => s + (active[l][i] ?? 0), 0)),
    globalLimit: e.config.global.maxConcurrent,
    range,
  };
}
