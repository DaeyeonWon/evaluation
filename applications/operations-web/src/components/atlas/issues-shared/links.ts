"use client";
/**
 * Issue Report — drill-down links that keep the global range. SHARED (do not edit in A/B/C).
 *
 *   const L = useIssueLinks();
 *   <Link href={L.results(issue)}>…</Link>            // /results?…issue rows…&range=…
 *   <Link href={L.resultsFor({ utterance_pattern: p.id })}>…</Link>   // any /results params (FAIL rows)
 *   <Link href={L.evidence(insight)}>…</Link>          // /results for an insight (or the issue page filter)
 *   <Link href={L.workflow(w.workflow_id, w.created_at, w.completed_at)}>…</Link>
 *   <Link href={L.utterance(row.utterance_id)}>…</Link>  // /results?q=<id>&utt=<id> (row + its drawer)
 *   L.issue("/issues/a", id)                          // candidate page with ?issue=<id> (keeps current filters)
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useCoverHref, useRangeHref } from "../time-range";
import type { Issue, IssueInsight } from "@/lib/types";

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
