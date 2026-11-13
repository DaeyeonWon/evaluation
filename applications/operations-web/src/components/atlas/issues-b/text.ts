"use client";
/**
 * Market Brief — B-side sentence repair on top of the shared issue formatter (issues-shared/format.ts):
 *  - insights.safety: markets and devices are labelled separately, and the issue count is pluralised (en).
 *  - reasons.wrongAction when expected === predicted: the request was routed to the right intent, so
 *    "X ran as X" is replaced by a wrong-value sentence.
 * Everything else falls through to the shared formatter unchanged.
 */
import { useMemo } from "react";
import { useT } from "@/i18n/client";
import { issueVars } from "@/lib/issue-text";
import type { IssueInsight, IssueText } from "@/lib/types";
import type { IssueFormat } from "../issues-shared";

export function useBriefFormat(fx: IssueFormat): IssueFormat {
  const t = useT("issuesB");
  return useMemo(() => {
    const s = fx.t;
    const same = (v: IssueText["vars"]) => v != null && v.expected != null && v.expected === v.predicted;
    const insight = (i: Pick<IssueInsight, "key" | "vars">): string => {
      const v = i.vars ?? {};
      if (i.key === "insights.safety") {
        const x = issueVars(s, v);
        return t("ins.safety", { ...x, count: Number(v.issues ?? 1), fails: v.count ?? 0 });
      }
      return fx.insight(i);
    };
    const text = (x: IssueText | null | undefined): string => {
      if (x?.key === "reasons.wrongAction" && same(x.vars)) return t("ins.wrongActionSame", issueVars(s, x.vars));
      return fx.text(x);
    };
    return { ...fx, insight, text };
  }, [fx, t]);
}
