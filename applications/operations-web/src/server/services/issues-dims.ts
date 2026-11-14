/**
 * Issue Report — dimension registry + aggregations shared by facets, breakdown, matrix and grouped lists
 * (server-only). docs/data-contract.md §8.11.
 *
 * Row dims (IssueColumn) read a result column. Issue-level dims (category, user_impact, dev_miss, must_handle,
 * severity, status, novelty, severity_class) read the FAIL row's issue (rowTag): they do not split PASS rows, so
 * their `total` is every row in scope and `fail_rate` = FAILs of that value / all rows (its share of the FAIL rate).
 *
 * Counted FAILs (`counter`): with no issue-level filter every FAIL row counts. With one, a FAIL row counts when its
 * issue passes the issue filters; rows outside any issue only count for the taxonomy filters (category / user_impact
 * / dev_miss / must_handle) by their row-level tags, never for severity / status / novelty / severity_class / q /
 * min_score. Totals (denominators) never change with issue-level filters.
 */
import { BIXBY_VERSIONS, DIVISIONS, LANG_CODES, REGIONS } from "@/lib/catalog";
import type { Issue, IssueDim, IssueDimStat, IssueSeverity, IssueText, ResultRow } from "@/lib/types";
import { AGENT_FUNCTIONS, CLASSES, COLUMN_GET, COLUMNS, FAILURE_REASONS, MARKETS, SEVERITIES, TAG_DIMS, issueOfRow, r1, rowTag, type Analysis, type TagDim } from "./issues-engine";
import { ISSUE_STATUSES } from "./issues-store";
import { CATEGORIES, DEV_MISSES, USER_IMPACTS, bixbyOrder } from "./issues-taxonomy";

export const OTHER = "__other__";
export const DIMS: IssueDim[] = [...COLUMNS, ...TAG_DIMS];
/** dims accepted by GET /issues?group=&subgroup= */
export const GROUP_DIMS: IssueDim[] = DIMS;

export const isTagDim = (d: IssueDim): d is TagDim => (TAG_DIMS as readonly string[]).includes(d);

/** value of a dim for a row ("" = none: PASS rows on issue-level dims) */
export function dimValue(a: Analysis, r: ResultRow, d: IssueDim): string {
  return isTagDim(d) ? rowTag(a, r, d) : COLUMN_GET[d](r);
}

/** value of a dim for an issue (row dims: the issue's dominant value) */
export function issueDimValue(i: Issue, d: IssueDim): string {
  switch (d) {
    case "severity":
      return i.severity;
    case "status":
      return i.state.status;
    case "novelty":
      return i.novelty;
    case "severity_class":
      return i.severity_class;
    case "category":
      return i.category;
    case "user_impact":
      return i.user_impact_type;
    case "dev_miss":
      return i.dev_miss_type;
    case "must_handle":
      return i.must_handle ? "true" : "false";
    default:
      return i.dominant[d] ?? "";
  }
}

/** fixed value order for enumerated dims (others: by FAIL volume / score) */
export function naturalOrder(d: IssueDim): readonly string[] | null {
  switch (d) {
    case "severity":
      return SEVERITIES;
    case "status":
      return ISSUE_STATUSES;
    case "novelty":
      return ["new", "recurring"];
    case "severity_class":
      return CLASSES;
    case "category":
      return CATEGORIES;
    case "user_impact":
      return USER_IMPACTS;
    case "dev_miss":
      return DEV_MISSES;
    case "must_handle":
      return ["true", "false"];
    case "division":
      return DIVISIONS;
    case "region":
      return REGIONS;
    case "market":
      return MARKETS;
    case "language":
      return LANG_CODES;
    case "agent_function":
      return AGENT_FUNCTIONS;
    case "failure_reason":
      return FAILURE_REASONS;
    case "bixby_version":
      return bixbyOrder(BIXBY_VERSIONS);
    default:
      return null;
  }
}

/** message group (issues namespace) per dim; null → the value is its own label */
const LABEL_GROUP: Partial<Record<IssueDim, string>> = {
  agent_function: "agentFunction",
  market: "market",
  failure_reason: "failureReason",
  severity: "severity",
  status: "status",
  novelty: "novelty",
  severity_class: "severityClass",
  category: "category",
  user_impact: "userImpact",
  dev_miss: "devMiss",
  must_handle: "mustHandleValue",
  division: "division",
  region: "region",
  language: "language",
};
export function dimLabel(d: IssueDim, v: string): IssueText | null {
  if (v === OTHER) return { key: "dimValue.other" };
  const g = LABEL_GROUP[d];
  return g ? { key: `${g}.${v}` } : null;
}

// ───────────────────────────────────────── counted FAILs ──
export interface IssueFilterSpec {
  severity?: IssueSeverity[];
  status?: string[];
  novelty?: string[];
  severity_class?: string[];
  q?: string;
  min_score?: number;
  category?: string[];
  user_impact?: string[];
  dev_miss?: string[];
  must_handle?: boolean;
}
/** null → every FAIL row counts */
export function counter(a: Analysis, f: IssueFilterSpec, matching: Set<string>): ((r: ResultRow) => boolean) | null {
  const pure = !!(f.severity || f.status || f.novelty || f.severity_class || f.q || f.min_score != null);
  const tags = !!(f.category || f.user_impact || f.dev_miss || f.must_handle != null);
  if (!pure && !tags) return null;
  return (r) => {
    const i = issueOfRow(a, r);
    if (i) return matching.has(i.id);
    if (pure) return false;
    if (f.category && !f.category.includes(rowTag(a, r, "category"))) return false;
    if (f.user_impact && !f.user_impact.includes(rowTag(a, r, "user_impact"))) return false;
    if (f.dev_miss && !f.dev_miss.includes(rowTag(a, r, "dev_miss"))) return false;
    if (f.must_handle != null && rowTag(a, r, "must_handle") !== String(f.must_handle)) return false;
    return true;
  };
}

// ───────────────────────────────────────── accumulators ──
export interface Acc {
  t: number;
  f: number;
  bt: number;
  bf: number;
  iss: Map<string, number>;
}
export const acc = (): Acc => ({ t: 0, f: 0, bt: 0, bf: 0, iss: new Map() });
const rate = (f: number, t: number) => (t > 0 ? r1((f / t) * 100) : null);
export function statOf(value: string, x: Acc, tot?: { t: number; bt: number }): IssueDimStat {
  const t = tot ? tot.t : x.t;
  const bt = tot ? tot.bt : x.bt;
  const fr = rate(x.f, t);
  const br = rate(x.bf, bt);
  return { value, total: t, fails: x.f, fail_rate: fr, baseline_total: bt, baseline_fails: x.bf, baseline_fail_rate: br, delta: fr == null || br == null ? null : r1(fr - br), issues: x.iss.size };
}

/** order + cap axis values: natural order for enumerated dims, else by FAILs; beyond `max` fold into OTHER */
export function axisValues(d: IssueDim, fails: Map<string, number>, totals: Map<string, number>, max: number): { values: string[]; fold: Map<string, string>; folded: number } {
  const present = [...new Set([...fails.keys(), ...totals.keys()])].filter((v) => v !== "" && ((fails.get(v) ?? 0) > 0 || (totals.get(v) ?? 0) > 0));
  const byVol = [...present].sort((x, y) => (fails.get(y) ?? 0) - (fails.get(x) ?? 0) || (totals.get(y) ?? 0) - (totals.get(x) ?? 0) || (x < y ? -1 : 1));
  const keep = new Set(byVol.length > max ? byVol.slice(0, Math.max(1, max - 1)) : byVol);
  const nat = naturalOrder(d);
  let values = nat ? [...nat.filter((v) => keep.has(v)), ...byVol.filter((v) => keep.has(v) && !nat.includes(v))] : byVol.filter((v) => keep.has(v));
  const fold = new Map<string, string>();
  let folded = 0;
  for (const v of present) {
    if (keep.has(v)) fold.set(v, v);
    else {
      fold.set(v, OTHER);
      folded++;
    }
  }
  if (folded) values = [...values, OTHER];
  return { values, fold, folded };
}
