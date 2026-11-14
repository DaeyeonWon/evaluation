"use client";
/**
 * Signal Lab — auto-generated insights (R3) as instrument "readouts": the ranked sentence, the numbers
 * behind it, and three ways to follow it — Focus (apply its filter to every view), Evidence (/results)
 * and the issue it points to.
 */
import clsx from "clsx";
import { ArrowUpRight, Crosshair, Eye } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/client";
import type { InsightList, IssueInsight } from "@/lib/types";
import { ISSUE_COLUMNS, ISSUE_LEVEL_FILTERS, useIssueFormat, useIssueLinks, type IssueFilterValues, type IssueFiltersApi } from "../../issues-shared";
import { Skeleton } from "../../ui";

const PCT = new Set(["fail_rate", "baseline_fail_rate", "current_rate", "previous_rate", "share", "overall"]);
const PP = new Set(["delta"]);

export function filterPatch(filter: Record<string, string>): Partial<IssueFilterValues> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if ((ISSUE_COLUMNS as string[]).includes(k) || (ISSUE_LEVEL_FILTERS as readonly string[]).includes(k)) patch[k] = v.split(",").filter(Boolean);
    else if (k === "q") patch.q = v;
    else if (k === "min_score") patch.min_score = Number(v);
  }
  return patch as Partial<IssueFilterValues>;
}

function Metric({ k, v }: { k: string; v: number | string | null }) {
  const t = useT("issuesAnalysis");
  const fx = useIssueFormat();
  if (v == null) return null;
  const val =
    typeof v === "number"
      ? PCT.has(k)
        ? fx.pct(v)
        : PP.has(k)
          ? fx.pp(v)
          : k === "score"
            ? fx.score(v)
            : k === "growth"
              ? `×${v.toFixed(1)}`
              : k === "z"
                ? v.toFixed(1)
                : k === "coverage"
                  ? fx.pct(v * 100)
                  : String(v)
      : v;
  return (
    <span className="lab-im">
      <span>{t.dynamic(`metric.${k}`, undefined, k)}</span>
      <b className="mono">{val}</b>
    </span>
  );
}

/** language codes in insight vars ("ja") → the language name in the UI locale ("일본어" / "Japanese") */
function useInsightText() {
  const cat = useT("catalog");
  const fx = useIssueFormat();
  return (x: IssueInsight): string => {
    const vars = { ...(x.vars ?? {}) } as Record<string, string | number>;
    if (typeof vars.language === "string") vars.language = cat.dynamic(`languages.${vars.language}`, undefined, vars.language);
    return fx.insight({ key: x.key, vars });
  };
}

export function Insights({ data, f, onIssue }: { data: InsightList | undefined; f: IssueFiltersApi; onIssue: (id: string) => void }) {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const text = useInsightText();
  const L = useIssueLinks();
  const [all, setAll] = useState(false);
  if (!data) return <Skeleton rows={4} />;
  if (!data.items.length) return <div className="empty">{s("empty.insights")}</div>;
  const items: IssueInsight[] = all ? data.items : data.items.slice(0, 8);
  return (
    <>
      <ol className="lab-ins">
        {items.map((x, i) => {
          const hasFilter = Object.keys(x.evidence.filter).length > 0;
          return (
            <li key={x.id} className={clsx("lab-in", "k-" + x.kind)} style={{ ["--i" as string]: i }}>
              <div className="lab-in-h">
                <span className="lab-in-no mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="iss-sev" data-sev={x.severity}>
                  {x.severity}
                </span>
                <span className="lab-in-kind">{s(`insightKind.${x.kind}`)}</span>
                <span className="lab-in-score mono" title={t("ins.weight")}>
                  {Math.round(x.score)}
                </span>
              </div>
              <p className="lab-in-txt">{text(x)}</p>
              <div className="lab-in-m">
                {Object.entries(x.evidence.metrics)
                  .slice(0, 4)
                  .map(([k, v]) => (
                    <Metric key={k} k={k} v={v} />
                  ))}
              </div>
              <div className="lab-in-a">
                {hasFilter ? (
                  <button type="button" className="btn sm" onClick={() => f.set(filterPatch(x.evidence.filter))}>
                    <Crosshair aria-hidden /> {t("ins.focus")}
                  </button>
                ) : null}
                {x.evidence.issue_id ? (
                  <button type="button" className="btn sm" onClick={() => onIssue(x.evidence.issue_id!)}>
                    <Eye aria-hidden /> {s("actions.openIssue")}
                  </button>
                ) : null}
                <Link className="btn sm ghost" href={L.evidence(x)}>
                  {t("ins.evidence")} <ArrowUpRight aria-hidden />
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
      {data.items.length > 8 ? (
        <button type="button" className="btn sm ghost lab-in-more" onClick={() => setAll((a) => !a)}>
          {all ? t("ins.less") : t("ins.more", { n: data.items.length - 8 })}
        </button>
      ) : null}
    </>
  );
}
