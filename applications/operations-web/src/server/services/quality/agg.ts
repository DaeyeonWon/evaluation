/**
 * Quality dashboard — aggregation primitives (server-only): window scoping, tallies, rate stats, time
 * buckets, percentiles, histograms. Plain GROUP BY / window maths; no scoring, no baselines beyond the
 * previous equal-length window.
 */
import type { NextRequest } from "next/server";
import { isoKst, kstDayStart } from "@/lib/time-range";
import type { QualityDim, QualityStat, QualityTrend, QualityValueStat, QualityWindow, ResolvedRange, ResultRow } from "@/lib/types";
import { Query } from "../../http";
import { getEngine } from "../../mock/runtime";
import { readRange } from "../../range";
import { DIM_GET, FAILURE_REASONS, rowFilter } from "./dims";

const HOUR = 3600e3;
const DAY = 24 * HOUR;

export interface Scope {
  q: Query;
  range: ResolvedRange;
  previous: QualityWindow;
  /** rows in the range, after the row-dim filters */
  cur: ResultRow[];
  /** rows in the previous equal-length window [from − span, from), same filters */
  prev: ResultRow[];
}

/** Resolve ?range= (localized 400 on bad input), the previous equal window, and filter both windows' rows. */
export function scope(req: NextRequest, opts: { omit?: string[] } = {}): Scope {
  const e = getEngine();
  const q = Query.of(req);
  const range = readRange(req);
  const span = Math.max(1, range.to - range.from);
  const pFrom = range.from - span;
  const pTo = range.from - 1;
  let fq = q;
  if (opts.omit?.length) {
    const sp = new URLSearchParams(req.nextUrl.searchParams);
    for (const k of opts.omit) sp.delete(k);
    fq = new Query(sp);
  }
  const pred = rowFilter(fq);
  const cur = e.results.rowsInRange(range.from, range.to).filter(pred);
  const prev = e.results.rowsInRange(pFrom, pTo).filter(pred);
  return {
    q,
    range,
    previous: {
      from: pFrom,
      to: pTo,
      fromIso: isoKst(pFrom),
      toIso: isoKst(pTo),
    },
    cur,
    prev,
  };
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const pct = (part: number, whole: number) => (whole ? r2((part / whole) * 100) : null);

export interface Cnt {
  t: number;
  f: number;
}

/**
 * (value, counted-as-FAIL) contributions of one row to a dim. failure_reason is special: PASS rows carry no
 * code, so a row contributes to EVERY code's denominator and is a FAIL only for its own code — a code's
 * "pass rate" is then 100 − (rows failing with that code / all rows in scope).
 */
export function contrib(r: ResultRow, d: QualityDim): [string, boolean][] {
  if (d === "failure_reason") return FAILURE_REASONS.map((c) => [c, r.failure_reason === c]);
  return [[DIM_GET[d](r), r.result === "FAIL"]];
}

export function tally(rows: ResultRow[], d: QualityDim): Map<string, Cnt> {
  const m = new Map<string, Cnt>();
  for (const r of rows)
    for (const [v, fail] of contrib(r, d)) {
      let c = m.get(v);
      if (!c) m.set(v, (c = { t: 0, f: 0 }));
      c.t++;
      if (fail) c.f++;
    }
  return m;
}

export function totalOf(rows: ResultRow[]): Cnt {
  let f = 0;
  for (const r of rows) if (r.result === "FAIL") f++;
  return { t: rows.length, f };
}

export function stat(c: Cnt | undefined, p: Cnt | undefined): QualityStat {
  const t = c?.t ?? 0;
  const f = c?.f ?? 0;
  const pt = p?.t ?? 0;
  const pf = p?.f ?? 0;
  const rate = pct(t - f, t);
  const prate = pct(pt - pf, pt);
  return {
    total: t,
    pass: t - f,
    fail: f,
    pass_rate: rate,
    prev_total: pt,
    prev_fail: pf,
    prev_pass_rate: prate,
    delta_pp: rate != null && prate != null ? r2(rate - prate) : null,
    fail_delta: f - pf,
  };
}

export function valueStat(value: string, c: Cnt | undefined, p: Cnt | undefined, allFails: number): QualityValueStat {
  return { value, ...stat(c, p), share: pct(c?.f ?? 0, allFails) ?? 0 };
}

/** values present in either window (failure_reason: every code) in natural order, else by FAIL count then volume */
export function orderedValues(cur: Map<string, Cnt>, prev: Map<string, Cnt>, natural: string[] | null, keep: string[] = []): string[] {
  const seen = new Set<string>([...cur.keys(), ...prev.keys(), ...keep]);
  seen.delete("");
  if (natural) return [...natural.filter((v) => seen.has(v)), ...[...seen].filter((v) => !natural.includes(v)).sort()];
  return [...seen].sort((a, b) => (cur.get(b)?.f ?? 0) - (cur.get(a)?.f ?? 0) || (cur.get(b)?.t ?? 0) - (cur.get(a)?.t ?? 0) || (a < b ? -1 : 1));
}

// ───────────────────────────────────────── time buckets ──
/** hourly up to 48 h, else KST days */
export function buckets(range: ResolvedRange): QualityTrend & { index: (ts: number) => number } {
  const span = range.to - range.from;
  const bucket: "hour" | "day" = span <= 48 * HOUR ? "hour" : "day";
  const step = bucket === "hour" ? HOUR : DAY;
  const start = bucket === "hour" ? Math.floor(range.from / HOUR) * HOUR : kstDayStart(range.from);
  const t: number[] = [];
  for (let x = start; x <= range.to; x += step) t.push(x);
  const n = t.length;
  return {
    bucket,
    t,
    index: (ts) => Math.min(n - 1, Math.max(0, Math.floor((ts - start) / step))),
  };
}

// ───────────────────────────────────────── distributions ──
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function latencyStats(rows: ResultRow[]) {
  const l = rows.map((r) => r.latency_ms).sort((a, b) => a - b);
  return { p50: percentile(l, 50), p95: percentile(l, 95) };
}

export function avgScore(rows: ResultRow[]): number | null {
  if (!rows.length) return null;
  let s = 0;
  for (const r of rows) s += r.judge_score;
  return Math.round((s / rows.length) * 1000) / 1000;
}

/** PASS / FAIL counts per bucket; a value ≥ the last edge falls in the last bucket */
export function histogram(rows: ResultRow[], edges: number[], get: (r: ResultRow) => number) {
  const pass = edges.map(() => 0);
  const fail = edges.map(() => 0);
  for (const r of rows) {
    const v = get(r);
    let i = edges.length - 1;
    while (i > 0 && v < edges[i]) i--;
    (r.result === "FAIL" ? fail : pass)[i]++;
  }
  return { edges, pass, fail };
}

/** keep the first `max` values, fold the rest into "__other__" (returns the value → axis-key mapper) */
export const OTHER = "__other__";
export function fold(values: string[], max: number, foldable: boolean): { values: string[]; key: (v: string) => string | null; folded: number } {
  if (!foldable || values.length <= max) {
    const s = new Set(values);
    return { values, key: (v) => (s.has(v) ? v : null), folded: 0 };
  }
  const head = values.slice(0, max - 1);
  const s = new Set(head);
  return {
    values: [...head, OTHER],
    key: (v) => (v === "" ? null : s.has(v) ? v : OTHER),
    folded: values.length - head.length,
  };
}
