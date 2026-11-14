"use client";
/**
 * 분해 보기 view state: `dim` (breakdown dimension), `csort` (card order) and `cview` (cards | table).
 * These are view-local URL params (registered in issues-shared/links.ts VIEW_STATE_PARAMS.categories), NOT filters.
 */
import { useCallback } from "react";
import { parseAsString, useQueryStates } from "@/lib/client";
import { BIXBY_VERSIONS } from "@/lib/catalog";
import type { IssueBreakdownItem } from "@/lib/types";
import { BREAKDOWN_DIMS, type IssueDimId } from "../../issues-shared";

/** primary tabs, in the order the user asked for */
export const CAT_TABS = ["category", "user_impact", "dev_miss", "agent_function", "division", "region", "bixby_version"] as const satisfies readonly (typeof BREAKDOWN_DIMS)[number][];
/** under "더보기": every other dim the breakdown endpoint accepts */
export const CAT_MORE = [
  "severity",
  "market",
  "device",
  "model_version",
  "language",
  "failure_reason",
  "capsule",
  "intent",
  "pipeline",
  "pipeline_version",
  "status",
  "novelty",
  "must_handle",
  "os_version",
  "one_ui_version",
] as const satisfies readonly IssueDimId[];
export type CatDim = (typeof CAT_TABS)[number] | (typeof CAT_MORE)[number];
const ALL = new Set<string>([...CAT_TABS, ...CAT_MORE]);

/** issue-level dims: FAIL rows take their issue's value, PASS rows have none (fail_rate = share of the FAIL rate) */
export const TAG_DIMS = new Set<string>(["category", "user_impact", "dev_miss", "must_handle", "severity", "status", "novelty"]);
/** dims with a natural order → the ordered chart */
export const ORDERED_DIMS = new Set<string>(["bixby_version", "severity"]);
export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;

export const CSORTS = ["volume", "issues", "fail_rate", "delta", "critical"] as const;
export type CSort = (typeof CSORTS)[number];
export const CVIEWS = ["cards", "table"] as const;
export type CView = (typeof CVIEWS)[number];

const PARSERS = { dim: parseAsString, csort: parseAsString, cview: parseAsString };

export function useCategoriesState() {
  const [raw, setRaw] = useQueryStates(PARSERS);
  const dim: CatDim = raw.dim && ALL.has(raw.dim) ? (raw.dim as CatDim) : "category";
  const csort: CSort = (CSORTS as readonly string[]).includes(raw.csort ?? "") ? (raw.csort as CSort) : "volume";
  const cview: CView = raw.cview === "table" ? "table" : "cards";
  const setDim = useCallback((d: CatDim) => setRaw({ dim: d === "category" ? null : d }, { history: "push" }), [setRaw]);
  const setSort = useCallback((s: CSort) => setRaw({ csort: s === "volume" ? null : s }), [setRaw]);
  const setView = useCallback((v: CView) => setRaw({ cview: v === "cards" ? null : v }), [setRaw]);
  return { dim, csort, cview, setDim, setSort, setView };
}

const critical = (i: IssueBreakdownItem) => (i.by_severity.P0 ?? 0) + (i.by_severity.P1 ?? 0);
const nullLast = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a);

export function sortItems(items: IssueBreakdownItem[], s: CSort): IssueBreakdownItem[] {
  const out = [...items];
  const tie = (a: IssueBreakdownItem, b: IssueBreakdownItem) => b.fails - a.fails || a.rank - b.rank;
  out.sort((a, b) => {
    switch (s) {
      case "issues":
        return b.issues - a.issues || tie(a, b);
      case "fail_rate":
        return nullLast(a.fail_rate, b.fail_rate) || tie(a, b);
      case "delta":
        return nullLast(a.delta, b.delta) || tie(a, b);
      case "critical":
        return critical(b) - critical(a) || b.by_severity.P0 - a.by_severity.P0 || tie(a, b);
      default:
        return a.rank - b.rank;
    }
  });
  return out;
}

/** natural order for the ordered chart (versions oldest first, impact P0 → P3) */
export function naturalItems(dim: string, items: IssueBreakdownItem[]): IssueBreakdownItem[] {
  const order: readonly string[] = dim === "bixby_version" ? BIXBY_VERSIONS : dim === "severity" ? SEVERITIES : [];
  const ix = (v: string) => {
    const i = order.indexOf(v);
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => ix(a.value) - ix(b.value) || (a.value < b.value ? -1 : 1));
}

/** version-over-version step that counts as a regression, pp */
export const REGRESSION_PP = 2;
