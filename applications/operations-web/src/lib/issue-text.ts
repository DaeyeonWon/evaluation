/**
 * Issue Report — localizes an IssueText ({ key, vars }) with an `issues`-namespace translator.
 * Isomorphic: used by the server (CSV / Markdown export) and by issues-shared/format.ts on the client.
 *
 * Enum-coded vars are translated before interpolation (ENUM_VARS: var name → message group), e.g.
 * { key: "reasons.regression", vars: { axis: "pipeline_version", … } } → "… Pipeline version …".
 */
import type { IssueText } from "./types";

type T = { dynamic(key: string, vars?: Record<string, string | number | null | undefined>, fallback?: string): string };

/** var name → `issues.<group>.<value>` */
export const ENUM_VARS: Record<string, string> = {
  fn: "agentFunction",
  fn2: "agentFunction",
  reason: "failureReason",
  axis: "column",
  column: "column",
  market: "market",
  kind: "patternKind",
  cls: "severityClass",
  status: "status",
  severity: "severity",
};

export function issueVars(t: T, vars: IssueText["vars"]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    const group = ENUM_VARS[k];
    out[k] = group && typeof v === "string" && v ? t.dynamic(`${group}.${v}`, undefined, v) : v;
  }
  return out;
}

export function formatIssueText(t: T, text: IssueText | null | undefined): string {
  if (!text) return "";
  return t.dynamic(text.key, issueVars(t, text.vars), text.key);
}
