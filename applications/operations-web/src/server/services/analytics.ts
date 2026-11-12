import type { NextRequest } from "next/server";
import { FAILURE_CATEGORY_META, LANG_CODES } from "@/lib/catalog";
import type {
  AnalyticsSummary,
  CostAnalytics,
  ErrorAnalytics,
  FailureCategory,
  LangCode,
  QualitySeries,
  ThroughputSeries,
} from "@/lib/types";
import { Query } from "../http";
import { getEngine } from "../mock/runtime";

const RANGES = ["6h", "12h", "24h", "48h", "7d"] as const;
const HOURS: Record<(typeof RANGES)[number], number> = { "6h": 6, "12h": 12, "24h": 24, "48h": 48, "7d": 168 };

function sliceLast<T>(arr: T[], n: number) {
  return arr.slice(Math.max(0, arr.length - n));
}

export function throughput(req: NextRequest): ThroughputSeries {
  const e = getEngine();
  const q = Query.of(req);
  const gran = q.enumOne("granularity", ["hour", "5m"] as const, "hour")!;
  if (gran === "5m") {
    const f = e.metrics.fiveMin;
    const total = f.ts.map((_, i) => LANG_CODES.reduce((s, l) => s + f.utterances[l][i], 0));
    return {
      granularity: "5m",
      ts: [...f.ts],
      byLanguage: Object.fromEntries(LANG_CODES.map((l) => [l, [...f.completed[l]]])) as Record<LangCode, number[]>,
      utterances: Object.fromEntries(LANG_CODES.map((l) => [l, [...f.utterances[l]]])) as Record<LangCode, number[]>,
      total,
      queueDepth: Object.fromEntries(LANG_CODES.map((l) => [l, [...f.queue[l]]])) as Record<LangCode, number[]>,
      active: Object.fromEntries(LANG_CODES.map((l) => [l, [...f.active[l]]])) as Record<LangCode, number[]>,
    };
  }
  const n = HOURS[q.enumOne("range", RANGES, "7d")!];
  const h = e.metrics.hourly;
  const ts = sliceLast(h.ts, n);
  const byLanguage = Object.fromEntries(LANG_CODES.map((l) => [l, sliceLast(h.throughput[l], n)])) as Record<LangCode, number[]>;
  return {
    granularity: "hour",
    ts,
    byLanguage,
    utterances: Object.fromEntries(LANG_CODES.map((l) => [l, sliceLast(h.utterances[l], n)])) as Record<LangCode, number[]>,
    total: ts.map((_, i) => LANG_CODES.reduce((s, l) => s + byLanguage[l][i], 0)),
    queueDepth: Object.fromEntries(LANG_CODES.map((l) => [l, sliceLast(h.queueDepth[l], n)])) as Record<LangCode, number[]>,
  };
}

export function quality(req: NextRequest): QualitySeries {
  const e = getEngine();
  const n = HOURS[Query.of(req).enumOne("range", RANGES, "7d")!];
  const h = e.metrics.hourly;
  return {
    ts: sliceLast(h.ts, n),
    successRate: sliceLast(h.successRate, n),
    retryRate: sliceLast(h.retryRate, n),
    avgDurationSec: sliceLast(h.avgDurationSec, n),
    p95DurationSec: sliceLast(h.p95DurationSec, n),
  };
}

export function errors(req: NextRequest): ErrorAnalytics {
  const e = getEngine();
  const q = Query.of(req);
  const n = HOURS[q.enumOne("range", RANGES, "7d")!];
  const top = q.int("top", { min: 1, max: 50, def: 20 })!;
  const h = e.metrics.hourly;
  const codes: Record<string, { code: string; category: FailureCategory; count: number; lastAt: number }> = {};
  for (const w of e.workflows)
    for (const a of w.attempts) {
      if (!a.error_code || !a.error_category) continue;
      const c = (codes[a.error_code] ||= { code: a.error_code, category: a.error_category, count: 0, lastAt: 0 });
      c.count++;
      c.lastAt = Math.max(c.lastAt, a.completed_at || 0);
    }
  return {
    top: e.metrics.errorCategories7d.map((c) => ({ ...c })),
    hourly: {
      ts: sliceLast(h.ts, n),
      byCategory: Object.fromEntries(Object.keys(FAILURE_CATEGORY_META).map((c) => [c, sliceLast(h.errors[c as FailureCategory], n)])) as Record<
        FailureCategory,
        number[]
      >,
    },
    topErrorCodes: Object.values(codes)
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
      .slice(0, top),
  };
}

export function cost(): CostAnalytics {
  const e = getEngine();
  const daily = e.metrics.daily.map((d) => ({ date: d.date, partial: d.partial, costUsd: d.costUsd }));
  const last7 = daily.slice(-7);
  const keys = ["vertex", "llmJudge", "workflows", "cloudRun", "firestore", "bigquery", "storage"] as const;
  const byComponent7d = Object.fromEntries(
    keys.map((k) => [k, Math.round(last7.reduce((s, d) => s + d.costUsd[k], 0) * 100) / 100]),
  ) as CostAnalytics["byComponent7d"];
  return { daily, total7d: Math.round(last7.reduce((s, d) => s + d.costUsd.total, 0) * 100) / 100, byComponent7d };
}

export function summary(): AnalyticsSummary {
  const e = getEngine();
  const m = e.metrics;
  return {
    hourly: m.hourly,
    fiveMin: m.fiveMin,
    daily: m.daily,
    errorCategories7d: m.errorCategories7d,
    componentDurations: m.componentDurations(),
    versionComparison: m.versionComparison(),
    languageSummary: m.languageSummary(),
  };
}
