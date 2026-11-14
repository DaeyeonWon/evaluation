"use client";
/**
 * Issue detail — drill-down links out of the page with the range taken from the resolved filter query.
 * (Equivalent to useIssueLinks() for these targets, but always explicit about the range, so a legacy
 * `from=<view>` origin param in old links can never be mistaken for a custom range start.)
 */
import { useMemo } from "react";
import { qs } from "@/lib/client";
import { useIssueFilters } from "../../issues-shared";
import { rangeOf } from "./lib";

export function useDetailLinks() {
  const f = useIssueFilters();
  const range = useMemo(() => rangeOf(f.query as Record<string, unknown>), [f.query]);
  return useMemo(() => {
    const results = (p: Record<string, string>) => "/results" + qs({ result: "FAIL", ...p, ...range });
    return {
      range,
      results,
      utterance: (id: string) => "/results" + qs({ q: id, utt: id, ...range }),
      workflow: (id: string) => `/workflows/${encodeURIComponent(id)}` + qs(range),
    };
  }, [range]);
}
export type DetailLinks = ReturnType<typeof useDetailLinks>;
