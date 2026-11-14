"use client";
/**
 * Issue Report — drill-down links that keep the global range. SHARED by every view (issues/*); views do not edit it (ask the framework engineer).
 *
 *   const L = useIssueLinks();
 *   <Link href={L.results(issue)}>…</Link>            // /results?…issue rows…&range=…
 *   <Link href={L.resultsFor({ utterance_pattern: p.id })}>…</Link>   // any /results params (FAIL rows)
 *   <Link href={L.evidence(insight)}>…</Link>          // /results for an insight (or the issue page filter)
 *   <Link href={L.workflow(w.workflow_id, w.created_at, w.completed_at)}>…</Link>
 *   <Link href={L.utterance(row.utterance_id)}>…</Link>  // /results?q=<id>&utt=<id> (row + its drawer)
 *   L.issue("/issues", id)                            // current page with ?issue=<id> (quick-look sheet; keeps filters)
 *
 * Views + the single-issue page (all keep the full filter query + range):
 *   const V = useIssueViewLinks();
 *   V.view                                  // current view: "triage" | "categories" | "analysis" | "report" | "detail"
 *   V.viewHref("analysis")                  // /issues/analysis?<filters>  (drops page/issue + other views' view-state)
 *   V.issueHref(id)                         // /issues/<id>?<filters>&from=<current view> (+ its view state, for the back link)
 *   V.drillHref("division", "TV")           // /issues?<filters>&division=TV  (view defaults to "triage")
 *   V.drillHref("category", "asr", "analysis", { replace: false })  // add to the existing values instead of replacing
 *   V.backHref                              // on /issues/[id]: the view + query it was opened from
 *
 * Pure variants for non-hook code: issuePath / viewPath / ISSUE_VIEW_PATH / VIEW_STATE_PARAMS.
 */
import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCoverHref, useRangeHref } from "../time-range";
import type { Issue, IssueInsight } from "@/lib/types";
import { ISSUE_DIMS, type IssueDimId } from "./dims";
import { TRIAGE_STATE_PARAMS } from "./filters";

// ───────────────────────────────────────── views ──
export const ISSUE_VIEWS = ["triage", "categories", "analysis", "report"] as const;
export type IssueView = (typeof ISSUE_VIEWS)[number];
export type IssuePageKind = IssueView | "detail";
export const ISSUE_VIEW_PATH: Record<IssueView, string> = {
  triage: "/issues",
  categories: "/issues/categories",
  analysis: "/issues/analysis",
  report: "/issues/report",
};
/**
 * View-local URL state: carried while staying in that view (and through /issues/[id] back links),
 * dropped when switching to another view. Everything else (filters, range, sort, group_by, unknown
 * params) is carried everywhere. View engineers: register new view-local params here.
 */
export const VIEW_STATE_PARAMS: Record<IssueView, readonly string[]> = {
  triage: [...TRIAGE_STATE_PARAMS, "view"],
  categories: ["dim", "csort", "cview"],
  analysis: ["hm", "quad", "pat", "x", "y", "metric", "tree"],
  report: [],
};
/** never carried between pages */
const TRANSIENT = ["page", "issue", "from"];

/** pathname → view ("detail" for /issues/<id>, null outside the Issue Report) */
export function issuePageOf(pathname: string): IssuePageKind | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  for (const v of ISSUE_VIEWS) if (p === ISSUE_VIEW_PATH[v]) return v;
  if (p.startsWith("/issues/")) return "detail";
  return null;
}

function strip(sp: URLSearchParams, keep: IssueView | null) {
  const next = new URLSearchParams(sp);
  for (const k of TRANSIENT) next.delete(k);
  for (const v of ISSUE_VIEWS) if (v !== keep) for (const k of VIEW_STATE_PARAMS[v]) next.delete(k);
  return next;
}
const withQs = (path: string, sp: URLSearchParams) => {
  const s = sp.toString();
  return path + (s ? "?" + s : "");
};
/** `view` page + the filters of `search` (view-local params of other views dropped) */
export function viewPath(view: IssueView, search: string | URLSearchParams) {
  return withQs(ISSUE_VIEW_PATH[view], strip(new URLSearchParams(search), view));
}
/** /issues/<id> + the filters of `search`; `from` = the view to return to (its view state is kept) */
export function issuePath(id: string, search: string | URLSearchParams, from: IssueView = "triage") {
  const next = strip(new URLSearchParams(search), from);
  if (from !== "triage") next.set("from", from);
  return withQs(`/issues/${encodeURIComponent(id)}`, next);
}

const qs = (p: Record<string, string | null | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v != null && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? "?" + s : "";
};

export function useIssueLinks() {
  const rh = useRangeHref();
  const cover = useCoverHref();
  const sp = useSearchParams();
  const spStr = sp.toString();
  const resultsFor = useCallback((p: Record<string, string>) => rh("/results" + qs({ result: "FAIL", ...p })), [rh]);
  const results = useCallback((i: Pick<Issue, "results_query">) => rh("/results" + qs(i.results_query)), [rh]);
  const evidence = useCallback(
    (x: Pick<IssueInsight, "evidence">) => (x.evidence.results ? rh("/results" + qs(x.evidence.results)) : rh("/results" + qs({ result: "FAIL", ...x.evidence.filter }))),
    [rh],
  );
  const workflow = useCallback((id: string, from?: number, to?: number | null) => (from ? cover(`/workflows/${encodeURIComponent(id)}`, from, to) : rh(`/workflows/${encodeURIComponent(id)}`)), [cover, rh]);
  const utterance = useCallback((id: string) => rh("/results" + qs({ q: id, utt: id })), [rh]);
  const issue = useCallback(
    (base: string, id: string | null) => {
      const next = new URLSearchParams(spStr);
      if (id) next.set("issue", id);
      else next.delete("issue");
      const s = next.toString();
      return base + (s ? "?" + s : "");
    },
    [spStr],
  );
  return useMemo(() => ({ results, resultsFor, evidence, workflow, utterance, issue, range: rh }), [results, resultsFor, evidence, workflow, utterance, issue, rh]);
}

/** View switching, single-issue links and drill-downs — all keep the current filter query + range. */
export function useIssueViewLinks() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const spStr = sp.toString();
  const page = issuePageOf(pathname) ?? "triage";
  const fromRaw = sp.get("from");
  const from: IssueView = (ISSUE_VIEWS as readonly string[]).includes(fromRaw ?? "") ? (fromRaw as IssueView) : "triage";
  /** the list view this page belongs to (detail → the view it was opened from) */
  const view: IssueView = page === "detail" ? from : page;
  const viewHref = useCallback((v: IssueView) => viewPath(v, spStr), [spStr]);
  const issueHref = useCallback((id: string) => issuePath(id, spStr, view), [spStr, view]);
  const drillHref = useCallback(
    (dim: IssueDimId | string, value: string, target: IssueView = "triage", opts: { replace?: boolean } = {}) => {
      const param = ISSUE_DIMS[dim as IssueDimId]?.param ?? dim;
      const next = strip(new URLSearchParams(spStr), target);
      const cur = (next.get(param) ?? "").split(",").filter(Boolean);
      const vals = opts.replace === false ? [...new Set([...cur, value])] : [value];
      next.set(param, vals.join(","));
      return withQs(ISSUE_VIEW_PATH[target], next);
    },
    [spStr],
  );
  const backHref = useMemo(() => viewPath(view, spStr), [view, spStr]);
  return useMemo(() => ({ page, view, viewHref, issueHref, drillHref, backHref }), [page, view, viewHref, issueHref, drillHref, backHref]);
}
export type IssueViewLinks = ReturnType<typeof useIssueViewLinks>;
