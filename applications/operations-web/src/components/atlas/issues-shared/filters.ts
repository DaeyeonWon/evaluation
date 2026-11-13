"use client";
/**
 * Issue Report — URL state for every R4 filter + the global range. SHARED: owned by the data/platform
 * engineer; candidates A/B/C import it and must not edit it.
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
 */
import { useCallback, useMemo } from "react";
import { parseAsInt, parseAsList, parseAsString, useQueryStates, useTimeRange, type IssueQuery } from "@/lib/client";
import type { IssueColumn, IssueGroupBy } from "@/lib/types";

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
export type IssueListFilter = IssueColumn | (typeof ISSUE_LEVEL_FILTERS)[number];
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
  q: parseAsString,
  min_score: parseAsInt,
  group_by: parseAsString.withDefault("signature"),
  sort: parseAsString.withDefault("score_desc"),
  page: parseAsInt.withDefault(1),
  issue: parseAsString,
};

export type IssueFilterValues = {
  [K in IssueListFilter]: string[];
} & { q: string | null; min_score: number | null; group_by: IssueGroupBy; sort: IssueSort; page: number; issue: string | null };

export function useIssueFilters() {
  const tr = useTimeRange();
  const [raw, setRaw] = useQueryStates(PARSERS);
  const values = raw as unknown as IssueFilterValues;

  /** filters only (no page/selection) — the analysis input */
  const filterQuery = useMemo<IssueQuery>(() => {
    const q: IssueQuery = { ...tr.params };
    for (const k of [...ISSUE_COLUMNS, ...ISSUE_LEVEL_FILTERS]) if (values[k].length) q[k] = values[k];
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
    const clear: Record<string, unknown> = { q: null, min_score: null };
    for (const k of [...ISSUE_COLUMNS, ...ISSUE_LEVEL_FILTERS]) clear[k] = [];
    set(clear as Partial<IssueFilterValues>);
  }, [set]);
  const select = useCallback((id: string | null) => setRaw({ issue: id } as never, { history: "push" }), [setRaw]);
  const setPage = useCallback((page: number) => setRaw({ page } as never), [setRaw]);

  const activeCount = useMemo(
    () => [...ISSUE_COLUMNS, ...ISSUE_LEVEL_FILTERS].reduce((n, k) => n + values[k].length, 0) + (values.q ? 1 : 0) + (values.min_score != null ? 1 : 0),
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
