"use client";
/**
 * Issue Report — data hooks over /api/v1/issues/*. SHARED by every view (issues/*) and the frame; views do not
 * edit it (ask the framework engineer). Every hook is keyed on the filters + range (useIssueFilters), refetches on the SSE
 * `issue` channel (triage changes, new P0/P1) and every 30 s (new evaluation rows arrive continuously).
 *
 *   const f = useIssueFilters();
 *   const list = useIssues(f);                 // IssueListResponse (paged with f.page, 25 per page)
 *   const sum = useIssueSummary(f);            // KPIs, distributions, matrices, trend, movers
 *   const facets = useIssueFacets(f);          // values + counts for every filter
 *   const ins = useIssueInsights(f);
 *   const pats = useIssuePatterns(f);
 *   const det = useIssue(f.selected, f, { page }); // IssueDetail or null
 *   const { patch, pending } = useIssueActions(); await patch(id, { status: "TRIAGED" });
 *   useIssueLive((m) => toast(...));           // SSE `issue` messages
 *
 * Merge endpoints (shapes in ./contract.ts; a 404 — endpoint not deployed yet — resolves to data: null):
 *   const bd = useIssueBreakdown(f, "division");                              // 분해 보기 cards
 *   const mx = useIssueMatrix(f, { x: "agent_function", y: "region", metric: "fail_rate" });
 *   const gl = useIssueGroups(f, { group: "severity", subgroup: "user_impact" }, { groupSize: 3 }); // + groupKey/subgroupKey/groupPage
 *   const det = useIssueDetail(id, f);                                         // IssueDetailMerge (breakdowns per dim)
 *   issueBreakdowns(det.data)  → [{ dim, stats }] for DETAIL_BREAKDOWN_DIMS that the server returned
 */
import { useCallback, useState } from "react";
import { api, ApiClientError, qs, request, revalidateKey, useApi, useStreamEvent, type IssueQuery } from "@/lib/client";
import type { IssuePatch, IssuePatchResult, IssueStreamMessage } from "@/lib/types";
import type { IssueBreakdownResponse, IssueDetailMerge, IssueDimMatrixResponse, IssueGroupedListResponse } from "./contract";
import { DETAIL_BREAKDOWN_DIMS, type GroupDim, type IssueDimId, type MatrixMetric } from "./dims";
import type { IssueFiltersApi } from "./filters";

const OPTS = { revalidateOn: ["issue" as const], refreshInterval: 30_000 };
const PREFIX = "issues:";

type F = Pick<IssueFiltersApi, "query" | "filterQuery" | "page">;

export function useIssues(f: F, opts: { pageSize?: number; page?: number } = {}) {
  const q: IssueQuery = { ...f.query, page: opts.page ?? f.page, pageSize: opts.pageSize ?? 25 };
  return useApi([PREFIX + "list", q], () => api.issues(q), OPTS);
}

export function useIssueSummary(f: F) {
  return useApi([PREFIX + "summary", f.filterQuery], () => api.issueSummary(f.filterQuery), OPTS);
}

export function useIssueFacets(f: F) {
  return useApi([PREFIX + "facets", f.filterQuery], () => api.issueFacets(f.filterQuery), OPTS);
}

export function useIssueInsights(f: F) {
  return useApi([PREFIX + "insights", f.filterQuery], () => api.issueInsights(f.filterQuery), OPTS);
}

export function useIssuePatterns(f: F, opts: { kind?: string[]; limit?: number } = {}) {
  const q = { ...f.filterQuery, ...(opts.kind?.length ? { kind: opts.kind } : {}), ...(opts.limit ? { limit: opts.limit } : {}) };
  return useApi([PREFIX + "patterns", q], () => api.issuePatterns(q), OPTS);
}

/** Detail of one issue in the current range + row filters (null id → idle). `page` pages its utterances. */
export function useIssue(id: string | null | undefined, f: F, opts: { page?: number; pageSize?: number } = {}) {
  const q: IssueQuery = { ...f.filterQuery, page: opts.page ?? 1, pageSize: opts.pageSize ?? 20 };
  return useApi(id ? [PREFIX + "detail", id, q] : null, () => api.issue(id!, q), OPTS);
}

/** PATCH with automatic refetch of every mounted issues query. Throws ApiClientError (403 for Viewer). */
export function useIssueActions() {
  const [pending, setPending] = useState<string | null>(null);
  const patch = useCallback(async (id: string, body: IssuePatch): Promise<IssuePatchResult> => {
    setPending(id);
    try {
      const r = await api.patchIssue(id, body);
      revalidateKey((k) => k.includes(PREFIX));
      return r;
    } finally {
      setPending(null);
    }
  }, []);
  return { patch, pending };
}

/** Subscribe to SSE `issue` messages (status changes, new P0/P1). */
export function useIssueLive(cb: (m: IssueStreamMessage) => void) {
  useStreamEvent("issue", cb);
}

// ───────────────────────────────────────── merge endpoints ──
/** GET that resolves to null on 404 (endpoint not deployed yet) instead of erroring the view. */
async function getOptional<T>(path: string, q: IssueQuery): Promise<T | null> {
  try {
    return await request<T>(path + qs(q));
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) return null;
    throw e;
  }
}

/** 분해 보기: one item per value of `dim` (GET /issues/breakdown?dim=). */
export function useIssueBreakdown(f: F, dim: IssueDimId | string | null) {
  const q: IssueQuery = { ...f.filterQuery, dim: dim ?? undefined };
  return useApi(dim ? [PREFIX + "breakdown", q] : null, () => getOptional<IssueBreakdownResponse>("/issues/breakdown", q), OPTS);
}

/** Analysis heatmap over any two dims (GET /issues/matrix?x=&y=&metric=). */
export function useIssueMatrix(f: F, opts: { x: IssueDimId | string; y: IssueDimId | string; metric?: MatrixMetric }) {
  const q: IssueQuery = { ...f.filterQuery, x: opts.x, y: opts.y, metric: opts.metric ?? "fail_rate" };
  return useApi(opts.x && opts.y ? [PREFIX + "matrix", q] : null, () => getOptional<IssueDimMatrixResponse>("/issues/matrix", q), OPTS);
}

/**
 * Triage grouped listing (GET /issues?group=&subgroup=&lens=). Before the server groups, `groups` is
 * absent and the view groups `items` client-side.
 *
 * Group paging (opts): `groupSize` = items per group (or per subgroup); "load more" for one group asks for
 * just that group / subgroup with `groupKey` (+ `subgroupKey`) and a larger `groupSize` (or `groupPage`).
 *   useIssueGroups(f, { group: "severity", subgroup: "user_impact" }, { groupSize: 3 })
 *   useIssueGroups(f, { group: "severity", subgroup: "user_impact" }, { groupSize: 15, groupKey: "P1", subgroupKey: "wrong_action" })
 */
export interface IssueGroupsOpts {
  /** items per group (per subgroup when grouped twice); server default 10 */
  groupSize?: number;
  /** only this group (load more) */
  groupKey?: string;
  /** only this subgroup of `groupKey` */
  subgroupKey?: string | null;
  /** page of the group's items at `groupSize` */
  groupPage?: number;
  /** flat paging of the ungrouped `items` (kept small: the view reads `groups`) */
  pageSize?: number;
  page?: number;
}
export function useIssueGroups(f: F, g: { group: GroupDim; subgroup?: GroupDim | null; lens?: "user" | "dev" }, opts: IssueGroupsOpts = {}) {
  const q: IssueQuery = {
    ...f.query,
    group: g.group,
    subgroup: g.subgroup ?? undefined,
    lens: g.lens && g.lens !== "user" ? g.lens : undefined,
    group_size: opts.groupSize,
    group_key: opts.groupKey,
    subgroup_key: opts.groupKey != null && opts.subgroupKey != null ? opts.subgroupKey : undefined,
    group_page: opts.groupPage,
    page: opts.page ?? f.page,
    pageSize: opts.pageSize ?? 100,
  };
  return useApi([PREFIX + "list", q], () => request<IssueGroupedListResponse>("/issues" + qs(q)), OPTS);
}

/** Single-issue page: the IssueDetail incl. the merge breakdowns (same request as useIssue). */
export function useIssueDetail(id: string | null | undefined, f: F, opts: { page?: number; pageSize?: number } = {}) {
  const r = useIssue(id, f, opts);
  return r as Omit<typeof r, "data"> & { data: IssueDetailMerge | undefined };
}

/** The detail's breakdowns for the detail dims, in display order (only dims the server returned). */
export function issueBreakdowns(d: IssueDetailMerge | null | undefined) {
  if (!d) return [];
  const b = d.breakdown as Record<string, IssueDetailMerge["breakdown"]["language"] | undefined>;
  return DETAIL_BREAKDOWN_DIMS.filter((dim) => Array.isArray(b[dim])).map((dim) => ({ dim, stats: b[dim]! }));
}
