/**
 * Issue Report — generic dimension metadata. ONE table drives the unified FilterBar (issues/frame),
 * the 분해 보기 dimension switch, the Analysis heatmap axes / treemap levels, the Triage group/subgroup
 * pickers and the drill-down links (links.ts drillHref). Owned by the framework engineer.
 *
 *   import { ISSUE_DIMS, dimMeta, PRIMARY_DIMS, BREAKDOWN_DIMS, MATRIX_DIMS, GROUP_DIMS } from "../../issues-shared";
 *   dimMeta("division")            // { id, param: "division", labelKey: "frame.dim.division", multi: true, … }
 *   const dl = useDimLabel();      // dl.dim("bixby_version") → "Bixby version" · dl.value("device", "galaxy_s26") → "Galaxy S26"
 *
 * `param` is the URL query param (= the API filter). Every dim except q/min_score/must_handle is a
 * comma-separated multi-select list. `risk` is the user-facing name of the existing `severity_class` param.
 * Labels live in the shared `issues` namespace under `frame.dim.<id>`; value labels go through
 * format.ts (agentFunction.*, market.*, failureReason.*, severity.*, status.*, novelty.*, severityClass.*,
 * category.*, division.*, region.*, userImpact.*, devMiss.* — raw value when a key is missing).
 */
import { useMemo } from "react";
import { capsuleLabel, deviceLabel, languageName } from "@/i18n";
import { useLocale, useT } from "@/i18n/client";
import { useIssueFormat } from "./format";

export const ISSUE_DIM_IDS = [
  // primary (always visible in the FilterBar)
  "agent_function",
  "category",
  "division",
  "region",
  "bixby_version",
  "severity",
  "status",
  "user_impact",
  "dev_miss",
  // under "필터 더보기"
  "capsule",
  "intent",
  "language",
  "market",
  "device",
  "model_version",
  "pipeline",
  "pipeline_version",
  "failure_reason",
  "novelty",
  "risk",
  "must_handle",
  "os_version",
  "one_ui_version",
  "min_score",
  "q",
] as const;
export type IssueDimId = (typeof ISSUE_DIM_IDS)[number];

/** list = multi-select values · bool = true|false · number = threshold · text = free search */
export type IssueDimKind = "list" | "bool" | "number" | "text";

export interface IssueDimMeta {
  id: IssueDimId;
  /** URL / API query param */
  param: string;
  /** key in the `issues` namespace */
  labelKey: `frame.dim.${IssueDimId}`;
  kind: IssueDimKind;
  multi: boolean;
  /** row = filters evaluation rows before clustering (facet counts are FAIL rows); issue = filters scored issues (facet counts are issues) */
  level: "row" | "issue";
  tier: "primary" | "more";
  /** key in IssueFacets.facets (null = no facet values, e.g. q) */
  facet: string | null;
}

const ROW = new Set<IssueDimId>([
  "agent_function",
  "division",
  "region",
  "bixby_version",
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
]);
const PRIMARY = new Set<IssueDimId>(["agent_function", "category", "division", "region", "bixby_version", "severity", "status", "user_impact", "dev_miss"]);
const PARAM: Partial<Record<IssueDimId, string>> = { risk: "severity_class" };
const KIND: Partial<Record<IssueDimId, IssueDimKind>> = { must_handle: "bool", min_score: "number", q: "text" };

export const ISSUE_DIMS: Record<IssueDimId, IssueDimMeta> = Object.fromEntries(
  ISSUE_DIM_IDS.map((id) => {
    const kind = KIND[id] ?? "list";
    const param = PARAM[id] ?? id;
    return [
      id,
      {
        id,
        param,
        labelKey: `frame.dim.${id}`,
        kind,
        multi: kind === "list",
        level: ROW.has(id) ? "row" : "issue",
        tier: PRIMARY.has(id) ? "primary" : "more",
        facet: kind === "text" || kind === "number" ? null : param,
      } satisfies IssueDimMeta,
    ];
  }),
) as Record<IssueDimId, IssueDimMeta>;

export const dimMeta = (id: IssueDimId) => ISSUE_DIMS[id];
/** dim whose URL param is `param` (e.g. "severity_class" → risk) */
export const dimByParam = (param: string) => ISSUE_DIM_IDS.map((d) => ISSUE_DIMS[d]).find((d) => d.param === param) ?? null;

/** FilterBar: always-visible dropdown chips */
export const PRIMARY_DIMS: IssueDimId[] = ISSUE_DIM_IDS.filter((d) => PRIMARY.has(d));
/** FilterBar: under "필터 더보기" */
export const MORE_DIMS: IssueDimId[] = ISSUE_DIM_IDS.filter((d) => !PRIMARY.has(d));
/** every multi-select list dim (URL params parsed as lists) */
export const LIST_DIMS: IssueDimId[] = ISSUE_DIM_IDS.filter((d) => ISSUE_DIMS[d].kind === "list");

/** 분해 보기 dimension switch (GET /issues/breakdown?dim=) */
export const BREAKDOWN_DIMS = ["category", "agent_function", "division", "region", "bixby_version", "user_impact", "dev_miss"] as const satisfies readonly IssueDimId[];
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number];
/** Analysis heatmap axes / treemap levels (GET /issues/matrix?x=&y=) */
export const MATRIX_DIMS = [
  "agent_function",
  "category",
  "division",
  "region",
  "market",
  "language",
  "device",
  "bixby_version",
  "model_version",
  "pipeline",
  "user_impact",
  "dev_miss",
  "failure_reason",
] as const satisfies readonly IssueDimId[];
export type MatrixDim = (typeof MATRIX_DIMS)[number];
export const MATRIX_METRICS = ["fail_rate", "fail_count", "delta", "issue_count"] as const;
export type MatrixMetric = (typeof MATRIX_METRICS)[number];
/** Triage group / subgroup pickers (GET /issues?group=&subgroup=). `severity` = 영향도 / Impact level. */
export const GROUP_DIMS = [
  "severity",
  "user_impact",
  "dev_miss",
  "category",
  "agent_function",
  "division",
  "region",
  "bixby_version",
  "market",
  "device",
  "model_version",
  "status",
  "failure_reason",
  "novelty",
] as const satisfies readonly IssueDimId[];
export type GroupDim = (typeof GROUP_DIMS)[number];
/** Issue detail breakdown dims (GET /issues/[id] → breakdown.<dim>) */
export const DETAIL_BREAKDOWN_DIMS = ["division", "region", "market", "device", "bixby_version", "model_version", "language"] as const satisfies readonly IssueDimId[];

/** Localized dim + value labels. */
export function useDimLabel() {
  const t = useT("issues");
  const fx = useIssueFormat();
  const locale = useLocale();
  return useMemo(() => {
    const dim = (id: IssueDimId | string) => {
      const m = ISSUE_DIMS[id as IssueDimId] ?? dimByParam(id);
      return m ? t.dynamic(m.labelKey, undefined, fx.column(m.param)) : fx.column(id);
    };
    const value = (id: IssueDimId | string, v: string) => {
      const param = ISSUE_DIMS[id as IssueDimId]?.param ?? id;
      if (param === "language") return languageName(v, locale);
      if (param === "device") return deviceLabel(v, locale);
      if (param === "capsule") return capsuleLabel(v, locale);
      if (param === "market") return `${v} · ${fx.market(v)}`;
      if (param === "must_handle") return t.dynamic(`frame.mustHandle.${v}`, undefined, v);
      return fx.value(param, v);
    };
    return { dim, value };
  }, [t, fx, locale]);
}
export type DimLabel = ReturnType<typeof useDimLabel>;
