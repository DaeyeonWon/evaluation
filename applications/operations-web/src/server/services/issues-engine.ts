/**
 * Issue Report — analysis engine (server-only). Pure functions over ResultRow[] + a short memo.
 *
 *   analyze({ from, to, filters, groupBy })  → Analysis   (clusters + scores + baseline + novelty)
 *   patternsOf(a)                            → new utterance patterns + novel terms
 *
 * Scoring (docs/data-contract.md "Issue Report"): score = Σ weight_f × value_f, weights sum to 100.
 *   volume     20  ln(1+count) / ln(1+max(40, maxCount))
 *   severity   25  safety 1.0 · policy 0.7 · wrong_action 0.45 · quality 0.2
 *   trend      15  Poisson z of compare-window FAILs vs baseline rate × compare scope volume, z/5 clipped
 *   regression 15  fail-rate increase on the newest model_version / pipeline_version vs the previous one (coexisting rows,
 *                  one-sided z ≥ 1.64): min(1, max(rel/1.5, Δ/0.25pp)) × clamp(z/3, 0.6, 1)
 *   reach      10  0.4·markets/6 + 0.3·devices/5 + 0.3·languages/4
 *   novelty    15  new cluster (absent in baseline) 0.35 + 0.65·novel-pattern share; else 0.7·share
 * Severity: P0 ≥ 60 (or safety with ≥ 3 FAILs and ≥ 45) · P1 ≥ 45 · P2 ≥ 30 · P3 below.
 */
import { LANG_CODES, PIPELINE_VERSIONS } from "@/lib/catalog";
import type {
  AgentFunction,
  FailureReason,
  Issue,
  IssueBaseline,
  IssueColumn,
  IssueFactor,
  IssueFactorKey,
  IssueGroupBy,
  IssueNovelty,
  IssueRegression,
  IssueSeverity,
  IssueText,
  LangCode,
  Market,
  NewPattern,
  NovelTerm,
  ResultRow,
  SeverityClass,
} from "@/lib/types";
import { getEngine } from "../mock/runtime";
import { announceCritical, issueIdOf, issueState } from "./issues-store";
import { hasProductTerm, patternKind, PRODUCT_TERMS, terms as termsOf, tokens } from "./issues-text";

export const FACTOR_WEIGHTS: Record<IssueFactorKey, number> = { volume: 20, severity: 25, trend: 15, regression: 15, reach: 10, novelty: 15 };
export const FACTOR_KEYS: IssueFactorKey[] = ["volume", "severity", "trend", "regression", "reach", "novelty"];
export const CLASS_VALUE: Record<SeverityClass, number> = { safety: 1, policy: 0.7, wrong_action: 0.45, quality: 0.2 };
export const SEVERITIES: IssueSeverity[] = ["P0", "P1", "P2", "P3"];
export const CLASSES: SeverityClass[] = ["safety", "policy", "wrong_action", "quality"];
export const AGENT_FUNCTIONS: AgentFunction[] = [
  "device_control",
  "smartthings_routine",
  "alarm_timer",
  "call_message",
  "media_play",
  "weather",
  "navigation",
  "settings",
  "calendar",
  "general_qa",
  "camera",
  "galaxy_ai_feature",
];
export const MARKETS: Market[] = ["KR", "US", "GB", "JP", "ES", "MX"];
export const FAILURE_REASONS: FailureReason[] = ["INTENT_MISMATCH", "SLOT_ERROR", "RESPONSE_QUALITY", "TIMEOUT", "ASR_ERROR", "POLICY_VIOLATION"];
export const COLUMNS: IssueColumn[] = [
  "agent_function",
  "capsule",
  "intent",
  "language",
  "market",
  "device",
  "model_version",
  "pipeline",
  "pipeline_version",
  "failure_reason",
  "os_version",
  "one_ui_version",
];
export const COLUMN_GET: Record<IssueColumn, (r: ResultRow) => string> = {
  agent_function: (r) => r.agent_function,
  capsule: (r) => r.capsule_id,
  intent: (r) => r.intent_expected,
  language: (r) => r.language,
  market: (r) => r.market,
  device: (r) => r.device_type,
  model_version: (r) => r.model_version,
  pipeline: (r) => r.pipeline_id,
  pipeline_version: (r) => r.pipeline_version,
  failure_reason: (r) => r.failure_reason,
  os_version: (r) => r.os_version,
  one_ui_version: (r) => r.one_ui_version,
};
/** IssueColumn → GET /api/v1/results query param */
export const RESULTS_PARAM: Record<IssueColumn, string> = {
  agent_function: "agent_function",
  capsule: "capsule",
  intent: "intent",
  language: "language",
  market: "market",
  device: "device",
  model_version: "model_version",
  pipeline: "pipeline_id",
  pipeline_version: "version",
  failure_reason: "failure_reason",
  os_version: "os_version",
  one_ui_version: "one_ui_version",
};

export type RowFilters = Partial<Record<IssueColumn, string[]>>;

const H = 3_600_000;
const DAY = 24 * H;
const MIN_BASELINE = 7 * DAY;
const MIN_SUPPORT = 3;
/** release columns a baseline may be relaxed on (see compute) and the minimum baseline rows to keep such a filter */
const RELEASE_COLUMNS: IssueColumn[] = ["model_version", "pipeline", "pipeline_version", "os_version", "one_ui_version"];
const MIN_BASELINE_ROWS = 50;
const MIN_SUPPORT_SEVERE = 2;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// ───────────────────────────────────────── classification ──
const SAFETY_INTENT = /^smartthings\.(door_unlock|door|lock|unlock|gas|oven|garage|window)/;
const ACTION_FNS = new Set<AgentFunction>(["device_control", "smartthings_routine", "alarm_timer", "call_message", "settings", "camera", "calendar", "galaxy_ai_feature"]);
const QUERY_INTENT = /\.(status|device_status|query|read|battery|current|forecast|rain_check|air_quality|eta|traffic|nearby|factoid|chitchat|unit_convert|health|finance)$/;

export function fnOfIntent(intent: string): AgentFunction | null {
  if (/^smartthings\.(scene_run|routine)/.test(intent)) return "smartthings_routine";
  const p = intent.split(".")[0];
  const m: Record<string, AgentFunction> = {
    camera: "camera",
    galaxy_ai: "galaxy_ai_feature",
    smartthings: "device_control",
    alarm: "alarm_timer",
    timer: "alarm_timer",
    call: "call_message",
    message: "call_message",
    music: "media_play",
    settings: "settings",
    calendar: "calendar",
    reminder: "calendar",
    navigation: "navigation",
    weather: "weather",
    qa: "general_qa",
  };
  return m[p] ?? null;
}
const isAction = (intent: string) => {
  const f = fnOfIntent(intent);
  return !!f && ACTION_FNS.has(f) && !QUERY_INTENT.test(intent);
};

export function severityClassOf(fn: AgentFunction, expected: string, predicted: string, reason: FailureReason): SeverityClass {
  if (reason === "POLICY_VIOLATION") return SAFETY_INTENT.test(expected) || fn === "device_control" || fn === "smartthings_routine" ? "safety" : "policy";
  if (SAFETY_INTENT.test(expected) && (reason === "INTENT_MISMATCH" || reason === "SLOT_ERROR")) return "safety";
  if (reason === "SLOT_ERROR" && isAction(expected)) return "wrong_action";
  if ((reason === "INTENT_MISMATCH" || reason === "ASR_ERROR") && predicted !== expected && isAction(predicted)) return "wrong_action";
  return "quality";
}

// ───────────────────────────────────────── baseline ──
export function baselineFor(from: number, to: number): IssueBaseline {
  const e = getEngine();
  const earliest = e.dataWindow().earliest;
  const len = Math.max(1, to - from);
  const want = Math.max(len, MIN_BASELINE);
  const bFrom = from - want;
  const covered = Math.max(0, from - Math.max(bFrom, earliest));
  const coverage = covered / want;
  if (coverage >= 0.5) {
    const f = Math.max(bFrom, earliest);
    return { from: f, to: from, days: r1((from - f) / DAY), mode: "preceding", compare: { from, to }, coverage: r3(coverage), sufficient: true };
  }
  if (len >= 14 * DAY) {
    const cFrom = to - 7 * DAY;
    const f = Math.max(from, earliest);
    return { from: f, to: cFrom, days: r1((cFrom - f) / DAY), mode: "intra_range", compare: { from: cFrom, to }, coverage: 1, sufficient: true };
  }
  const f = Math.max(bFrom, earliest);
  return { from: f, to: from, days: r1(Math.max(0, from - f) / DAY), mode: "preceding", compare: { from, to }, coverage: r3(coverage), sufficient: coverage >= 0.25 };
}

// ───────────────────────────────────────── buckets ──
export interface Buckets {
  bucket: "hour" | "day";
  starts: number[];
  index(t: number): number;
}
export function bucketsFor(from: number, to: number): Buckets {
  const e = getEngine();
  if (to - from <= 48 * H) {
    const s0 = Math.floor(from / H) * H;
    const n = Math.max(1, Math.ceil((to - s0) / H));
    const starts = Array.from({ length: n }, (_, i) => s0 + i * H);
    return { bucket: "hour", starts, index: (t) => clamp(Math.floor((t - s0) / H), 0, n - 1) };
  }
  const s0 = e._internal.kstDayStart(from);
  const n = Math.max(1, Math.ceil((to - s0) / DAY));
  const starts = Array.from({ length: n }, (_, i) => s0 + i * DAY);
  return { bucket: "day", starts, index: (t) => clamp(Math.floor((t - s0) / DAY), 0, n - 1) };
}

// ───────────────────────────────────────── analysis ──
export interface Cluster {
  id: string;
  key: string;
  fn: AgentFunction;
  expected: string;
  predicted: string;
  reason: FailureReason;
  pattern: string | null;
  rows: ResultRow[];
}

export interface Analysis {
  from: number;
  to: number;
  groupBy: IssueGroupBy;
  filters: RowFilters;
  baseline: IssueBaseline;
  buckets: Buckets;
  rows: ResultRow[];
  baseRows: ResultRow[];
  fails: ResultRow[];
  /** every cluster above min support, ranked (no issue-level filters) */
  issues: Issue[];
  clusters: Map<string, Cluster>;
  novelPatterns: Set<string>;
  basePatternCount: Map<string, number>;
  /** utterance_id → issue id */
  rowIssue: Map<string, string>;
  /** lazily computed */
  _patterns?: { items: NewPattern[]; terms: NovelTerm[] };
}

export function rowMatches(r: ResultRow, f: RowFilters, skip?: IssueColumn): boolean {
  for (const c of COLUMNS) {
    if (c === skip) continue;
    const want = f[c];
    if (want && want.length && !want.includes(COLUMN_GET[c](r))) return false;
  }
  return true;
}

function groupKey(r: ResultRow, g: IssueGroupBy): string {
  const base = `${g}|${r.agent_function}|${r.intent_expected}|${r.intent_predicted}|${r.failure_reason}`;
  return g === "pattern" ? base + "|" + r.utterance_pattern : base;
}

const MEMO = new Map<string, { at: number; a: Analysis }>();
const MEMO_TTL = 3000;

export function analyze(o: { from: number; to: number; filters?: RowFilters; groupBy?: IssueGroupBy; announce?: boolean }): Analysis {
  const filters = o.filters ?? {};
  const groupBy = o.groupBy ?? "signature";
  const e = getEngine();
  const key = `${e.meta.baseNow}|${o.from}|${Math.floor(o.to / 60_000)}|${groupBy}|${JSON.stringify(filters)}`;
  const hit = MEMO.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.a;
  const a = compute(o.from, o.to, filters, groupBy);
  MEMO.set(key, { at: Date.now(), a });
  if (MEMO.size > 24) for (const [k, v] of MEMO) if (Date.now() - v.at > MEMO_TTL || MEMO.size > 24) MEMO.delete(k);
  if (o.announce) announceCritical(a.issues.map((i) => ({ id: i.id, severity: i.severity, score: i.score, title: i.title, status: i.state.status })));
  return a;
}

function releaseTimes(): Record<"model_version" | "pipeline_version", Record<string, number>> {
  const e = getEngine();
  const m: Record<string, number> = {};
  for (const x of e.pipelines.models) m[x.id] = x.releasedTs;
  const p: Record<string, number> = {};
  for (const v of e.config.pipelineVersionDetails ?? []) p[v.version] = typeof v.releasedAt === "number" ? v.releasedAt : Date.parse(String(v.releasedAt));
  return { model_version: m, pipeline_version: p };
}

/** judge reasons quote slot errors as `… "expected" → … "recognized" …`; most frequent pair across the rows */
const SLOT_PAIR = /["“]([^"”]{1,40})["”][^"“→]{0,12}→[^"“]{0,12}["“]([^"”]{1,40})["”]/;
export function slotPairOf(rows: Pick<ResultRow, "judge_reason">[]): { want: string; got: string; count: number } | null {
  const m = new Map<string, number>();
  for (const r of rows) {
    const x = SLOT_PAIR.exec(r.judge_reason ?? "");
    if (x && x[1] !== x[2]) m.set(x[1] + "\u0000" + x[2], (m.get(x[1] + "\u0000" + x[2]) ?? 0) + 1);
  }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const [want, got] = top[0].split("\u0000");
  return { want, got, count: top[1] };
}

function versionOrder(axis: "model_version" | "pipeline_version"): string[] {
  if (axis === "pipeline_version") return [...PIPELINE_VERSIONS];
  return [...getEngine().pipelines.models].sort((x, y) => x.releasedTs - y.releasedTs).map((m) => m.id);
}

function compute(from: number, to: number, filters: RowFilters, groupBy: IssueGroupBy): Analysis {
  const e = getEngine();
  let baseline = baselineFor(from, to);
  const buckets = bucketsFor(from, to);
  const rows = e.results.rowsInRange(from, to).filter((r) => rowMatches(r, filters));
  let baseRows: ResultRow[] = [];
  if (baseline.sufficient) {
    // a release filter (model / pipeline / version / OS) whose values (almost) did not exist in the baseline
    // window would empty the baseline and make every cluster "new": compare against the window without it.
    const baseAll = e.results.rowsInRange(baseline.from, baseline.to - 1);
    const relaxed: IssueColumn[] = [];
    for (const c of RELEASE_COLUMNS) {
      const want = filters[c];
      if (!want?.length) continue;
      let n = 0;
      for (const r of baseAll) if (want.includes(COLUMN_GET[c](r)) && rowMatches(r, filters, c)) n++;
      if (n < MIN_BASELINE_ROWS) relaxed.push(c);
    }
    const bf: RowFilters = { ...filters };
    for (const c of relaxed) delete bf[c];
    baseRows = baseAll.filter((r) => rowMatches(r, bf));
    if (relaxed.length) baseline = { ...baseline, relaxed_columns: relaxed };
  }
  const cmpFrom = baseline.compare.from;
  // when the baseline is intra-range its rows are part of `rows`; trend/novelty only use the compare window
  const inCmp = (r: ResultRow) => r.eval_ts >= cmpFrom;

  // regression compares versions only while both run: rows since the newest version on each axis was released
  const relTs = releaseTimes();
  const newestOf = (axis: "model_version" | "pipeline_version") => {
    const present = new Set(rows.map((r) => r[axis]));
    const ord = versionOrder(axis).filter((v) => present.has(v));
    return ord.length ? (relTs[axis][ord[ord.length - 1]] ?? 0) : 0;
  };
  const coexist = { m: newestOf("model_version"), p: newestOf("pipeline_version") };
  const scope = new Map<string, number>();
  const scopeCmp = new Map<string, number>();
  const scopeBase = new Map<string, number>();
  const scopeVer = new Map<string, number>();
  const marketTotals = new Map<string, number>();
  const deviceTotals = new Map<string, number>();
  const oneUiTotals = new Map<string, number>();
  for (const r of rows) {
    scope.set(r.intent_expected, (scope.get(r.intent_expected) ?? 0) + 1);
    if (inCmp(r)) scopeCmp.set(r.intent_expected, (scopeCmp.get(r.intent_expected) ?? 0) + 1);
    if (r.eval_ts >= coexist.m) {
      const km = `${r.intent_expected}|m|${r.model_version}`;
      scopeVer.set(km, (scopeVer.get(km) ?? 0) + 1);
    }
    if (r.eval_ts >= coexist.p) {
      const kp = `${r.intent_expected}|p|${r.pipeline_version}`;
      scopeVer.set(kp, (scopeVer.get(kp) ?? 0) + 1);
    }
    marketTotals.set(r.market, (marketTotals.get(r.market) ?? 0) + 1);
    deviceTotals.set(r.device_type, (deviceTotals.get(r.device_type) ?? 0) + 1);
    oneUiTotals.set(r.one_ui_version, (oneUiTotals.get(r.one_ui_version) ?? 0) + 1);
  }
  const baseClusterCount = new Map<string, number>();
  const basePatternCount = new Map<string, number>();
  for (const r of baseRows) {
    scopeBase.set(r.intent_expected, (scopeBase.get(r.intent_expected) ?? 0) + 1);
    basePatternCount.set(r.utterance_pattern, (basePatternCount.get(r.utterance_pattern) ?? 0) + 1);
    if (r.result === "FAIL") {
      const k = groupKey(r, groupBy);
      baseClusterCount.set(k, (baseClusterCount.get(k) ?? 0) + 1);
    }
  }
  const novelPatterns = new Set<string>();
  if (baseline.sufficient) for (const r of rows) if (inCmp(r) && !basePatternCount.has(r.utterance_pattern)) novelPatterns.add(r.utterance_pattern);

  const fails = rows.filter((r) => r.result === "FAIL");
  const clusters = new Map<string, Cluster>();
  for (const r of fails) {
    const k = groupKey(r, groupBy);
    let c = clusters.get(k);
    if (!c) {
      c = { id: issueIdOf(k), key: k, fn: r.agent_function, expected: r.intent_expected, predicted: r.intent_predicted, reason: r.failure_reason as FailureReason, pattern: groupBy === "pattern" ? r.utterance_pattern : null, rows: [] };
      clusters.set(k, c);
    }
    c.rows.push(r);
  }
  for (const [k, c] of clusters) {
    const cls = severityClassOf(c.fn, c.expected, c.predicted, c.reason);
    const min = cls === "safety" || cls === "policy" ? MIN_SUPPORT_SEVERE : MIN_SUPPORT;
    if (c.rows.length < min) clusters.delete(k);
  }
  const maxCount = Math.max(40, ...[...clusters.values()].map((c) => c.rows.length));
  const patternsReg = e.results.patterns();
  const totalFails = fails.length || 1;

  const issues: Issue[] = [];
  for (const c of clusters.values()) {
    const n = c.rows.length;
    const cls = severityClassOf(c.fn, c.expected, c.predicted, c.reason);
    const langs = new Set<LangCode>();
    const markets = new Map<string, number>();
    const devices = new Map<string, number>();
    const oneUi = new Map<string, number>();
    const models = new Set<string>();
    const pats = new Map<string, number>();
    const verCount = new Map<string, number>();
    const spark = new Array(buckets.starts.length).fill(0);
    let first = Infinity,
      last = 0,
      cmpCount = 0,
      cmpNovel = 0;
    for (const r of c.rows) {
      langs.add(r.language);
      markets.set(r.market, (markets.get(r.market) ?? 0) + 1);
      devices.set(r.device_type, (devices.get(r.device_type) ?? 0) + 1);
      oneUi.set(r.one_ui_version, (oneUi.get(r.one_ui_version) ?? 0) + 1);
      models.add(r.model_version);
      pats.set(r.utterance_pattern, (pats.get(r.utterance_pattern) ?? 0) + 1);
      if (r.eval_ts >= coexist.m) verCount.set(`m|${r.model_version}`, (verCount.get(`m|${r.model_version}`) ?? 0) + 1);
      if (r.eval_ts >= coexist.p) verCount.set(`p|${r.pipeline_version}`, (verCount.get(`p|${r.pipeline_version}`) ?? 0) + 1);
      spark[buckets.index(r.eval_ts)]++;
      if (r.eval_ts < first) first = r.eval_ts;
      if (r.eval_ts > last) last = r.eval_ts;
      if (inCmp(r)) {
        cmpCount++;
        if (novelPatterns.has(r.utterance_pattern)) cmpNovel++;
      }
    }
    const scopeTotal = scope.get(c.expected) ?? n;
    const baseCount = baseClusterCount.get(c.key) ?? 0;
    const baseScope = scopeBase.get(c.expected) ?? 0;
    const baseRate = baseScope > 0 ? baseCount / baseScope : null;
    const failRate = n / scopeTotal;

    // volume
    const vVolume = clamp(Math.log(1 + n) / Math.log(1 + maxCount), 0, 1);
    // severity
    const vSeverity = CLASS_VALUE[cls];
    // trend (Poisson z on the compare window)
    const cmpScope = scopeCmp.get(c.expected) ?? 0;
    // +1 smoothing: a cluster that happens to have 0 baseline FAILs in a sparse baseline is not an automatic spike
    const expected = Math.max(0.5, baseScope > 0 ? ((baseCount + 1) / (baseScope + 1)) * cmpScope : 0.5);
    const z = baseline.sufficient ? (cmpCount - expected) / Math.sqrt(expected) : 0;
    const vTrend = baseline.sufficient ? clamp(z / 5, 0, 1) : 0;
    // regression
    let regression: IssueRegression | null = null;
    let vReg = 0;
    let regZ = 0;
    // when no axis qualifies, the closest candidate and why it was rejected (shown instead of a bare 0)
    const rm: { v: { axis: "model_version" | "pipeline_version"; why: "insufficient_sample" | "not_significant" | "no_increase"; current: string; previous: string; current_rate: number; previous_rate: number; diff: number } | null } = { v: null };
    for (const axis of ["model_version", "pipeline_version"] as const) {
      const tag = axis === "model_version" ? "m" : "p";
      const ord = versionOrder(axis).filter((v) => (scopeVer.get(`${c.expected}|${tag}|${v}`) ?? 0) > 0);
      const present = ord.filter((v) => (scopeVer.get(`${c.expected}|${tag}|${v}`) ?? 0) >= 6);
      if (present.length < 2) {
        if (ord.length >= 2 && !rm.v) {
          const [pv, cv] = ord.slice(-2);
          const ct0 = scopeVer.get(`${c.expected}|${tag}|${cv}`)!;
          const pt0 = scopeVer.get(`${c.expected}|${tag}|${pv}`)!;
          const rc0 = (verCount.get(`${tag}|${cv}`) ?? 0) / ct0;
          const rp0 = (verCount.get(`${tag}|${pv}`) ?? 0) / pt0;
          rm.v = { axis, why: "insufficient_sample", current: cv, previous: pv, current_rate: r1(rc0 * 100), previous_rate: r1(rp0 * 100), diff: rc0 - rp0 };
        }
        continue;
      }
      const cur = present[present.length - 1];
      const prev = present[present.length - 2];
      const ct = scopeVer.get(`${c.expected}|${tag}|${cur}`)!;
      const pt = scopeVer.get(`${c.expected}|${tag}|${prev}`)!;
      const cc = verCount.get(`${tag}|${cur}`) ?? 0;
      const pc = verCount.get(`${tag}|${prev}`) ?? 0;
      const rc = cc / ct;
      const rp = pc / pt;
      const diff = rc - rp;
      const miss = (why: "insufficient_sample" | "not_significant" | "no_increase") => {
        if (!rm.v || rm.v.why === "insufficient_sample" || diff > rm.v.diff) rm.v = { axis, why, current: cur, previous: prev, current_rate: r1(rc * 100), previous_rate: r1(rp * 100), diff };
      };
      if (diff <= 0.01) {
        miss("no_increase");
        continue;
      }
      if (cc < 3) {
        miss("insufficient_sample");
        continue;
      }
      // two-proportion z-test: small samples that differ by chance do not count as a regression
      const pool = (cc + pc) / (ct + pt);
      const se = Math.sqrt(Math.max(1e-9, pool * (1 - pool) * (1 / ct + 1 / pt)));
      const zr = diff / se;
      if (zr < 1.64) {
        miss("not_significant"); // one-sided 95 %
        continue;
      }
      // magnitude saturates at a 2.5× relative increase or +25 pp, whichever comes first; a barely
      // significant result keeps 60 % of it, z ≥ 3 keeps all of it
      const v = clamp(Math.max(diff / Math.max(rp, 0.02) / 1.5, diff / 0.25), 0, 1) * clamp(zr / 3, 0.6, 1);
      if (v > vReg) {
        vReg = v;
        regZ = zr;
        regression = { axis, current: cur, previous: prev, currentRate: r1(rc * 100), previousRate: r1(rp * 100), currentTotal: ct, previousTotal: pt };
      }
    }
    // reach
    const vReach = clamp(0.4 * (markets.size / MARKETS.length) + 0.3 * (devices.size / 5) + 0.3 * (langs.size / LANG_CODES.length), 0, 1);
    // novelty
    const novelShare = cmpCount ? cmpNovel / cmpCount : 0;
    // new = intent never seen in the baseline, or 0 baseline FAILs where the baseline volume would have shown ≥ 1.5
    const isNew = baseline.sufficient && baseCount === 0 && (baseScope === 0 || cmpScope / (baseScope + 1) < 1.5);
    const vNovelty = baseline.sufficient ? (isNew ? 0.35 + 0.65 * novelShare : 0.7 * novelShare) : 0;

    const values: Record<IssueFactorKey, number> = { volume: vVolume, severity: vSeverity, trend: vTrend, regression: vReg, reach: vReach, novelty: vNovelty };
    const details: Record<IssueFactorKey, Record<string, string | number | null>> = {
      volume: { count: n, share: pct(n, totalFails), max: maxCount },
      severity: { cls, failure_reason: c.reason },
      trend: { z: r1(z), observed: cmpCount, expected: r1(expected), baseline_count: baseCount, baseline_rate: baseRate == null ? null : r1(baseRate * 100) },
      regression: regression
        ? { axis: regression.axis, current: regression.current, previous: regression.previous, current_rate: regression.currentRate, previous_rate: regression.previousRate, z: r1(regZ) }
        : rm.v
          ? { axis: null, why: rm.v.why, candidate_axis: rm.v.axis, current: rm.v.current, previous: rm.v.previous, current_rate: rm.v.current_rate, previous_rate: rm.v.previous_rate }
          : { axis: null },
      reach: { markets: markets.size, devices: devices.size, languages: langs.size },
      novelty: { new_cluster: isNew ? 1 : 0, novel_share: pct(cmpNovel, cmpCount) },
    };
    const factors: IssueFactor[] = FACTOR_KEYS.map((k) => ({ key: k, weight: FACTOR_WEIGHTS[k], value: r3(values[k]), contribution: r1(values[k] * FACTOR_WEIGHTS[k]), detail: details[k] }));
    const score = r1(factors.reduce((s, f) => s + values[f.key] * f.weight, 0));
    let severity: IssueSeverity = score >= 60 ? "P0" : score >= 45 ? "P1" : score >= 30 ? "P2" : "P3";
    // floors: safety with ≥ 3 FAILs is at least P1 (P0 from 45), policy with ≥ 5 FAILs at least P1
    if (cls === "safety" && n >= 3) severity = score >= 45 ? "P0" : "P1";
    else if (cls === "policy" && n >= 5 && (severity === "P2" || severity === "P3")) severity = "P1";

    // reasons (most important first)
    const reasons: { w: number; t: IssueText }[] = [];
    const fvars = { fn: c.fn, expected: c.expected, predicted: c.predicted, reason: c.reason };
    if (cls === "safety") reasons.push({ w: 100, t: { key: "reasons.safety", vars: { intent: c.expected, reason: c.reason } } });
    else if (cls === "policy") reasons.push({ w: 90, t: { key: "reasons.policy", vars: { intent: c.expected } } });
    else if (cls === "wrong_action" && c.predicted === c.expected) {
      // right action, wrong value (SLOT_ERROR): name the most frequent expected → recognized value pair
      const sp = slotPairOf(c.rows);
      reasons.push({
        w: values.severity * 25,
        t: sp ? { key: "reasons.wrongSlot", vars: { intent: c.expected, want: sp.want, got: sp.got, pairs: sp.count, count: n } } : { key: "reasons.wrongSlotNoPair", vars: { intent: c.expected, count: n } },
      });
    } else if (cls === "wrong_action") reasons.push({ w: values.severity * 25, t: { key: "reasons.wrongAction", vars: { expected: c.expected, predicted: c.predicted } } });
    if (regression && vReg >= 0.15) reasons.push({ w: vReg * 15 + 5, t: { key: "reasons.regression", vars: { axis: regression.axis, current: regression.current, previous: regression.previous, curRate: regression.currentRate, prevRate: regression.previousRate } } });
    if (baseline.sufficient && z >= 3) {
      if (isNew) reasons.push({ w: vTrend * 15 + 2, t: { key: "reasons.newCluster", vars: { count: cmpCount, days: baseline.days } } });
      else reasons.push({ w: vTrend * 15, t: { key: "reasons.spike", vars: { z: r1(z), observed: cmpCount, expected: r1(expected), ratio: r1(cmpCount / expected) } } });
    }
    if (novelShare >= 0.5) {
      const top = [...pats.entries()].filter(([p]) => novelPatterns.has(p)).sort((x, y) => y[1] - x[1])[0];
      reasons.push({ w: vNovelty * 15 + 1, t: { key: "reasons.novelPattern", vars: { share: pct(cmpNovel, cmpCount), template: top ? (patternsReg[top[0]]?.template ?? top[0]) : "" } } });
    }
    // concentration on one device / One UI / market that is not dominant overall
    if (n >= 5) {
      const conc: [IssueColumn, Map<string, number>, Map<string, number>][] = [
        ["one_ui_version", oneUi, oneUiTotals],
        ["device", devices, deviceTotals],
        ["market", markets, marketTotals],
      ];
      for (const [col, m, tot] of conc) {
        const [v, k] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
        const share = k / n;
        const overall = (tot.get(v) ?? 0) / Math.max(1, rows.length);
        if (share >= 0.8 && overall < 0.5) {
          reasons.push({ w: 6 + share * 4, t: { key: "reasons.concentration", vars: { column: col, value: v, share: r1(share * 100), overall: r1(overall * 100) } } });
          break;
        }
      }
    }
    if (markets.size >= 2 || devices.size >= 4) reasons.push({ w: vReach * 10, t: { key: "reasons.reach", vars: { markets: markets.size, devices: devices.size, languages: langs.size, list: [...markets.keys()].join(", ") } } });
    if (n >= 15 || n / totalFails >= 0.02) reasons.push({ w: vVolume * 20 * 0.6, t: { key: "reasons.volume", vars: { count: n, share: pct(n, totalFails), rate: r1(failRate * 100) } } });
    if (!baseline.sufficient) reasons.push({ w: 0, t: { key: "reasons.baselineInsufficient", vars: { days: baseline.days } } });
    if (cls === "quality" && reasons.length < 2) reasons.push({ w: 1, t: { key: "reasons.quality", vars: { reason: c.reason } } });
    reasons.sort((x, y) => y.w - x.w);

    const topPat = [...pats.entries()].sort((x, y) => y[1] - x[1]);
    const samp = c.rows.reduce((b, r) => (r.eval_ts > b.eval_ts ? r : b), c.rows[0]);
    const resultsQuery: Record<string, string> = { result: "FAIL", agent_function: c.fn, intent: c.expected, intent_predicted: c.predicted, failure_reason: c.reason };
    if (c.pattern) resultsQuery.utterance_pattern = c.pattern;
    for (const col of COLUMNS) if (filters[col]?.length && !resultsQuery[RESULTS_PARAM[col]]) resultsQuery[RESULTS_PARAM[col]] = filters[col]!.join(",");
    const novelty: IssueNovelty = isNew ? "new" : "recurring";
    const domPattern = c.pattern ?? topPat[0][0];
    issues.push({
      id: c.id,
      rank: 0,
      title: { key: cls === "safety" ? "titles.safety" : `titles.${c.reason}`, vars: fvars },
      signature: {
        agent_function: c.fn,
        intent_expected: c.expected,
        intent_predicted: c.predicted,
        failure_reason: c.reason,
        utterance_pattern: domPattern,
        pattern_template: patternsReg[domPattern]?.template ?? "",
      },
      group_by: groupBy,
      severity,
      severity_class: cls,
      score,
      factors,
      reasons: reasons.slice(0, 6).map((x) => x.t),
      novelty,
      count: n,
      share: pct(n, totalFails),
      scope_total: scopeTotal,
      fail_rate: r1(failRate * 100),
      baseline_count: baseCount,
      baseline_rate: baseRate == null ? null : r1(baseRate * 100),
      delta: baseRate == null ? null : r1((failRate - baseRate) * 100),
      first_seen: first,
      last_seen: last,
      languages: [...langs].sort(),
      markets: [...markets.keys()].sort() as Market[],
      devices: [...devices.entries()].sort((x, y) => y[1] - x[1]).map(([d]) => d),
      model_versions: [...models].sort(),
      spark,
      patterns: topPat.slice(0, 8).map(([id, count]) => ({
        id,
        template: patternsReg[id]?.template ?? id,
        language: (patternsReg[id]?.language ?? samp.language) as LangCode,
        count,
        novel: novelPatterns.has(id),
      })),
      sample: {
        utterance_id: samp.utterance_id,
        utterance_text: samp.utterance_text,
        asr_text: samp.asr_text,
        expected_response: samp.expected_response,
        actual_response: samp.actual_response,
        judge_reason: samp.judge_reason,
        language: samp.language,
        market: samp.market,
        device_type: samp.device_type,
        eval_ts: samp.eval_ts,
      },
      regression,
      state: issueState(c.id),
      results_query: resultsQuery,
    });
  }
  issues.sort((x, y) => y.score - x.score || y.count - x.count || (x.id < y.id ? -1 : 1));
  issues.forEach((i, k) => (i.rank = k + 1));
  const rowIssue = new Map<string, string>();
  for (const c of clusters.values()) for (const r of c.rows) rowIssue.set(r.utterance_id, c.id);
  return { from, to, groupBy, filters, baseline, buckets, rows, baseRows, fails, issues, clusters, novelPatterns, basePatternCount, rowIssue };
}

/** Refresh lifecycle state on cached issues (PATCH changes must show immediately). */
export function withState(i: Issue): Issue {
  return { ...i, state: issueState(i.id) };
}

// ───────────────────────────────────────── new patterns ──
export function patternsOf(a: Analysis): { items: NewPattern[]; terms: NovelTerm[] } {
  if (a._patterns) return a._patterns;
  if (!a.baseline.sufficient) return (a._patterns = { items: [], terms: [] });
  const e = getEngine();
  const reg = e.results.patterns();
  const cmpFrom = a.baseline.compare.from;
  const cmpTo = a.baseline.compare.to;
  const half = cmpFrom + (cmpTo - cmpFrom) / 2;
  const cb = bucketsFor(cmpFrom, cmpTo);
  // baseline term frequencies
  const baseTerms = new Map<string, number>();
  for (const r of a.baseRows) for (const t of tokens(r.utterance_text, r.language)) baseTerms.set(t, (baseTerms.get(t) ?? 0) + 1);
  for (const r of a.baseRows) {
    const p = hasProductTerm(r.utterance_text);
    if (p) baseTerms.set(p, (baseTerms.get(p) ?? 0) + 1);
  }
  const curTerms = new Map<string, { count: number; langs: Set<LangCode>; pats: Set<string> }>();
  interface Acc {
    rows: ResultRow[];
    fails: number;
    h1: number;
    h2: number;
    daily: number[];
    first: number;
    pred: Map<string, number>;
    markets: Set<string>;
    devices: Set<string>;
  }
  const acc = new Map<string, Acc>();
  for (const r of a.rows) {
    if (r.eval_ts < cmpFrom || !a.novelPatterns.has(r.utterance_pattern)) continue;
    let x = acc.get(r.utterance_pattern);
    if (!x) {
      x = { rows: [], fails: 0, h1: 0, h2: 0, daily: new Array(cb.starts.length).fill(0), first: Infinity, pred: new Map(), markets: new Set(), devices: new Set() };
      acc.set(r.utterance_pattern, x);
    }
    x.rows.push(r);
    if (r.result === "FAIL") x.fails++;
    if (r.eval_ts < half) x.h1++;
    else x.h2++;
    x.daily[cb.index(r.eval_ts)]++;
    if (r.eval_ts < x.first) x.first = r.eval_ts;
    x.pred.set(r.intent_predicted, (x.pred.get(r.intent_predicted) ?? 0) + 1);
    x.markets.add(r.market);
    x.devices.add(r.device_type);
    const ts = new Set(tokens(r.utterance_text, r.language));
    const prod = hasProductTerm(r.utterance_text);
    if (prod) ts.add(prod);
    for (const t of ts) {
      if (baseTerms.has(t)) continue;
      let ct = curTerms.get(t);
      if (!ct) curTerms.set(t, (ct = { count: 0, langs: new Set(), pats: new Set() }));
      ct.count++;
      ct.langs.add(r.language);
      ct.pats.add(r.utterance_pattern);
    }
  }
  // established phrasings per intent: baseline patterns of the same intent_expected
  const estByIntent = new Map<string, Map<string, { language: LangCode; template: string; count: number; fails: number; toks: Set<string> }>>();
  for (const r of a.baseRows) {
    let m = estByIntent.get(r.intent_expected);
    if (!m) estByIntent.set(r.intent_expected, (m = new Map()));
    let x = m.get(r.utterance_pattern);
    if (!x) {
      const tpl = reg[r.utterance_pattern]?.template ?? r.utterance_text;
      m.set(r.utterance_pattern, (x = { language: r.language, template: tpl, count: 0, fails: 0, toks: new Set(tokens(tpl.replace(/\{[^}]*\}/g, " "), r.language)) }));
    }
    x.count++;
    if (r.result === "FAIL") x.fails++;
  }
  const establishedFor = (intent: string, lang: LangCode, tpl: string): NonNullable<NewPattern["established"]> => {
    const m = estByIntent.get(intent);
    if (!m) return [];
    const mine = new Set(tokens(tpl.replace(/\{[^}]*\}/g, " "), lang));
    return [...m.entries()]
      .map(([pid, x]) => ({ pid, x, shared: [...x.toks].filter((t) => mine.has(t)) }))
      .sort((u, v) => Number(v.x.language === lang) - Number(u.x.language === lang) || v.shared.length - u.shared.length || v.x.count - u.x.count)
      .slice(0, 3)
      .map(({ pid, x, shared }) => ({ pattern_id: pid, template: x.template, language: x.language, count: x.count, fail_rate: pct(x.fails, x.count), shared_terms: shared }));
  };
  const patIssues = new Map<string, Set<string>>();
  for (const c of a.clusters.values()) for (const r of c.rows) if (a.novelPatterns.has(r.utterance_pattern)) (patIssues.get(r.utterance_pattern) ?? patIssues.set(r.utterance_pattern, new Set()).get(r.utterance_pattern)!).add(c.id);
  const items: NewPattern[] = [];
  for (const [id, x] of acc) {
    if (x.rows.length < 3) continue;
    const p = reg[id];
    const sample = x.rows[x.rows.length - 1];
    const lang = (p?.language ?? sample.language) as LangCode;
    const tset = new Set<string>();
    for (const r of x.rows) for (const t of termsOf(r.utterance_text, r.language)) if ((curTerms.get(t)?.count ?? 0) >= 2) tset.add(t);
    const prod = PRODUCT_TERMS.find((t) => sample.utterance_text.toLowerCase().includes(t));
    if (prod) tset.add(prod);
    const termList = [...tset].sort((u, v) => (curTerms.get(v)?.count ?? 0) - (curTerms.get(u)?.count ?? 0)).slice(0, 6);
    const intent = p?.intent ?? sample.intent_expected;
    const ex = [...x.rows].sort((u, v) => (u.result === v.result ? v.eval_ts - u.eval_ts : u.result === "FAIL" ? -1 : 1)).slice(0, 5);
    items.push({
      id,
      template: p?.template ?? sample.utterance_text,
      language: lang,
      kind: patternKind(sample.utterance_text, lang, intent, termList),
      terms: termList,
      count: x.rows.length,
      baseline_count: a.basePatternCount.get(id) ?? 0,
      growth: x.h1 ? r1(x.h2 / x.h1) : null,
      daily: x.daily,
      daily_t: cb.starts,
      first_seen: x.first,
      fails: x.fails,
      fail_rate: pct(x.fails, x.rows.length),
      agent_function: sample.agent_function,
      intent_expected: intent,
      intents_predicted: [...x.pred.entries()].sort((u, v) => v[1] - u[1]).map(([i, count]) => ({ intent: i, count })),
      markets: [...x.markets].sort() as Market[],
      devices: [...x.devices].sort(),
      examples: ex.map((r) => ({
        utterance_id: r.utterance_id,
        utterance_text: r.utterance_text,
        asr_text: r.asr_text,
        result: r.result,
        failure_reason: r.failure_reason,
        intent_predicted: r.intent_predicted,
        device_type: r.device_type,
        market: r.market,
        actual_response: r.actual_response,
      })),
      issue_ids: [...(patIssues.get(id) ?? [])],
      established: establishedFor(intent, lang, p?.template ?? sample.utterance_text),
    });
  }
  items.sort((u, v) => v.count * (0.3 + v.fail_rate / 100) - u.count * (0.3 + u.fail_rate / 100) || (u.id < v.id ? -1 : 1));
  const terms: NovelTerm[] = [...curTerms.entries()]
    .filter(([, v]) => v.count >= 3)
    .sort((u, v) => v[1].count - u[1].count)
    .slice(0, 40)
    .map(([term, v]) => ({ term, count: v.count, baseline_count: baseTerms.get(term) ?? 0, languages: [...v.langs].sort() as LangCode[], pattern_ids: [...v.pats] }));
  return (a._patterns = { items, terms });
}

export { pct, r1 };
