"use client";
/**
 * Issue Report — localized text for server-generated issue content. SHARED by every view (issues/*); views do not edit it (ask the framework engineer).
 *
 *   const fx = useIssueFormat();
 *   fx.text(issue.title)            // "smartthings.door_unlock — 확인 없이 실행 (안전)"
 *   fx.text(reason)                 // any IssueText (reasons[], titles)
 *   fx.insight(insight)             // IssueInsight → sentence
 *   fx.fn("device_control")         // "기기 제어"         (agentFunction.*)
 *   fx.column("one_ui_version")     // "One UI version"
 *   fx.value("market", "MX")        // facet value label: translates agent_function / market / failure_reason /
 *                                   //   severity_class / status / novelty values, raw otherwise
 *   fx.factor("trend") / fx.factorHelp("trend")
 *   fx.status("TICKETED"), fx.statusHelp(..), fx.severityHelp("P0"), fx.cls("safety"), fx.kind("code_switch")
 *   fx.pct(12.3) → "12.3%"  ·  fx.pp(-1.2) → "−1.2%p" / "−1.2 pp"  ·  fx.score(72.1) → "72"
 */
import { useMemo } from "react";
import { useLocale, useT } from "@/i18n/client";
import { formatIssueText } from "@/lib/issue-text";
import type { IssueFactorKey, IssueInsight, IssueStatus, IssueText, PatternKind, SeverityClass } from "@/lib/types";

const VALUE_GROUP: Record<string, string> = {
  agent_function: "agentFunction",
  market: "market",
  failure_reason: "failureReason",
  severity_class: "severityClass",
  status: "status",
  novelty: "novelty",
  severity: "severity",
  // merge dims (labels added by the data engineer in the shared `issues` namespace; raw value until then)
  category: "category",
  division: "division",
  region: "region",
  user_impact: "userImpact",
  dev_miss: "devMiss",
};

export function useIssueFormat() {
  const t = useT("issues");
  const locale = useLocale();
  return useMemo(() => {
    const d = (k: string, fb: string) => t.dynamic(k, undefined, fb);
    return {
      t,
      text: (x: IssueText | null | undefined) => formatIssueText(t, x),
      insight: (i: Pick<IssueInsight, "key" | "vars">) => formatIssueText(t, { key: i.key, vars: i.vars }),
      fn: (v: string) => d(`agentFunction.${v}`, v),
      market: (v: string) => d(`market.${v}`, v),
      reason: (v: string) => d(`failureReason.${v}`, v),
      column: (c: string) => d(`column.${c}`, c),
      value: (column: string, v: string) => (VALUE_GROUP[column] ? d(`${VALUE_GROUP[column]}.${v}`, v) : v),
      factor: (k: IssueFactorKey) => d(`factor.${k}.label`, k),
      factorHelp: (k: IssueFactorKey) => d(`factor.${k}.help`, ""),
      status: (s: IssueStatus) => d(`status.${s}`, s),
      statusHelp: (s: IssueStatus) => d(`statusHelp.${s}`, ""),
      severityHelp: (s: string) => d(`severityHelp.${s}`, ""),
      cls: (c: SeverityClass) => d(`severityClass.${c}`, c),
      clsHelp: (c: SeverityClass) => d(`severityClassHelp.${c}`, ""),
      kind: (k: PatternKind) => d(`patternKind.${k}`, k),
      kindHelp: (k: PatternKind) => d(`patternKindHelp.${k}`, ""),
      pct: (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`),
      pp: (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}${locale === "ko" ? "%p" : " pp"}`),
      score: (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n))),
    };
  }, [t, locale]);
}
export type IssueFormat = ReturnType<typeof useIssueFormat>;
