/**
 * Issue Report — API services behind /api/v1/issues/* (server-only).
 * Analysis: ./issues-engine.ts · lifecycle: ./issues-store.ts · text: ./issues-text.ts.
 * Contract: docs/data-contract.md "Issue Report".
 *
 * Query params shared by every endpoint (all optional, comma-separated lists):
 *   range | from,to                         global time range (src/server/range.ts)
 *   agent_function capsule intent language market device model_version pipeline pipeline_version
 *   failure_reason os_version one_ui_version                     → row filters (before clustering)
 *   severity status novelty severity_class q min_score           → issue filters (after scoring)
 *   group_by=signature|pattern   sort=score_desc|count_desc|fail_rate_desc|delta_desc|recent_desc|first_seen_desc
 *   page, pageSize (list endpoints)
 */
import type { NextRequest } from "next/server";
import { LANG_CODES } from "@/lib/catalog";
import { formatIssueText } from "@/lib/issue-text";
import type {
  InsightList,
  Issue,
  IssueColumn,
  IssueColumnStat,
  IssueDetail,
  IssueFacetKey,
  IssueFacets,
  IssueFactorKey,
  IssueGroupBy,
  IssueInsight,
  IssueListResponse,
  IssueMatrix,
  IssueMover,
  IssuePatch,
  IssuePatchResult,
  IssueSeverity,
  IssueStatus,
  IssueSummary,
  IssueTrendPoint,
  PatternList,
  ResolvedRange,
  ResultRow,
  SeverityClass,
} from "@/lib/types";
import { tFor } from "@/i18n/request";
import { Query, badRequest, notFound, paginate, readJson, requirePermission, resolveOperator, V } from "../http";
import { getEngine } from "../mock/runtime";
import { readRange } from "../range";
import {
  AGENT_FUNCTIONS,
  CLASSES,
  COLUMN_GET,
  COLUMNS,
  FACTOR_KEYS,
  FACTOR_WEIGHTS,
  FAILURE_REASONS,
  MARKETS,
  RESULTS_PARAM,
  SEVERITIES,
  analyze,
  bucketsFor,
  patternsOf,
  r1,
  rowMatches,
  withState,
  type Analysis,
  type RowFilters,
} from "./issues-engine";
import { ISSUE_STATUSES, OPEN_STATUSES, patchIssueState } from "./issues-store";

const SORTS = ["score_desc", "count_desc", "fail_rate_desc", "delta_desc", "recent_desc", "first_seen_desc"] as const;
type Sort = (typeof SORTS)[number];

export interface IssueQueryParsed {
  range: ResolvedRange;
  filters: RowFilters;
  issue: { severity?: IssueSeverity[]; status?: IssueStatus[]; novelty?: ("new" | "recurring")[]; severity_class?: SeverityClass[]; q?: string; min_score?: number };
  groupBy: IssueGroupBy;
  sort: Sort;
  q: Query;
}

export function parseIssueQuery(req: NextRequest): IssueQueryParsed {
  const q = Query.of(req);
  const range = readRange(req);
  const filters: RowFilters = {};
  for (const c of COLUMNS) {
    let v: string[] | undefined;
    if (c === "language") v = q.enumList("language", LANG_CODES);
    else if (c === "market") v = q.enumList("market", MARKETS);
    else if (c === "agent_function") v = q.enumList("agent_function", AGENT_FUNCTIONS);
    else if (c === "failure_reason") v = q.enumList("failure_reason", FAILURE_REASONS);
    else v = q.list(c);
    if (v?.length) filters[c] = v;
  }
  return {
    range,
    filters,
    issue: {
      severity: q.enumList("severity", SEVERITIES),
      status: q.enumList("status", ISSUE_STATUSES),
      novelty: q.enumList("novelty", ["new", "recurring"] as const),
      severity_class: q.enumList("severity_class", CLASSES),
      q: q.str("q")?.toLowerCase(),
      min_score: q.num("min_score", { min: 0, max: 100 }),
    },
    groupBy: q.enumOne("group_by", ["signature", "pattern"] as const, "signature")!,
    sort: q.enumOne("sort", SORTS, "score_desc")!,
    q,
  };
}

function analysisFor(p: IssueQueryParsed): Analysis {
  const announce = p.range.preset === "today" && !Object.keys(p.filters).length && p.groupBy === "signature";
  return analyze({ from: p.range.from, to: p.range.to, filters: p.filters, groupBy: p.groupBy, announce });
}

function issueMatches(i: Issue, f: IssueQueryParsed["issue"]): boolean {
  if (f.severity && !f.severity.includes(i.severity)) return false;
  if (f.status && !f.status.includes(i.state.status)) return false;
  if (f.novelty && !f.novelty.includes(i.novelty)) return false;
  if (f.severity_class && !f.severity_class.includes(i.severity_class)) return false;
  if (f.min_score != null && i.score < f.min_score) return false;
  if (f.q) {
    const s = i.signature;
    const hay = [i.id, s.agent_function, s.intent_expected, s.intent_predicted, s.failure_reason, s.pattern_template, i.sample.utterance_text, i.state.ticket_id ?? "", i.state.owner ?? "", i.state.note ?? "", ...i.patterns.map((p) => p.template)]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

const SORTERS: Record<Sort, (a: Issue, b: Issue) => number> = {
  score_desc: (a, b) => b.score - a.score || b.count - a.count,
  count_desc: (a, b) => b.count - a.count || b.score - a.score,
  fail_rate_desc: (a, b) => b.fail_rate - a.fail_rate || b.score - a.score,
  delta_desc: (a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity) || b.score - a.score,
  recent_desc: (a, b) => b.last_seen - a.last_seen,
  first_seen_desc: (a, b) => b.first_seen - a.first_seen,
};

/** Ranked issues after issue-level filters (state refreshed). */
function filteredIssues(a: Analysis, p: IssueQueryParsed): Issue[] {
  return a.issues
    .map(withState)
    .filter((i) => issueMatches(i, p.issue))
    .sort(SORTERS[p.sort]);
}

// ───────────────────────────────────────── GET /issues ──
export function listIssues(req: NextRequest): IssueListResponse {
  const p = parseIssueQuery(req);
  const a = analysisFor(p);
  const all = filteredIssues(a, p);
  const { page, pageSize } = p.q.page(25, 500);
  const pg = paginate(all, page, pageSize);
  return { items: pg.items, total: pg.total, page, pageSize, range: p.range, baseline: a.baseline, unfiltered_total: a.issues.length, factor_weights: FACTOR_WEIGHTS };
}

// ───────────────────────────────────────── GET /issues/summary ──
function rate(f: number, t: number): number | null {
  return t > 0 ? r1((f / t) * 100) : null;
}

function columnStats(a: Analysis, issueIds: Set<string>): Record<IssueColumn, IssueColumnStat[]> {
  const out = {} as Record<IssueColumn, IssueColumnStat[]>;
  for (const c of COLUMNS) {
    const get = COLUMN_GET[c];
    const cur = new Map<string, { t: number; f: number; iss: Set<string> }>();
    const base = new Map<string, { t: number; f: number }>();
    for (const r of a.rows) {
      const v = get(r);
      let x = cur.get(v);
      if (!x) cur.set(v, (x = { t: 0, f: 0, iss: new Set() }));
      x.t++;
      if (r.result === "FAIL") {
        x.f++;
        const iid = a.rowIssue.get(r.utterance_id);
        if (iid && issueIds.has(iid)) x.iss.add(iid);
      }
    }
    for (const r of a.baseRows) {
      const v = get(r);
      let x = base.get(v);
      if (!x) base.set(v, (x = { t: 0, f: 0 }));
      x.t++;
      if (r.result === "FAIL") x.f++;
    }
    out[c] = [...cur.entries()]
      .filter(([v]) => v !== "")
      .map(([value, x]) => {
        const b = base.get(value);
        const fr = rate(x.f, x.t) ?? 0;
        const br = b ? rate(b.f, b.t) : null;
        return { value, total: x.t, fails: x.f, fail_rate: fr, baseline_fail_rate: br, delta: br == null ? null : r1(fr - br), issues: x.iss.size };
      })
      .sort((u, v) => v.fails - u.fails || (u.value < v.value ? -1 : 1));
  }
  return out;
}

function matrixOf(a: Analysis, rowKey: (r: ResultRow) => string, colKey: (r: ResultRow) => string, rows: string[], cols: string[], issues: Issue[]): IssueMatrix {
  const cur = new Map<string, { t: number; f: number }>();
  const base = new Map<string, { t: number; f: number }>();
  const bump = (m: Map<string, { t: number; f: number }>, r: ResultRow) => {
    const k = rowKey(r) + "|" + colKey(r);
    let x = m.get(k);
    if (!x) m.set(k, (x = { t: 0, f: 0 }));
    x.t++;
    if (r.result === "FAIL") x.f++;
  };
  for (const r of a.rows) bump(cur, r);
  for (const r of a.baseRows) bump(base, r);
  const top = new Map<string, string>();
  // issues are ranked by score: the first issue touching a cell is its top issue
  const byId = new Map([...a.clusters.values()].map((c) => [c.id, c]));
  for (const i of issues) {
    const c = byId.get(i.id);
    if (!c) continue;
    for (const r of c.rows) {
      const k = rowKey(r) + "|" + colKey(r);
      if (!top.has(k)) top.set(k, i.id);
    }
  }
  const cells = [];
  for (const rk of rows)
    for (const ck of cols) {
      const x = cur.get(rk + "|" + ck) ?? { t: 0, f: 0 };
      const b = base.get(rk + "|" + ck);
      const fr = rate(x.f, x.t);
      const br = b ? rate(b.f, b.t) : null;
      cells.push({ row: rk, col: ck, total: x.t, fails: x.f, fail_rate: fr, baseline_fail_rate: br, delta: fr == null || br == null ? null : r1(fr - br), top_issue_id: top.get(rk + "|" + ck) ?? null });
    }
  return { rows, cols, cells };
}

function trendOf(a: Analysis, critical: Set<string>): IssueSummary["trend"] {
  const b = a.buckets;
  const pts: IssueTrendPoint[] = b.starts.map((t) => ({ t, total: 0, fails: 0, fail_rate: null, critical_fails: 0, new_pattern_rows: 0 }));
  for (const r of a.rows) {
    const p = pts[b.index(r.eval_ts)];
    p.total++;
    if (a.novelPatterns.has(r.utterance_pattern)) p.new_pattern_rows++;
    if (r.result === "FAIL") {
      p.fails++;
      const iid = a.rowIssue.get(r.utterance_id);
      if (iid && critical.has(iid)) p.critical_fails++;
    }
  }
  for (const p of pts) p.fail_rate = rate(p.fails, p.total);
  return { bucket: b.bucket, points: pts };
}

export function issueSummary(req: NextRequest): IssueSummary {
  const p = parseIssueQuery(req);
  const a = analysisFor(p);
  const issues = filteredIssues(a, { ...p, sort: "score_desc" });
  const ids = new Set(issues.map((i) => i.id));
  const by_severity = { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<IssueSeverity, number>;
  const status_distribution = Object.fromEntries(ISSUE_STATUSES.map((s) => [s, 0])) as Record<IssueStatus, number>;
  const sevDist = SEVERITIES.map((severity) => ({ severity, issues: 0, fails: 0, by_status: Object.fromEntries(ISSUE_STATUSES.map((s) => [s, 0])) as Record<IssueStatus, number> }));
  const clsDist = CLASSES.map((cls) => ({ cls, issues: 0, fails: 0 }));
  for (const i of issues) {
    by_severity[i.severity]++;
    status_distribution[i.state.status]++;
    const sd = sevDist[SEVERITIES.indexOf(i.severity)];
    sd.issues++;
    sd.fails += i.count;
    sd.by_status[i.state.status]++;
    const cd = clsDist[CLASSES.indexOf(i.severity_class)];
    cd.issues++;
    cd.fails += i.count;
  }
  const critical = new Set(issues.filter((i) => i.severity === "P0" || i.severity === "P1").map((i) => i.id));
  const fails = a.fails.length;
  const baseFails = a.baseRows.filter((r) => r.result === "FAIL").length;
  const fr = rate(fails, a.rows.length);
  const bfr = rate(baseFails, a.baseRows.length);
  const columns = columnStats(a, ids);
  const movers: IssueMover[] = [];
  for (const c of COLUMNS) {
    if (c === "intent") continue;
    for (const s of columns[c]) {
      if (s.delta == null || s.baseline_fail_rate == null || s.total < 30 || Math.abs(s.delta) < 1) continue;
      movers.push({ column: c, value: s.value, fail_rate: s.fail_rate, baseline_fail_rate: s.baseline_fail_rate, delta: s.delta, fails: s.fails, direction: s.delta > 0 ? "up" : "down" });
    }
  }
  movers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const top20 = issues.slice(0, 20);
  const factor_profile = Object.fromEntries(
    FACTOR_KEYS.map((k) => [k, top20.length ? r1(top20.reduce((s, i) => s + (i.factors.find((f) => f.key === k)?.contribution ?? 0), 0) / top20.length) : 0]),
  ) as Record<IssueFactorKey, number>;
  const pats = patternsOf(a);
  const markets = new Set<string>();
  for (const i of issues) if (i.severity === "P0" || i.severity === "P1") i.markets.forEach((m) => markets.add(m));
  const langsPresent = LANG_CODES.filter((l) => a.rows.some((r) => r.language === l));
  return {
    range: p.range,
    baseline: a.baseline,
    kpis: {
      utterances: a.rows.length,
      fails,
      fail_rate: fr,
      baseline_fail_rate: bfr,
      fail_rate_delta: fr == null || bfr == null ? null : r1(fr - bfr),
      issues: issues.length,
      by_severity,
      critical_open: issues.filter((i) => (i.severity === "P0" || i.severity === "P1") && OPEN_STATUSES.includes(i.state.status)).length,
      safety_issues: issues.filter((i) => i.severity_class === "safety").length,
      new_issues: issues.filter((i) => i.novelty === "new").length,
      regressions: issues.filter((i) => (i.factors.find((f) => f.key === "regression")?.value ?? 0) >= 0.15).length,
      new_patterns: pats.items.length,
      markets_affected: markets.size,
      avg_score: issues.length ? r1(issues.reduce((s, i) => s + i.score, 0) / issues.length) : null,
      max_score: issues.length ? issues[0].score : null,
      resolved: status_distribution.RESOLVED,
    },
    severity_distribution: sevDist,
    class_distribution: clsDist,
    status_distribution,
    factor_weights: FACTOR_WEIGHTS,
    factor_profile,
    columns,
    trend: trendOf(a, critical),
    matrix: matrixOf(a, (r) => r.agent_function, (r) => r.language, AGENT_FUNCTIONS.filter((f) => a.rows.some((r) => r.agent_function === f)), langsPresent, issues),
    market_matrix: matrixOf(a, (r) => r.agent_function, (r) => r.market, AGENT_FUNCTIONS.filter((f) => a.rows.some((r) => r.agent_function === f)), MARKETS.filter((m) => a.rows.some((r) => r.market === m)), issues),
    top_movers: movers.slice(0, 12),
    top_issues: issues.slice(0, 10).map((i) => ({
      id: i.id,
      rank: i.rank,
      title: i.title,
      severity: i.severity,
      severity_class: i.severity_class,
      score: i.score,
      count: i.count,
      fail_rate: i.fail_rate,
      delta: i.delta,
      novelty: i.novelty,
      signature: i.signature,
      spark: i.spark,
      state: i.state,
    })),
  };
}

// ───────────────────────────────────────── GET /issues/facets ──
export function issueFacets(req: NextRequest): IssueFacets {
  const p = parseIssueQuery(req);
  const e = getEngine();
  const all = e.results.rowsInRange(p.range.from, p.range.to).filter((r) => r.result === "FAIL");
  const facets = {} as Record<IssueFacetKey, { value: string; count: number }[]>;
  for (const c of COLUMNS) {
    const m = new Map<string, number>();
    // each column's counts ignore that column's own filter (so the other values stay selectable)
    for (const r of all) if (rowMatches(r, p.filters, c)) m.set(COLUMN_GET[c](r), (m.get(COLUMN_GET[c](r)) ?? 0) + 1);
    facets[c] = [...m.entries()].filter(([v]) => v !== "").map(([value, count]) => ({ value, count })).sort((x, y) => y.count - x.count || (x.value < y.value ? -1 : 1));
  }
  const issues = analysisFor(p).issues.map(withState);
  const count = (vals: readonly string[], get: (i: Issue) => string, skip: keyof IssueQueryParsed["issue"]) => {
    const f = { ...p.issue, [skip]: undefined };
    const xs = issues.filter((i) => issueMatches(i, f));
    return vals.map((value) => ({ value, count: xs.filter((i) => get(i) === value).length }));
  };
  facets.severity = count(SEVERITIES, (i) => i.severity, "severity");
  facets.status = count(ISSUE_STATUSES, (i) => i.state.status, "status");
  facets.novelty = count(["new", "recurring"], (i) => i.novelty, "novelty");
  facets.severity_class = count(CLASSES, (i) => i.severity_class, "severity_class");
  return { range: p.range, facets };
}

// ───────────────────────────────────────── GET /issues/[id] ──
function findIssue(p: IssueQueryParsed, id: string): { a: Analysis; issue: Issue } {
  for (const groupBy of [p.groupBy, p.groupBy === "signature" ? "pattern" : "signature"] as IssueGroupBy[]) {
    const a = analyze({ from: p.range.from, to: p.range.to, filters: p.filters, groupBy });
    const issue = a.issues.find((i) => i.id === id);
    if (issue) return { a, issue: withState(issue) };
  }
  throw notFound({ key: "domain.issueNotFound", vars: { id } });
}

export function issueDetail(req: NextRequest, id: string): IssueDetail {
  const p = parseIssueQuery(req);
  const { a, issue } = findIssue(p, id);
  const e = getEngine();
  const cluster = [...a.clusters.values()].find((c) => c.id === id)!;
  const rows = [...cluster.rows].sort((x, y) => y.eval_ts - x.eval_ts);
  const { page, pageSize } = p.q.page(20, 200);
  const pg = paginate(rows, page, pageSize);
  const scopeRows = a.rows.filter((r) => r.intent_expected === issue.signature.intent_expected);
  const scopeBase = a.baseRows.filter((r) => r.intent_expected === issue.signature.intent_expected);
  const ids = new Set(cluster.rows.map((r) => r.utterance_id));
  const b = bucketsFor(a.from, a.to);
  const pts = b.starts.map((t) => ({ t, fails: 0, total: 0, fail_rate: null as number | null }));
  for (const r of scopeRows) {
    const x = pts[b.index(r.eval_ts)];
    x.total++;
    if (ids.has(r.utterance_id)) x.fails++;
  }
  for (const x of pts) x.fail_rate = rate(x.fails, x.total);
  const baseIds = new Set<string>();
  for (const r of scopeBase)
    if (r.result === "FAIL" && r.intent_predicted === issue.signature.intent_predicted && r.failure_reason === issue.signature.failure_reason && (issue.group_by === "signature" || r.utterance_pattern === issue.signature.utterance_pattern))
      baseIds.add(r.utterance_id);
  const bd = (col: IssueColumn): IssueColumnStat[] => {
    const get = COLUMN_GET[col];
    const m = new Map<string, { t: number; f: number; bt: number; bf: number }>();
    for (const r of scopeRows) {
      const v = get(r);
      const x = m.get(v) ?? { t: 0, f: 0, bt: 0, bf: 0 };
      x.t++;
      if (ids.has(r.utterance_id)) x.f++;
      m.set(v, x);
    }
    for (const r of scopeBase) {
      const x = m.get(get(r));
      if (!x) continue;
      x.bt++;
      if (baseIds.has(r.utterance_id)) x.bf++;
    }
    return [...m.entries()]
      .map(([value, x]) => {
        const fr = rate(x.f, x.t) ?? 0;
        const br = x.bt ? rate(x.bf, x.bt) : null;
        return { value, total: x.t, fails: x.f, fail_rate: fr, baseline_fail_rate: br, delta: br == null ? null : r1(fr - br), issues: x.f ? 1 : 0 };
      })
      .filter((x) => x.value !== "")
      .sort((u, v) => v.fails - u.fails || v.total - u.total);
  };
  const wfCount = new Map<string, number>();
  for (const r of cluster.rows) wfCount.set(r.workflow_id, (wfCount.get(r.workflow_id) ?? 0) + 1);
  const workflows = [...wfCount.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 12)
    .flatMap(([wid, fails]) => {
      const w = e.getWorkflow(wid);
      return w ? [{ workflow_id: wid, language: w.language, pipeline_id: w.pipeline_id, pipeline_version: w.pipeline_version, model_version: w.model_version, created_at: w.created_at, completed_at: w.completed_at ?? null, fails }] : [];
    });
  const s = issue.signature;
  const similar = a.issues
    .filter((i) => i.id !== id)
    .map((i) => {
      const relation =
        i.signature.intent_expected === s.intent_expected
          ? ("same_intent" as const)
          : i.signature.agent_function === s.agent_function && i.signature.failure_reason === s.failure_reason
            ? ("same_function_reason" as const)
            : i.signature.intent_predicted === s.intent_predicted && s.intent_predicted !== s.intent_expected
              ? ("same_prediction" as const)
              : null;
      return relation ? { id: i.id, title: i.title, severity: i.severity, score: i.score, count: i.count, relation } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 6);
  return {
    ...issue,
    range: p.range,
    baseline: a.baseline,
    utterances: { items: pg.items, total: pg.total, page, pageSize },
    trend: { bucket: b.bucket, points: pts },
    breakdown: {
      language: bd("language"),
      market: bd("market"),
      device: bd("device"),
      model_version: bd("model_version"),
      pipeline_version: bd("pipeline_version"),
      os_version: bd("os_version"),
      one_ui_version: bd("one_ui_version"),
    },
    workflows,
    similar,
  };
}

// ───────────────────────────────────────── GET /issues/patterns ──
export function issuePatterns(req: NextRequest): PatternList {
  const p = parseIssueQuery(req);
  const a = analysisFor(p);
  const { items, terms } = patternsOf(a);
  const kinds = p.q.enumList("kind", ["new_feature_name", "code_switch", "new_term", "new_phrasing"] as const);
  const lim = p.q.int("limit", { min: 1, max: 200, def: 50 })!;
  const xs = items.filter((x) => !kinds || kinds.includes(x.kind)).filter((x) => !p.issue.q || (x.template + " " + x.terms.join(" ") + " " + x.intent_expected).toLowerCase().includes(p.issue.q));
  return { items: xs.slice(0, lim), total: xs.length, range: p.range, baseline: a.baseline, terms };
}

// ───────────────────────────────────────── GET /issues/insights ──
function rowFilterParams(f: RowFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, (v ?? []).join(",")]));
}
function resultsParams(f: RowFilters, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { result: "FAIL" };
  for (const c of COLUMNS) if (f[c]?.length) out[RESULTS_PARAM[c]] = f[c]!.join(",");
  return { ...out, ...extra };
}

export function buildInsights(a: Analysis, p: IssueQueryParsed): IssueInsight[] {
  const issues = filteredIssues(a, { ...p, sort: "score_desc" });
  const base = rowFilterParams(p.filters);
  const out: IssueInsight[] = [];
  const sevOfScore = (s: number): IssueSeverity => (s >= 80 ? "P0" : s >= 60 ? "P1" : s >= 40 ? "P2" : "P3");
  const add = (x: Omit<IssueInsight, "id" | "severity"> & { severity?: IssueSeverity }) => out.push({ ...x, id: `ins-${x.kind}-${out.length + 1}`, severity: x.severity ?? sevOfScore(x.score) });

  // overall
  const fails = a.fails.length;
  const fr = rate(fails, a.rows.length);
  const bf = a.baseRows.filter((r) => r.result === "FAIL").length;
  const bfr = rate(bf, a.baseRows.length);
  if (fr != null)
    add({
      kind: "overall",
      key: bfr == null ? "insights.overallNoBase" : "insights.overall",
      vars: { rate: fr, baseRate: bfr ?? 0, delta: bfr == null ? 0 : r1(fr - bfr), fails, issues: issues.length, critical: issues.filter((i) => i.severity === "P0" || i.severity === "P1").length },
      score: 40,
      evidence: { filter: base, results: resultsParams(p.filters, {}), metrics: { fail_rate: fr, baseline_fail_rate: bfr, fails, utterances: a.rows.length } },
    });
  // safety
  const safety = issues.filter((i) => i.severity_class === "safety");
  if (safety.length) {
    const top = safety[0];
    add({
      kind: "safety",
      key: "insights.safety",
      vars: { count: safety.reduce((s, i) => s + i.count, 0), issues: safety.length, intent: top.signature.intent_expected, fn: top.signature.agent_function, markets: top.markets.join(", "), devices: top.devices.slice(0, 3).join(", ") },
      score: 100,
      severity: "P0",
      evidence: { filter: { ...base, severity_class: "safety" }, results: top.results_query, metrics: { fails: top.count, score: top.score, fail_rate: top.fail_rate }, issue_id: top.id },
    });
  }
  // top critical (non-safety)
  for (const i of issues.filter((x) => (x.severity === "P0" || x.severity === "P1") && x.severity_class !== "safety").slice(0, 3)) {
    add({
      kind: "critical",
      // SLOT_ERROR etc. keep the expected intent: "X → X" would read as no error at all
      key: i.signature.intent_predicted === i.signature.intent_expected ? "insights.criticalSameIntent" : "insights.critical",
      vars: { fn: i.signature.agent_function, expected: i.signature.intent_expected, predicted: i.signature.intent_predicted, reason: i.signature.failure_reason, count: i.count, rate: i.fail_rate, score: i.score, severity: i.severity },
      score: i.score,
      severity: i.severity,
      evidence: { filter: { ...base, q: i.signature.intent_expected }, results: i.results_query, metrics: { score: i.score, fails: i.count, fail_rate: i.fail_rate, delta: i.delta }, issue_id: i.id },
    });
  }
  // regression
  const reg = issues.filter((i) => i.regression).sort((x, y) => (y.factors.find((f) => f.key === "regression")!.value) - (x.factors.find((f) => f.key === "regression")!.value))[0];
  if (reg?.regression) {
    const g = reg.regression;
    add({
      kind: "regression",
      key: "insights.regression",
      vars: { fn: reg.signature.agent_function, expected: reg.signature.intent_expected, reason: reg.signature.failure_reason, axis: g.axis, current: g.current, previous: g.previous, curRate: g.currentRate, prevRate: g.previousRate, multiple: g.previousRate > 0 ? r1(g.currentRate / g.previousRate) : 0 },
      score: 55 + reg.factors.find((f) => f.key === "regression")!.value * 30,
      evidence: { filter: { ...base, [g.axis]: g.current }, results: { ...reg.results_query, [g.axis === "pipeline_version" ? "version" : "model_version"]: g.current }, metrics: { current_rate: g.currentRate, previous_rate: g.previousRate, current_total: g.currentTotal, previous_total: g.previousTotal }, issue_id: reg.id },
    });
  }
  // spike
  const spike = issues
    .map((i) => ({ i, z: Number(i.factors.find((f) => f.key === "trend")!.detail.z ?? 0) }))
    .filter((x) => x.z >= 3 && x.i.novelty === "recurring")
    .sort((x, y) => y.z - x.z)[0];
  if (spike) {
    const d = spike.i.factors.find((f) => f.key === "trend")!.detail;
    add({
      kind: "spike",
      key: "insights.spike",
      vars: { fn: spike.i.signature.agent_function, expected: spike.i.signature.intent_expected, reason: spike.i.signature.failure_reason, z: spike.z, observed: Number(d.observed), expected_n: Number(d.expected), ratio: Number(d.expected) > 0 ? r1(Number(d.observed) / Number(d.expected)) : 0 },
      score: 50 + Math.min(30, spike.z * 3),
      evidence: { filter: base, results: spike.i.results_query, metrics: { z: spike.z, observed: d.observed, expected: d.expected }, issue_id: spike.i.id },
    });
  }
  // new patterns
  const pats = patternsOf(a);
  if (pats.items.length) {
    const failing = pats.items.filter((x) => x.fail_rate >= 40);
    add({
      kind: "new_pattern",
      key: "insights.newPatterns",
      vars: { count: pats.items.length, failing: failing.length, rows: pats.items.reduce((s, x) => s + x.count, 0), terms: pats.terms.slice(0, 3).map((t) => t.term).join(", ") },
      score: 45 + Math.min(25, failing.length * 4),
      evidence: { filter: { ...base, novelty: "new" }, results: null, metrics: { patterns: pats.items.length, failing: failing.length } },
    });
    for (const x of pats.items.filter((y) => y.fail_rate >= 40).slice(0, 2)) {
      const wrongTo = x.intents_predicted.find((y) => y.intent !== x.intent_expected)?.intent;
      // every FAIL kept the expected intent → say what went wrong instead of "X handled as X"
      const failEx = x.examples.filter((y) => y.result === "FAIL");
      const topReason = [...failEx.reduce((m, y) => m.set(y.failure_reason, (m.get(y.failure_reason) ?? 0) + 1), new Map<string, number>()).entries()].sort((u, v) => v[1] - u[1])[0]?.[0];
      add({
        kind: "new_pattern",
        ...(wrongTo || !topReason
          ? { key: "insights.newPattern", vars: { template: x.template, kind: x.kind, count: x.count, failRate: x.fail_rate, fn: x.agent_function, expected: x.intent_expected, predicted: wrongTo ?? x.intent_expected } }
          : {
              key: "insights.newPatternSameIntent",
              vars: { template: x.template, kind: x.kind, count: x.count, failRate: x.fail_rate, fn: x.agent_function, expected: x.intent_expected, reason: topReason, actual: (failEx.find((y) => y.failure_reason === topReason)?.actual_response ?? "").slice(0, 60) },
            }),
        score: 40 + Math.min(30, x.count * (x.fail_rate / 100) * 2),
        evidence: { filter: base, results: resultsParams(p.filters, { utterance_pattern: x.id }), metrics: { count: x.count, fail_rate: x.fail_rate, growth: x.growth }, pattern_id: x.id, ...(x.issue_ids[0] ? { issue_id: x.issue_ids[0] } : {}) },
      });
    }
  }
  // market + hotspot + improvement from column stats
  const cols = columnStats(a, new Set(issues.map((i) => i.id)));
  const mk = cols.market.filter((s) => s.delta != null && s.total >= 30).sort((x, y) => y.delta! - x.delta!)[0];
  if (mk && mk.delta! >= 1.5)
    add({
      kind: "market",
      key: "insights.market",
      vars: { market: mk.value, rate: mk.fail_rate, baseRate: mk.baseline_fail_rate ?? 0, delta: mk.delta!, fails: mk.fails },
      score: 40 + Math.min(30, mk.delta! * 3),
      evidence: { filter: { ...base, market: mk.value }, results: resultsParams(p.filters, { market: mk.value }), metrics: { fail_rate: mk.fail_rate, baseline_fail_rate: mk.baseline_fail_rate, delta: mk.delta } },
    });
  const mx = matrixOf(a, (r) => r.agent_function, (r) => r.language, AGENT_FUNCTIONS, [...LANG_CODES], issues);
  const hot = mx.cells.filter((c) => c.delta != null && c.total >= 25).sort((x, y) => y.delta! - x.delta!)[0];
  if (hot && hot.delta! >= 3)
    add({
      kind: "hotspot",
      key: "insights.hotspot",
      vars: { fn: hot.row, language: hot.col, rate: hot.fail_rate ?? 0, baseRate: hot.baseline_fail_rate ?? 0, delta: hot.delta!, fails: hot.fails },
      score: 40 + Math.min(30, hot.delta! * 2),
      evidence: { filter: { ...base, agent_function: hot.row, language: hot.col }, results: resultsParams(p.filters, { agent_function: hot.row, language: hot.col }), metrics: { fail_rate: hot.fail_rate, baseline_fail_rate: hot.baseline_fail_rate, delta: hot.delta }, ...(hot.top_issue_id ? { issue_id: hot.top_issue_id } : {}) },
    });
  const conc = issues.find((i) => i.reasons.some((r) => r.key === "reasons.concentration") && (i.severity === "P0" || i.severity === "P1" || i.severity === "P2"));
  if (conc) {
    const r = conc.reasons.find((x) => x.key === "reasons.concentration")!;
    add({
      kind: "concentration",
      key: "insights.concentration",
      vars: { fn: conc.signature.agent_function, expected: conc.signature.intent_expected, column: String(r.vars!.column), value: String(r.vars!.value), share: Number(r.vars!.share), overall: Number(r.vars!.overall) },
      score: 45 + conc.score / 4,
      evidence: { filter: base, results: { ...conc.results_query, [RESULTS_PARAM[r.vars!.column as IssueColumn]]: String(r.vars!.value) }, metrics: { share: Number(r.vars!.share), overall: Number(r.vars!.overall), fails: conc.count }, issue_id: conc.id },
    });
  }
  const imp = COLUMNS.filter((c) => c !== "intent")
    .flatMap((c) => cols[c].map((s) => ({ c, s })))
    .filter((x) => x.s.delta != null && x.s.total >= 60)
    .sort((x, y) => x.s.delta! - y.s.delta!)[0];
  if (imp && imp.s.delta! <= -1.5)
    add({
      kind: "improvement",
      key: "insights.improvement",
      vars: { column: imp.c, value: imp.s.value, rate: imp.s.fail_rate, baseRate: imp.s.baseline_fail_rate ?? 0, delta: imp.s.delta! },
      score: 30,
      severity: "P3",
      evidence: { filter: { ...base, [imp.c]: imp.s.value }, results: null, metrics: { fail_rate: imp.s.fail_rate, baseline_fail_rate: imp.s.baseline_fail_rate, delta: imp.s.delta } },
    });
  if (!a.baseline.sufficient)
    add({ kind: "overall", key: "insights.baselineInsufficient", vars: { days: a.baseline.days }, score: 10, severity: "P3", evidence: { filter: base, results: null, metrics: { coverage: a.baseline.coverage } } });
  out.sort((x, y) => y.score - x.score);
  out.forEach((x) => (x.score = r1(Math.min(100, x.score))));
  return out;
}

export function issueInsights(req: NextRequest): InsightList {
  const p = parseIssueQuery(req);
  const a = analysisFor(p);
  const items = buildInsights(a, p);
  return { items, total: items.length, range: p.range, baseline: a.baseline };
}

// ───────────────────────────────────────── PATCH /issues/[id] ──
export async function patchIssue(req: NextRequest, id: string): Promise<IssuePatchResult> {
  const op = resolveOperator(req);
  requirePermission(op, "issues:write");
  const body = await readJson(req);
  const patch: IssuePatch = {};
  if ("status" in body) {
    const s = V.str(body, "status", { required: true })!;
    if (!ISSUE_STATUSES.includes(s as IssueStatus)) throw badRequest({ key: "validation.oneOf", vars: { name: "status", values: ISSUE_STATUSES.join(", ") } }, { field: "status" });
    patch.status = s as IssueStatus;
  }
  if ("owner" in body) patch.owner = body.owner === null ? null : V.str(body, "owner", { required: true, max: 120 })!;
  if ("note" in body) patch.note = body.note === null ? null : (V.str(body, "note", { max: 2000 }) ?? null);
  if ("ticket_id" in body) patch.ticket_id = body.ticket_id === null ? null : V.str(body, "ticket_id", { required: true, max: 40 })!;
  patch.reason = V.str(body, "reason", { max: 500 });
  // the issue must exist in the requested range (default today) or in the last 30 days
  let meta: Parameters<typeof patchIssueState>[4] = {};
  const p = parseIssueQuery(req);
  const e = getEngine();
  const ranges = [p.range, { from: e.now() - 30 * 86_400_000, to: e.now() }];
  let found = false;
  for (const r of ranges) {
    for (const groupBy of ["signature", "pattern"] as IssueGroupBy[]) {
      const hit = analyze({ from: r.from, to: r.to, groupBy }).issues.find((i) => i.id === id);
      if (hit) {
        meta = { severity: hit.severity, score: hit.score, title: hit.title };
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) throw notFound({ key: "domain.issueNotFound", vars: { id } });
  return patchIssueState(id, patch, op, req, meta);
}

// ───────────────────────────────────────── exports ──
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function fileBase(p: IssueQueryParsed): string {
  const date = getEngine()._internal.kstDate(getEngine().now());
  return `bixby-issue-report_${date}${p.range.preset !== "today" ? "_" + p.range.preset : ""}`;
}

function download(body: string, filename: string, type: string, extra: Record<string, string> = {}): Response {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
      ...extra,
    },
  });
}

/** GET /issues/export.csv — every issue matching the filters (no paging), reasons localized. */
export function issuesCsv(req: NextRequest): Response {
  const p = parseIssueQuery(req);
  const a = analysisFor(p);
  const issues = filteredIssues(a, p);
  const t = tFor(req, "issues");
  const cols = [
    "rank", "issue_id", "severity", "score", "severity_class", "status", "owner", "ticket_id", "title", "agent_function", "intent_expected", "intent_predicted", "failure_reason",
    "count", "share_pct", "fail_rate_pct", "baseline_rate_pct", "delta_pp", "novelty", "languages", "markets", "devices", "model_versions", "first_seen", "last_seen",
    ...FACTOR_KEYS.map((k) => `factor_${k}`), "top_pattern", "sample_utterance", "sample_judge_reason", "reasons",
  ];
  const iso = getEngine()._internal.isoKst;
  const lines = [cols.join(",")];
  for (const i of issues) {
    const row = [
      i.rank, i.id, i.severity, i.score, i.severity_class, i.state.status, i.state.owner ?? "", i.state.ticket_id ?? "", formatIssueText(t, i.title), i.signature.agent_function, i.signature.intent_expected, i.signature.intent_predicted,
      i.signature.failure_reason, i.count, i.share, i.fail_rate, i.baseline_rate ?? "", i.delta ?? "", i.novelty, i.languages.join(" "), i.markets.join(" "), i.devices.join(" "), i.model_versions.join(" "),
      iso(i.first_seen), iso(i.last_seen), ...FACTOR_KEYS.map((k) => i.factors.find((f) => f.key === k)?.contribution ?? 0), i.signature.pattern_template, i.sample.utterance_text, i.sample.judge_reason,
      i.reasons.map((r) => formatIssueText(t, r)).join(" | "),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return download("﻿" + lines.join("\r\n") + "\r\n", fileBase(p) + ".csv", "text/csv; charset=utf-8", { "x-row-count": String(issues.length), "x-range-from": p.range.fromIso, "x-range-to": p.range.toIso });
}

/** GET /issues/report.md — Markdown summary (KPIs, top issues + reasons, insights, new patterns, triage). */
export function issuesMarkdown(req: NextRequest): Response {
  const p = parseIssueQuery(req);
  const a = analysisFor(p);
  const issues = filteredIssues(a, { ...p, sort: "score_desc" });
  const t = tFor(req, "issues");
  const insights = buildInsights(a, p);
  const pats = patternsOf(a);
  const fails = a.fails.length;
  const fr = rate(fails, a.rows.length);
  const bfr = rate(a.baseRows.filter((r) => r.result === "FAIL").length, a.baseRows.length);
  const iso = getEngine()._internal.isoKst;
  const sev = (s: IssueSeverity) => issues.filter((i) => i.severity === s).length;
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  // absolute evidence links that keep the request's range (a pasted report stays drillable)
  const sp = req.nextUrl.searchParams;
  const rangeParams: Record<string, string> = {};
  for (const k of ["range", "from", "to"]) {
    const v = sp.get(k);
    if (v) rangeParams[k] = v;
  }
  const origin = req.nextUrl.origin;
  const href = (path: string, params: Record<string, string>) => `${origin}${path}?${new URLSearchParams({ ...params, ...rangeParams }).toString()}`;
  const rowFilter = rowFilterParams(p.filters);
  // optional `issue_base` (a console page that opens ?issue=<id>, e.g. /issues/a); without it no issue links
  const issueBase = /^\/issues(\/[a-z])?$/.test(sp.get("issue_base") ?? "") ? sp.get("issue_base")! : null;
  const issueHref = (id: string) => (issueBase ? href(issueBase, { ...rowFilter, issue: id }) : null);
  const resultsHref = (q: Record<string, string>) => href("/results", q);
  const linksOf = (i: Issue) => [`[${t("report.failRows")}](${resultsHref(i.results_query)})`, ...(issueHref(i.id) ? [`[${t("report.issueLink")}](${issueHref(i.id)})`] : [])].join(" · ");
  const L: string[] = [];
  L.push(`# ${t("report.title")}`, "");
  L.push(`- ${t("report.range")}: ${p.range.label} (${p.range.fromIso} ~ ${p.range.toIso})`);
  L.push(`- ${t("report.baseline")}: ${t(`baseline.mode.${a.baseline.mode}` as never)} · ${iso(a.baseline.from).slice(0, 16)} ~ ${iso(a.baseline.to).slice(0, 16)} (${a.baseline.days}d)`);
  const active = Object.entries(p.filters).map(([k, v]) => `${t(`column.${k}` as never)}=${(v ?? []).join(",")}`);
  if (active.length) L.push(`- ${t("report.filters")}: ${active.join(" · ")}`);
  L.push(`- ${t("report.generated")}: ${iso(getEngine().now())}`, "");
  L.push(`## ${t("report.kpis")}`, "");
  L.push(`| ${t("kpi.utterances")} | ${t("kpi.fails")} | ${t("kpi.failRate")} | ${t("kpi.baselineFailRate")} | ${t("kpi.issues")} | P0 | P1 | ${t("kpi.newPatterns")} |`);
  L.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
  L.push(`| ${a.rows.length} | ${fails} | ${fr ?? "-"}% | ${bfr ?? "-"}% | ${issues.length} | ${sev("P0")} | ${sev("P1")} | ${pats.items.length} |`, "");
  L.push(`## ${t("report.insights")}`, "");
  for (const x of insights.slice(0, 8)) L.push(`- **${x.severity}** ${formatIssueText(t, { key: x.key, vars: x.vars })} — [${t("report.evidence")}](${resultsHref(x.evidence.results ?? { result: "FAIL", ...x.evidence.filter })})`);
  L.push("", `## ${t("report.topIssues")}`, "");
  L.push(`| # | ${t("field.severity")} | ${t("field.score")} | ${t("field.issue")} | ${t("field.count")} | ${t("field.failRate")} | ${t("field.status")} | ${t("report.links")} |`);
  L.push("|---:|---|---:|---|---:|---:|---|---|");
  const top = issues.slice(0, 10);
  for (const i of top) L.push(`| ${i.rank} | ${i.severity} | ${i.score} | ${esc(formatIssueText(t, i.title))} | ${i.count} | ${i.fail_rate}% | ${i.state.status}${i.state.ticket_id ? " " + i.state.ticket_id : ""} | ${linksOf(i)} |`);
  L.push("");
  for (const i of top.filter((x) => x.severity === "P0" || x.severity === "P1")) {
    L.push(`### ${i.severity} · ${esc(formatIssueText(t, i.title))}`, "");
    L.push(`- \`${i.id}\` · ${t(`agentFunction.${i.signature.agent_function}` as never)} · ${i.signature.intent_expected} → ${i.signature.intent_predicted} · ${i.signature.failure_reason}`);
    L.push(`- ${t("report.why")}: ${i.reasons.map((r) => formatIssueText(t, r)).join(" / ")}`);
    L.push(`- ${t("report.factors")}: ${i.factors.map((f) => `${t(`factor.${f.key}.label` as never)} ${f.contribution}/${f.weight}`).join(" · ")}`);
    L.push(`- ${t("report.example")}: "${esc(i.sample.utterance_text)}" → "${esc(i.sample.actual_response)}" (${esc(i.sample.judge_reason)})`);
    L.push(`- ${t("report.evidence")}: ${linksOf(i)}`, "");
  }
  if (pats.items.length) {
    L.push(`## ${t("report.newPatterns")}`, "");
    L.push(`| ${t("field.pattern")} | ${t("field.kind")} | ${t("field.function")} | ${t("field.count")} | ${t("field.failRate")} |`);
    L.push("|---|---|---|---:|---:|");
    for (const x of pats.items.slice(0, 10)) L.push(`| [${esc(x.template)}](${resultsHref({ ...resultsParams(p.filters, {}), utterance_pattern: x.id })}) | ${t(`patternKind.${x.kind}` as never)} | ${t(`agentFunction.${x.agent_function}` as never)} | ${x.count} | ${x.fail_rate}% |`);
    L.push("");
  }
  L.push(`## ${t("report.triage")}`, "");
  L.push(ISSUE_STATUSES.map((s) => `${s} ${issues.filter((i) => i.state.status === s).length}`).join(" · "), "");
  const md = L.join("\n");
  return download(md, fileBase(p) + ".md", "text/markdown; charset=utf-8");
}

// ───────────────────────────────────────── new-critical watcher (SSE `issue`) ──
const W = globalThis as unknown as { __aipoIssueWatch?: { engine: unknown; off: () => void; last: number } };

/** Recompute today's default ranking after Workflows succeed (throttled) so new P0/P1 issues are announced. */
export function ensureIssueWatcher(): void {
  const e = getEngine();
  if (W.__aipoIssueWatch?.engine === e) return;
  W.__aipoIssueWatch?.off();
  const state = { engine: e as unknown, off: () => {}, last: 0 };
  const cb = (payload: { to?: string }) => {
    if (payload?.to !== "SUCCEEDED") return;
    const now = Date.now();
    if (now - state.last < 15_000) return;
    state.last = now;
    try {
      const v = getEngine().now();
      analyze({ from: getEngine()._internal.kstDayStart(v), to: v, announce: true });
    } catch (err) {
      console.error("[issues] watcher", err);
    }
  };
  state.off = e.on("transition", cb as never);
  W.__aipoIssueWatch = state;
  // prime the announced set
  const v = e.now();
  analyze({ from: e._internal.kstDayStart(v), to: v, announce: true });
}
