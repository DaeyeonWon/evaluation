"use client";
/**
 * Issue Report — URL state for every R4 filter + the global range. SHARED, owned by the framework
 * engineer; every view (issues/triage|categories|analysis|report|detail) and the frame import it.
 * This is the ONLY way views read and write filters (views have no filter UI of their own — the frame's
 * FilterBar writes these params).
 *
 *   const f = useIssueFilters();
 *   f.values.agent_function            // string[]   (URL ?agent_function=device_control,settings)
 *   f.toggle("market", "MX")           // add/remove one value
 *   f.set({ severity: ["P0", "P1"] })  // patch several (resets page)
 *   f.reset()                          // clear every filter (keeps range)
 *   f.query                            // IssueQuery for api.issues*() — range included
 *   f.key                              // stable useApi key part
 *   f.selected / f.select(id)          // ?issue=<id> (drawer / detail selection)
 *
 * URL params: the IssueColumn names (agent_function, capsule, intent, language, market, device,
 * model_version, pipeline, pipeline_version, failure_reason, os_version, one_ui_version), plus severity,
 * status, novelty, severity_class, q, min_score, group_by, sort, page, issue. Range: ?range= / ?from=&to=.
 * Merge dims (lists): division, region, bixby_version (row level), category, user_impact, dev_miss (issue
 * level); must_handle = "true" | "false" | null.
 *
 * Triage view state (NOT filters — links.ts carries them only within Triage):
 *   const tl = useTriageLens();   // tl.lens "user"|"dev" · tl.group (default "severity" = 영향도) · tl.subgroup (default = lens type; null = ?subgroup=none)
 *   tl.setLens("dev")              // also sets must_handle=true when unset (the dev lens default)
 *   tl.setGroup("division"); tl.setSubgroup(null)   // null writes subgroup=none
 */
import { useCallback, useMemo } from "react";
import { parseAsInt, parseAsList, parseAsString, useQueryStates, useTimeRange, type IssueQuery } from "@/lib/client";
import type { IssueColumn, IssueGroupBy } from "@/lib/types";
import { GROUP_DIMS, type GroupDim } from "./dims";

/** Row-level filter columns, in display order. */
export const ISSUE_COLUMNS: IssueColumn[] = [
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
/** Issue-level list filters. */
export const ISSUE_LEVEL_FILTERS = ["severity", "status", "novelty", "severity_class"] as const;
/** Merge dims (multi-select lists): row level (derived from device / market + the bixby_version column) and issue level (taxonomies). */
export const ISSUE_MERGE_ROW_FILTERS = ["division", "region", "bixby_version"] as const;
export const ISSUE_MERGE_ISSUE_FILTERS = ["category", "user_impact", "dev_miss"] as const;
export const ISSUE_MERGE_FILTERS = [...ISSUE_MERGE_ROW_FILTERS, ...ISSUE_MERGE_ISSUE_FILTERS] as const;
export type IssueMergeFilter = (typeof ISSUE_MERGE_FILTERS)[number];
export type IssueListFilter = IssueColumn | (typeof ISSUE_LEVEL_FILTERS)[number] | IssueMergeFilter;
/** every multi-select list param, in display order */
export const ISSUE_LIST_FILTERS: IssueListFilter[] = [...ISSUE_COLUMNS, ...ISSUE_MERGE_FILTERS, ...ISSUE_LEVEL_FILTERS];
export const ISSUE_SORTS = ["score_desc", "count_desc", "fail_rate_desc", "delta_desc", "recent_desc", "first_seen_desc"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

const PARSERS = {
  agent_function: parseAsList,
  capsule: parseAsList,
  intent: parseAsList,
  language: parseAsList,
  market: parseAsList,
  device: parseAsList,
  model_version: parseAsList,
  pipeline: parseAsList,
  pipeline_version: parseAsList,
  failure_reason: parseAsList,
  os_version: parseAsList,
  one_ui_version: parseAsList,
  severity: parseAsList,
  status: parseAsList,
  novelty: parseAsList,
  severity_class: parseAsList,
  division: parseAsList,
  region: parseAsList,
  bixby_version: parseAsList,
  category: parseAsList,
  user_impact: parseAsList,
  dev_miss: parseAsList,
  must_handle: parseAsString,
  q: parseAsString,
  min_score: parseAsInt,
  group_by: parseAsString.withDefault("signature"),
  sort: parseAsString.withDefault("score_desc"),
  page: parseAsInt.withDefault(1),
  issue: parseAsString,
};

export type IssueFilterValues = {
  [K in IssueListFilter]: string[];
} & { must_handle: "true" | "false" | null; q: string | null; min_score: number | null; group_by: IssueGroupBy; sort: IssueSort; page: number; issue: string | null };

export function useIssueFilters() {
  const tr = useTimeRange();
  const [raw, setRaw] = useQueryStates(PARSERS);
  const values = raw as unknown as IssueFilterValues;

  /** filters only (no page/selection) — the analysis input */
  const filterQuery = useMemo<IssueQuery>(() => {
    const q: IssueQuery = { ...tr.params };
    for (const k of ISSUE_LIST_FILTERS) if (values[k].length) q[k] = values[k];
    if (values.must_handle === "true" || values.must_handle === "false") q.must_handle = values.must_handle;
    if (values.q) q.q = values.q;
    if (values.min_score != null) q.min_score = values.min_score;
    if (values.group_by !== "signature") q.group_by = values.group_by;
    return q;
  }, [tr.params, values]);
  const query = useMemo<IssueQuery>(() => ({ ...filterQuery, ...(values.sort !== "score_desc" ? { sort: values.sort } : {}) }), [filterQuery, values.sort]);
  const key = useMemo(() => JSON.stringify(query), [query]);

  const set = useCallback(
    (patch: Partial<IssueFilterValues>, opts?: { history?: "push" | "replace" }) => setRaw({ page: 1, ...patch } as never, opts),
    [setRaw],
  );
  const toggle = useCallback(
    (k: IssueListFilter, v: string) => {
      const cur = values[k];
      set({ [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<IssueFilterValues>);
    },
    [values, set],
  );
  const only = useCallback((k: IssueListFilter, v: string | null) => set({ [k]: v ? [v] : [] } as Partial<IssueFilterValues>), [set]);
  const reset = useCallback(() => {
    const clear: Record<string, unknown> = { q: null, min_score: null, must_handle: null };
    for (const k of ISSUE_LIST_FILTERS) clear[k] = [];
    set(clear as Partial<IssueFilterValues>);
  }, [set]);
  const select = useCallback((id: string | null) => setRaw({ issue: id } as never, { history: "push" }), [setRaw]);
  const setPage = useCallback((page: number) => setRaw({ page } as never), [setRaw]);

  const activeCount = useMemo(
    () => ISSUE_LIST_FILTERS.reduce((n, k) => n + values[k].length, 0) + (values.q ? 1 : 0) + (values.min_score != null ? 1 : 0) + (values.must_handle ? 1 : 0),
    [values],
  );

  return {
    values,
    /** IssueQuery incl. range + sort (no paging) */
    query,
    /** IssueQuery incl. range, without sort — for summary / facets / insights / patterns */
    filterQuery,
    key,
    range: tr,
    activeCount,
    set,
    toggle,
    only,
    reset,
    selected: values.issue,
    select,
    page: values.page,
    setPage,
  };
}
export type IssueFiltersApi = ReturnType<typeof useIssueFilters>;

// ───────────────────────────────────────── Triage view state ──
export const TRIAGE_LENSES = ["user", "dev"] as const;
export type TriageLens = (typeof TRIAGE_LENSES)[number];
/** Triage-only URL params (links.ts drops them when leaving Triage). */
export const TRIAGE_STATE_PARAMS = ["lens", "group", "subgroup"] as const;
const LENS_PARSERS = { lens: parseAsString, group: parseAsString, subgroup: parseAsString, must_handle: parseAsString, page: parseAsInt.withDefault(1) };
const isGroup = (v: string | null): v is GroupDim => !!v && (GROUP_DIMS as readonly string[]).includes(v);

/**
 * Triage lenses. Both lenses group by the same impact level (severity P0–P3, "영향도 / Impact") by default;
 * the lens decides which type is shown on cards and the default secondary grouping
 * (`typeDim`: user → user_impact, dev → dev_miss).
 *
 * `subgroup` URL contract:
 *   unset            → the lens type (`typeDim`), or null when the group already is the lens type
 *   `subgroup=none`  → null: no secondary grouping (explicit, survives lens switches)
 *   `subgroup=<dim>` → that dim (null when equal to `group`)
 * `setSubgroup(null)` writes `none`; `setSubgroup(typeDim)` clears the param (back to the default).
 */
export const SUBGROUP_NONE = "none";
export function useTriageLens() {
  const [raw, setRaw] = useQueryStates(LENS_PARSERS);
  const lens: TriageLens = raw.lens === "dev" ? "dev" : "user";
  const group: GroupDim = isGroup(raw.group) ? raw.group : "severity";
  const typeDim: "user_impact" | "dev_miss" = lens === "dev" ? "dev_miss" : "user_impact";
  const subgroupNone = raw.subgroup === SUBGROUP_NONE;
  const subgroup: GroupDim | null = subgroupNone ? null : isGroup(raw.subgroup) ? (raw.subgroup !== group ? raw.subgroup : null) : typeDim !== group ? typeDim : null;
  const mustHandle = raw.must_handle;
  const setLens = useCallback(
    (l: TriageLens) =>
      setRaw({ lens: l === "user" ? null : l, ...(l === "dev" && !mustHandle ? { must_handle: "true" } : {}), page: 1 } as never, { history: "push" }),
    [setRaw, mustHandle],
  );
  const setGroup = useCallback((g: GroupDim) => setRaw({ group: g === "severity" ? null : g, page: 1 } as never), [setRaw]);
  const setSubgroup = useCallback(
    (g: GroupDim | null) => setRaw({ subgroup: g === null ? SUBGROUP_NONE : g === typeDim ? null : g, page: 1 } as never),
    [setRaw, typeDim],
  );
  return { lens, group, subgroup, subgroupNone, typeDim, setLens, setGroup, setSubgroup };
}
export type TriageLensApi = ReturnType<typeof useTriageLens>;
