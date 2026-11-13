"use client";
/**
 * Issue Report — data hooks over /api/v1/issues/*. SHARED: candidates A/B/C import these and must not
 * edit them. Every hook is keyed on the filters + range (useIssueFilters), refetches on the SSE
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
 */
import { useCallback, useState } from "react";
import { api, revalidateKey, useApi, useStreamEvent, type IssueQuery } from "@/lib/client";
import type { IssuePatch, IssuePatchResult, IssueStreamMessage } from "@/lib/types";
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
