"use client";
/**
 * Issue detail — drill-down links out of the page with the range taken from the resolved filter query.
 * Results links keep the range as is; Workflow links go through the shared widening helper
 * (useCoverHref), so a Workflow that ran outside the current range still opens with its rows in range.
 */
import { useMemo } from "react";
import { qs } from "@/lib/client";
import { useIssueFilters } from "../../issues-shared";
import { useCoverHref } from "../../time-range";
import { rangeOf } from "./lib";

export function useDetailLinks() {
  const f = useIssueFilters();
  const cover = useCoverHref();
  const range = useMemo(() => rangeOf(f.query as Record<string, unknown>), [f.query]);
  return useMemo(() => {
    const results = (p: Record<string, string>) => "/results" + qs({ result: "FAIL", ...p, ...range });
    return {
      range,
      results,
      utterance: (id: string) => "/results" + qs({ q: id, utt: id, ...range }),
      /** /workflows/<id>, range widened to cover [from, to] when given (created_at … completed_at / eval_ts) */
      workflow: (id: string, from?: number | null, to?: number | null) => {
        const path = `/workflows/${encodeURIComponent(id)}`;
        return from ? cover(path, from, to) : path + qs(range);
      },
    };
  }, [range, cover]);
}
export type DetailLinks = ReturnType<typeof useDetailLinks>;
