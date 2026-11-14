"use client";
/**
 * Report view — evidence links that carry the brief's conditions.
 *
 * The shared useIssueLinks() keeps the range only. Here every /results link also carries the frame's
 * row-level filters (division, region, bixby_version, agent_function, market, …) so a footnote opens
 * exactly the rows the sentence was computed from. Explicit params win over the frame values.
 * `triage(pairs)` / `view(pairs, target)` link into the other Issue Report views with the current
 * query plus extra dim values (e.g. impact level × user impact type).
 */
import { useCallback, useMemo } from "react";
import type { Issue, IssueInsight } from "@/lib/types";
import { ISSUE_DIMS, useIssueLinks, useIssueViewLinks, type IssueDimId, type IssueFiltersApi, type IssueView } from "../../issues-shared";

/** frame filter param → /results param (row-level dims only; issue-level dims do not exist on rows) */
const RESULTS_PARAM: Record<string, string> = {
  agent_function: "agent_function",
  capsule: "capsule",
  intent: "intent",
  language: "language",
  market: "market",
  device: "device",
  model_version: "model_version",
  pipeline: "pipeline_id",
  failure_reason: "failure_reason",
  os_version: "os_version",
  one_ui_version: "one_ui_version",
  division: "division",
  region: "region",
  bixby_version: "bixby_version",
};

export function useBriefLinks(f: Pick<IssueFiltersApi, "values">) {
  const L = useIssueLinks();
  const V = useIssueViewLinks();
  const frame = useMemo(() => {
    const out: Record<string, string> = {};
    const v = f.values as unknown as Record<string, string[] | undefined>;
    for (const [k, rk] of Object.entries(RESULTS_PARAM)) {
      const vals = v[k];
      if (vals?.length) out[rk] = vals.join(",");
    }
    return out;
  }, [f.values]);

  const resultsFor = useCallback((p: Record<string, string | number | null | undefined>) => {
    const clean: Record<string, string> = {};
    for (const [k, x] of Object.entries(p)) if (x != null && x !== "") clean[k] = String(x);
    return L.resultsFor({ ...frame, ...clean });
  }, [L, frame]);
  const results = useCallback((i: Pick<Issue, "results_query">) => resultsFor({ result: "FAIL", ...i.results_query }), [resultsFor]);
  const evidence = useCallback(
    (x: Pick<IssueInsight, "evidence">) => {
      if (x.evidence.results) return resultsFor({ result: "FAIL", ...x.evidence.results });
      // an /issues filter: keep the row-level part (+ q); issue-level params have no meaning on /results
      const p: Record<string, string> = { result: "FAIL" };
      for (const [k, v] of Object.entries(x.evidence.filter)) if (RESULTS_PARAM[k] || k === "q") p[RESULTS_PARAM[k] ?? k] = String(v);
      return resultsFor(p);
    },
    [resultsFor],
  );

  /** another Issue Report view with the current query + these dim values (each replaces that dim) */
  const view = useCallback(
    (pairs: [IssueDimId | string, string][], target: IssueView = "triage", extra?: Record<string, string>) => {
      const [first, ...rest] = pairs;
      const href = first ? V.drillHref(first[0], first[1], target) : V.viewHref(target);
      const u = new URL(href, "http://x");
      for (const [d, val] of rest) u.searchParams.set(ISSUE_DIMS[d as IssueDimId]?.param ?? d, val);
      for (const [k, val] of Object.entries(extra ?? {})) u.searchParams.set(k, val);
      return u.pathname + u.search;
    },
    [V],
  );

  return useMemo(() => ({ resultsFor, results, evidence, view, issueHref: V.issueHref, frame }), [resultsFor, results, evidence, view, V.issueHref, frame]);
}
export type BriefLinks = ReturnType<typeof useBriefLinks>;
