/**
 * Quality dashboard service (server-only) — GET /api/v1/quality/{summary,breakdown,matrix,versions,distributions}.
 * docs/data-contract.md §9.
 *
 * NO ANALYSIS MODULE: every number is a GROUP BY / window aggregation over result-CSV rows (the engine's
 * `results.rowsInRange`, the same access GET /results uses) plus reference tables (src/config/domain.ts via
 * src/lib/catalog.ts). Δ is always "vs the previous equal-length window" — no baselines, z-scores, significance
 * tests (M2), issues (M1), scores (M3), taxonomy (M4) or judge_reason semantics. judge_reason only appears
 * verbatim on example rows. This file must not import src/server/services/issues*.ts (grep-checked).
 */
import type { NextRequest } from "next/server";
import type {
  FailureReason,
  QualityBreakdown,
  QualityBreakdownItem,
  QualityDim,
  QualityDistributions,
  QualityMatrix,
  QualityMatrixCell,
  QualityMatrixMetric,
  QualitySummary,
  QualityVersionBy,
  QualityVersionDim,
  QualityVersionGroup,
  QualityVersionRow,
  QualityVersions,
  ResultRow,
} from "@/lib/types";
import { badRequest } from "../http";
import { avgScore, buckets, contrib, fold, histogram, latencyStats, orderedValues, pct, r2, scope, stat, tally, totalOf, valueStat, type Cnt } from "./quality/agg";
import { DIM_GET, FAILURE_REASONS, QUALITY_DIMS, naturalOrder } from "./quality/dims";

export { QUALITY_DIMS };
const METRICS: QualityMatrixMetric[] = ["pass_rate", "fail_count", "delta"];
const VERSION_DIMS: QualityVersionDim[] = ["model_version", "bixby_version", "pipeline_version"];
const VERSION_BY: QualityVersionBy[] = ["division", "region", "agent_function"];
const SORTS = ["fail_count", "pass_rate", "delta", "volume", "natural"] as const;

/** stats of every value of `d` (natural order, or by FAILs) */
function byDim(cur: ResultRow[], prev: ResultRow[], d: QualityDim, allFails: number) {
  const c = tally(cur, d);
  const p = tally(prev, d);
  return orderedValues(c, p, naturalOrder(d, c.keys())).map((v) => valueStat(v, c.get(v), p.get(v), allFails));
}

// ───────────────────────────────────────── summary ──
export function qualitySummary(req: NextRequest): QualitySummary {
  const s = scope(req);
  const { cur, prev } = s;
  const all = totalOf(cur);
  const lc = latencyStats(cur);
  const lp = latencyStats(prev);
  const b = buckets(s.range);
  const tt = b.t.map(() => 0);
  const tf = b.t.map(() => 0);
  for (const r of cur) {
    const i = b.index(r.eval_ts);
    tt[i]++;
    if (r.result === "FAIL") tf[i]++;
  }
  const intents = byDim(cur, prev, "intent", all.f)
    .filter((x) => x.fail > 0)
    .slice(0, 10);
  return {
    range: s.range,
    previous: s.previous,
    kpis: {
      ...stat(all, totalOf(prev)),
      avg_judge_score: avgScore(cur),
      prev_avg_judge_score: avgScore(prev),
      latency_p50_ms: lc.p50,
      latency_p95_ms: lc.p95,
      prev_latency_p50_ms: lp.p50,
      prev_latency_p95_ms: lp.p95,
    },
    trend: {
      bucket: b.bucket,
      t: b.t,
      total: tt,
      fail: tf,
      pass_rate: tt.map((n, i) => pct(n - tf[i], n)),
    },
    by_division: byDim(cur, prev, "division", all.f),
    by_region: byDim(cur, prev, "region", all.f),
    failure_reasons: byDim(cur, prev, "failure_reason", all.f),
    top_intents: intents,
  };
}

// ───────────────────────────────────────── breakdown ──
export function qualityBreakdown(req: NextRequest): QualityBreakdown {
  const s = scope(req);
  const dim = s.q.enumOne("dim", QUALITY_DIMS);
  if (!dim) throw badRequest({ key: "validation.required", vars: { name: "dim" } }, { field: "dim", allowed: QUALITY_DIMS });
  const sort = s.q.enumOne("sort", SORTS, "fail_count")!;
  const limit = s.q.int("limit", { min: 1, max: 500, def: 100 })!;
  const { cur, prev } = s;
  const all = totalOf(cur);
  const c = tally(cur, dim);
  const p = tally(prev, dim);
  const natural = naturalOrder(dim, c.keys());
  const b = buckets(s.range);
  const trend = new Map<string, { t: number[]; f: number[] }>();
  for (const r of cur) {
    const i = b.index(r.eval_ts);
    for (const [v, fail] of contrib(r, dim)) {
      let x = trend.get(v);
      if (!x) trend.set(v, (x = { t: b.t.map(() => 0), f: b.t.map(() => 0) }));
      x.t[i]++;
      if (fail) x.f[i]++;
    }
  }
  let items: QualityBreakdownItem[] = orderedValues(c, p, natural, s.q.list(dim) ?? []).map((v) => {
    const tr = trend.get(v);
    return {
      ...valueStat(v, c.get(v), p.get(v), all.f),
      trend: tr?.f ?? b.t.map(() => 0),
      trend_rate: tr ? tr.t.map((n, i) => pct(n - tr.f[i], n)) : b.t.map(() => null),
    };
  });
  const nullLast = (a: number | null, b2: number | null, asc: boolean) => (a == null ? (b2 == null ? 0 : 1) : b2 == null ? -1 : asc ? a - b2 : b2 - a);
  if (sort === "fail_count") items.sort((a, x) => x.fail - a.fail || x.total - a.total);
  else if (sort === "volume") items.sort((a, x) => x.total - a.total);
  else if (sort === "pass_rate") items.sort((a, x) => nullLast(a.pass_rate, x.pass_rate, true));
  else if (sort === "delta") items.sort((a, x) => nullLast(a.delta_pp, x.delta_pp, true));
  const total = items.length;
  const truncated = items.length > limit;
  items = items.slice(0, limit);
  return {
    items,
    total,
    range: s.range,
    previous: s.previous,
    dim,
    sort,
    totals: stat(all, totalOf(prev)),
    trend: { bucket: b.bucket, t: b.t },
    truncated,
  };
}

// ───────────────────────────────────────── matrix ──
export function qualityMatrix(req: NextRequest): QualityMatrix {
  const s = scope(req);
  const x = s.q.enumOne("x", QUALITY_DIMS);
  const y = s.q.enumOne("y", QUALITY_DIMS);
  if (!x) throw badRequest({ key: "validation.required", vars: { name: "x" } }, { field: "x", allowed: QUALITY_DIMS });
  if (!y) throw badRequest({ key: "validation.required", vars: { name: "y" } }, { field: "y", allowed: QUALITY_DIMS });
  if (x === y) throw badRequest({ key: "validation.enumInvalid", vars: { name: "y", values: y } }, { field: "y", reason: "x and y must differ" });
  const metric = s.q.enumOne("metric", METRICS, "pass_rate")!;
  const maxX = s.q.int("max_x", { min: 2, max: 40, def: 12 })!;
  const maxY = s.q.int("max_y", { min: 2, max: 40, def: 12 })!;
  const { cur, prev } = s;
  const all = totalOf(cur);
  const cx = tally(cur, x);
  const cy = tally(cur, y);
  const px = tally(prev, x);
  const py = tally(prev, y);
  const fx = fold(orderedValues(cx, px, naturalOrder(x, cx.keys())), maxX, naturalOrder(x) == null);
  const fy = fold(orderedValues(cy, py, naturalOrder(y, cy.keys())), maxY, naturalOrder(y) == null);
  const cells = new Map<string, { c: Cnt; p: Cnt }>();
  const axisX = new Map<string, { c: Cnt; p: Cnt }>();
  const axisY = new Map<string, { c: Cnt; p: Cnt }>();
  const bump = (m: Map<string, { c: Cnt; p: Cnt }>, k: string, isPrev: boolean, fail: boolean) => {
    let e = m.get(k);
    if (!e) m.set(k, (e = { c: { t: 0, f: 0 }, p: { t: 0, f: 0 } }));
    const t = isPrev ? e.p : e.c;
    t.t++;
    if (fail) t.f++;
  };
  const add = (rows: ResultRow[], isPrev: boolean) => {
    for (const r of rows) {
      const xs = contrib(r, x);
      const ys = contrib(r, y);
      for (const [xv, xf] of xs) {
        const xk = fx.key(xv);
        if (xk == null) continue;
        bump(axisX, xk, isPrev, xf);
        for (const [yv, yf] of ys) {
          const yk = fy.key(yv);
          if (yk == null) continue;
          bump(cells, xk + "\u0000" + yk, isPrev, xf && yf);
        }
      }
      for (const [yv, yf] of ys) {
        const yk = fy.key(yv);
        if (yk != null) bump(axisY, yk, isPrev, yf);
      }
    }
  };
  add(cur, false);
  add(prev, true);
  const items: QualityMatrixCell[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const yv of fy.values)
    for (const xv of fx.values) {
      const e = cells.get(xv + "\u0000" + yv);
      const st = stat(e?.c, e?.p);
      const value = metric === "pass_rate" ? st.pass_rate : metric === "fail_count" ? (st.total ? st.fail : null) : st.delta_pp;
      if (value != null) {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      items.push({ x: xv, y: yv, value, ...st });
    }
  const totals = (vals: string[], m: Map<string, { c: Cnt; p: Cnt }>) => vals.map((v) => valueStat(v, m.get(v)?.c, m.get(v)?.p, all.f));
  return {
    items,
    total: items.length,
    range: s.range,
    previous: s.previous,
    x,
    y,
    metric,
    x_values: fx.values,
    y_values: fy.values,
    x_totals: totals(fx.values, axisX),
    y_totals: totals(fy.values, axisY),
    domain: Number.isFinite(lo) ? [r2(lo), r2(hi)] : null,
    folded: { x: fx.folded, y: fy.folded },
  };
}

// ───────────────────────────────────────── versions ──
export function qualityVersions(req: NextRequest): QualityVersions {
  const s = scope(req);
  const dim = s.q.enumOne("dim", VERSION_DIMS, "model_version")!;
  const by = s.q.enumOne("by", VERSION_BY, "division")!;
  const { cur, prev } = s;
  const all = totalOf(cur);
  const c = tally(cur, dim);
  const p = tally(prev, dim);
  // versions with rows in the CURRENT window, in release order
  const versions = (naturalOrder(dim, c.keys()) ?? [...c.keys()]).filter((v) => c.has(v));
  const get = DIM_GET[dim];
  const mix = new Map<string, Partial<Record<FailureReason, number>>>();
  for (const r of cur)
    if (r.result === "FAIL" && r.failure_reason) {
      const m = mix.get(get(r)) ?? {};
      m[r.failure_reason] = (m[r.failure_reason] ?? 0) + 1;
      mix.set(get(r), m);
    }
  const rateOf = (v: string | null) => (v ? pct((c.get(v)?.t ?? 0) - (c.get(v)?.f ?? 0), c.get(v)?.t ?? 0) : null);
  const items: QualityVersionRow[] = versions.map((v, i) => {
    const base = i > 0 ? versions[i - 1] : null;
    const st = valueStat(v, c.get(v), p.get(v), all.f);
    const br = rateOf(base);
    return {
      ...st,
      baseline_version: base,
      vs_prev_version_pp: st.pass_rate != null && br != null ? r2(st.pass_rate - br) : null,
      failure_mix: mix.get(v) ?? {},
    };
  });
  // group × version
  const gc = new Map<string, Map<string, Cnt>>();
  const gp = new Map<string, Map<string, Cnt>>();
  const fill = (rows: ResultRow[], m: Map<string, Map<string, Cnt>>) => {
    for (const r of rows) {
      const g = DIM_GET[by](r);
      let mm = m.get(g);
      if (!mm) m.set(g, (mm = new Map()));
      for (const k of [get(r), "\u0000all"]) {
        let e = mm.get(k);
        if (!e) mm.set(k, (e = { t: 0, f: 0 }));
        e.t++;
        if (r.result === "FAIL") e.f++;
      }
    }
  };
  fill(cur, gc);
  fill(prev, gp);
  const gvals = (naturalOrder(by, gc.keys()) ?? [...gc.keys()]).filter((g) => gc.has(g));
  const groups: QualityVersionGroup[] = gvals.map((g) => {
    const mc = gc.get(g)!;
    const mp = gp.get(g);
    const cells = versions.map((v, i) => {
      const st = stat(mc.get(v), mp?.get(v));
      const bv = i > 0 ? mc.get(versions[i - 1]) : undefined;
      const br = bv ? pct(bv.t - bv.f, bv.t) : null;
      return {
        version: v,
        ...st,
        vs_prev_version_pp: st.pass_rate != null && br != null ? r2(st.pass_rate - br) : null,
      };
    });
    return {
      value: g,
      total: stat(mc.get("\u0000all"), mp?.get("\u0000all")),
      cells,
    };
  });
  // pass rate per version per bucket
  const b = buckets(s.range);
  const series = new Map(versions.map((v) => [v, { t: b.t.map(() => 0), f: b.t.map(() => 0) }]));
  for (const r of cur) {
    const x = series.get(get(r));
    if (!x) continue;
    const i = b.index(r.eval_ts);
    x.t[i]++;
    if (r.result === "FAIL") x.f[i]++;
  }
  return {
    items,
    total: items.length,
    range: s.range,
    previous: s.previous,
    dim,
    by,
    versions,
    groups,
    trend: {
      bucket: b.bucket,
      t: b.t,
      series: versions.map((v) => ({
        version: v,
        total: series.get(v)!.t,
        pass_rate: series.get(v)!.t.map((n, i) => pct(n - series.get(v)!.f[i], n)),
      })),
    },
  };
}

// ───────────────────────────────────────── distributions ──
const SCORE_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const LATENCY_EDGES = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 4000, 6000, 8000, 10000, 12000];

export function qualityDistributions(req: NextRequest): QualityDistributions {
  const s = scope(req);
  const by = s.q.enumOne(
    "by",
    QUALITY_DIMS.filter((d) => d !== "failure_reason"),
    "division",
  )!;
  const maxBy = s.q.int("max_by", { min: 2, max: 40, def: 12 })!;
  const nEx = s.q.int("examples", { min: 0, max: 10, def: 3 })!;
  const { cur, prev } = s;
  const lc = latencyStats(cur);
  const lp = latencyStats(prev);
  // failure_reason × by
  const fails = cur.filter((r) => r.result === "FAIL" && r.failure_reason);
  const cb = tally(fails, by);
  const fb = fold(orderedValues(cb, new Map(), naturalOrder(by, cb.keys())), maxBy, naturalOrder(by) == null);
  const idx = new Map(fb.values.map((v, i) => [v, i]));
  const counts = FAILURE_REASONS.map(() => fb.values.map(() => 0));
  for (const r of fails) {
    const k = fb.key(DIM_GET[by](r));
    if (k == null) continue;
    counts[FAILURE_REASONS.indexOf(r.failure_reason as FailureReason)][idx.get(k)!]++;
  }
  // FAILs per code per bucket
  const b = buckets(s.range);
  const tr = FAILURE_REASONS.map(() => b.t.map(() => 0));
  for (const r of fails) tr[FAILURE_REASONS.indexOf(r.failure_reason as FailureReason)][b.index(r.eval_ts)]++;
  const prevBy = tally(prev, "failure_reason");
  // example FAIL rows: the latest per code (verbatim judge_reason, no text aggregation)
  const latest = [...fails].sort((a, x) => x.eval_ts - a.eval_ts || (a.utterance_id < x.utterance_id ? -1 : 1));
  const examples = FAILURE_REASONS.map((reason) => {
    const rows = latest.filter((r) => r.failure_reason === reason);
    return {
      reason,
      count: rows.length,
      rows: rows.slice(0, nEx).map((r) => ({
        utterance_id: r.utterance_id,
        utterance_text: r.utterance_text,
        intent_expected: r.intent_expected,
        intent_predicted: r.intent_predicted,
        judge_score: r.judge_score,
        judge_reason: r.judge_reason,
        device_type: r.device_type,
        language: r.language,
        eval_ts: r.eval_ts,
      })),
    };
  });
  return {
    range: s.range,
    previous: s.previous,
    total: cur.length,
    judge_score: {
      ...histogram(cur, SCORE_EDGES, (r) => r.judge_score),
      avg: avgScore(cur),
      prev_avg: avgScore(prev),
    },
    latency: {
      ...histogram(cur, LATENCY_EDGES, (r) => r.latency_ms),
      p50: lc.p50,
      p95: lc.p95,
      prev_p50: lp.p50,
      prev_p95: lp.p95,
    },
    reason_by: {
      dim: by,
      values: fb.values,
      reasons: FAILURE_REASONS,
      counts,
      totals: fb.values.map((_, i) => counts.reduce((a, row) => a + row[i], 0)),
      folded: fb.folded,
    },
    reason_trend: {
      bucket: b.bucket,
      t: b.t,
      series: FAILURE_REASONS.map((reason, i) => ({
        reason,
        fail: tr[i],
        total: tr[i].reduce((a, n) => a + n, 0),
        prev_total: prevBy.get(reason)?.f ?? 0,
      })),
    },
    examples,
  };
}
