"use client";
/**
 * Quality dashboard — client model: dimension list, URL filter state, labels, number formatting and the
 * /results drill-down builder. Independent of the Issue Report (no issues-shared import).
 */
import { useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { capsuleLabel, deviceLabel, languageName } from "@/i18n";
import { useLocale, useT } from "@/i18n/client";
import { parseAsList, useQueryStates, type QualityQuery } from "@/lib/client";
import type { QualityDim } from "@/lib/types";
import { useRangeHref } from "../time-range";
import { useRangeInfo } from "../analytics/kit";

export const Q_DIMS: QualityDim[] = [
  "agent_function",
  "capsule",
  "intent",
  "language",
  "market",
  "region",
  "device",
  "division",
  "bixby_version",
  "one_ui_version",
  "model_version",
  "pipeline",
  "pipeline_version",
  "failure_reason",
];
export type FilterKey = QualityDim | "result";
export const FILTER_KEYS: FilterKey[] = [...Q_DIMS, "result"];
/** shown inline in the FilterBar; the rest sit behind "more" */
export const PRIMARY_KEYS: FilterKey[] = ["division", "region", "language", "agent_function", "model_version", "bixby_version", "failure_reason", "result"];
export const MORE_KEYS: FilterKey[] = FILTER_KEYS.filter((k) => !PRIMARY_KEYS.includes(k));

/** fixed value lists (reference tables); other dims get their values from the API */
export const FAILURE_REASONS = ["INTENT_MISMATCH", "SLOT_ERROR", "RESPONSE_QUALITY", "TIMEOUT", "ASR_ERROR", "POLICY_VIOLATION"] as const;

/** /results URL param per filter key (every quality filter has a /results equivalent) */
export const RESULTS_PARAM: Record<FilterKey, string> = {
  agent_function: "agent_function",
  capsule: "capsule",
  intent: "intent",
  language: "language",
  market: "market",
  region: "region",
  device: "device",
  division: "division",
  bixby_version: "bixby_version",
  one_ui_version: "one_ui_version",
  model_version: "model_version",
  pipeline: "pipeline_id",
  pipeline_version: "version",
  failure_reason: "failure_reason",
  result: "result",
};

export const OTHER = "__other__";

// ───────────────────────────────────────── URL filter state ──
const PARSERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, parseAsList])) as Record<FilterKey, typeof parseAsList>;
export type QualityFilters = Record<FilterKey, string[]>;

export interface QualityFiltersApi {
  values: QualityFilters;
  /** API query (filters + range) */
  query: QualityQuery;
  rangeKey: string;
  active: { key: FilterKey; value: string }[];
  set: (k: FilterKey, v: string[]) => void;
  toggle: (k: FilterKey, v: string) => void;
  clear: () => void;
  /** query string of the filters only (for the view tabs) */
  qs: string;
}

export function useQualityFilters(): QualityFiltersApi {
  const [values, setValues] = useQueryStates(PARSERS);
  const tr = useRangeInfo();
  const query = useMemo(() => {
    const q: QualityQuery = { ...tr.params };
    for (const k of FILTER_KEYS) if (values[k].length) (q as Record<string, unknown>)[k] = values[k].join(",");
    return q;
  }, [values, tr.params]);
  const active = useMemo(() => FILTER_KEYS.flatMap((key) => values[key].map((value) => ({ key, value }))), [values]);
  const set = useCallback(
    (k: FilterKey, v: string[]) =>
      setValues({
        [k]: k === "result" ? v.slice(-1) : v,
      } as Partial<QualityFilters>),
    [setValues],
  );
  const toggle = useCallback(
    (k: FilterKey, v: string) => {
      const cur = values[k];
      if (k === "result")
        return setValues({
          result: cur.includes(v) ? [] : [v],
        } as Partial<QualityFilters>);
      setValues({
        [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
      } as Partial<QualityFilters>);
    },
    [values, setValues],
  );
  const clear = useCallback(() => setValues(Object.fromEntries(FILTER_KEYS.map((k) => [k, []])) as Partial<QualityFilters>), [setValues]);
  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    for (const k of FILTER_KEYS) if (values[k].length) sp.set(k, values[k].join(","));
    for (const [k, v] of Object.entries(tr.params)) sp.set(k, v);
    return sp.toString();
  }, [values, tr.params]);
  return { values, query, rangeKey: tr.key, active, set, toggle, clear, qs };
}

// ───────────────────────────────────────── views ──
export const VIEWS = ["overview", "breakdown", "matrix", "versions", "distributions"] as const;
export type QualityView = (typeof VIEWS)[number];
export const viewPath = (v: QualityView) => (v === "overview" ? "/quality" : `/quality/${v}`);
export function useQualityView(): QualityView {
  const p = usePathname();
  const seg = p.replace(/^\/quality\/?/, "").split("/")[0];
  return (VIEWS as readonly string[]).includes(seg) ? (seg as QualityView) : "overview";
}

// ───────────────────────────────────────── labels ──
const LABELLED = new Set<FilterKey>(["agent_function", "market", "failure_reason", "division", "region", "result"]);

export function useQLabel() {
  const t = useT("quality");
  const locale = useLocale();
  return useMemo(() => {
    const dim = (d: FilterKey) => t(`dim.${d}`);
    const value = (d: FilterKey, v: string): string => {
      if (v === OTHER) return t("value.other");
      if (v === "") return "—";
      if (LABELLED.has(d)) return t.dynamic(`value.${d}.${v}`, undefined, v);
      if (d === "language") return languageName(v, locale);
      if (d === "capsule") return capsuleLabel(v, locale);
      if (d === "device") return deviceLabel(v, locale);
      return v;
    };
    return { dim, value };
  }, [t, locale]);
}

// ───────────────────────────────────────── numbers ──
export const fmtRate = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
export const fmtPp = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}pp`);
/** thousands separators, locale-independent (same output on server and client) */
export const grp = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const fmtSigned = (v: number) => (v > 0 ? `+${grp(v)}` : v < 0 ? `−${grp(Math.abs(v))}` : "±0");

// ───────────────────────────────────────── drill-down ──
export interface DrillLink {
  href: string;
}

/**
 * `/results` link = the active quality filters + `extra` (the clicked slice; replaces that key) + the range.
 * Usage: drill({ division: "Mobile" }, { result: "FAIL" }).
 */
export function useDrill(f: QualityFiltersApi) {
  const rh = useRangeHref();
  return useCallback(
    (extra: Partial<Record<FilterKey, string | null>> = {}): DrillLink => {
      const sp = new URLSearchParams();
      for (const k of FILTER_KEYS) {
        const vals = k in extra ? (extra[k] && extra[k] !== OTHER ? [extra[k]!] : []) : f.values[k];
        if (!vals.length) continue;
        sp.set(RESULTS_PARAM[k], vals.join(","));
      }
      const s = sp.toString();
      return { href: rh("/results" + (s ? "?" + s : "")) };
    },
    [f.values, rh],
  );
}
