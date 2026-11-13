"use client";
/** Market Brief — §1 Executive summary: ranked, data-backed insight statements with their big number and evidence refs. */
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import type { InsightList, IssueInsight } from "@/lib/types";
import type { IssueFiltersApi, IssueFormat } from "../issues-shared";
import { Skeleton } from "../ui";
import { FootRef, Sev } from "./bits";
import { SecHead } from "./sec";

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !isNaN(+v) ? +v : null);

/** The single number that carries an insight, by kind. */
function bigNumber(i: IssueInsight, fx: IssueFormat): { v: string; u: string } {
  const m = i.evidence.metrics;
  const v = i.vars;
  switch (i.kind) {
    case "safety":
      return { v: String(num(v.count) ?? num(m.fails) ?? "—"), u: "FAIL" };
    case "regression":
      return { v: fx.pct(num(m.current_rate) ?? num(v.curRate)), u: String(v.current ?? "") };
    case "new_pattern":
      return i.key === "insights.newPatterns" ? { v: String(num(m.patterns) ?? v.count), u: fx.t("field.pattern") } : { v: fx.pct(num(m.fail_rate)), u: "FAIL" };
    case "market":
    case "hotspot":
    case "improvement":
      return { v: fx.pp(num(m.delta)), u: fx.t("kpi.delta") };
    case "spike": {
      const o = num(m.observed);
      const e = num(m.expected);
      return { v: o != null && e ? `×${(o / e).toFixed(1)}` : "—", u: `z=${v.z ?? "—"}` };
    }
    case "concentration":
      return { v: fx.pct(num(m.share)), u: String(v.value ?? "") };
    case "critical":
      return { v: fx.score(num(m.score)), u: fx.t("field.score") };
    default:
      return { v: fx.pct(num(m.fail_rate)), u: fx.t("kpi.failRate") };
  }
}

export function ExecSummary({ id, no, ins, f, fx }: { id: string; no: number; ins: InsightList | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesB");
  const s = useT("issues");
  const [all, setAll] = useState(false);
  const items = (ins?.items ?? []).filter((i) => i.kind !== "overall");
  const shown = all ? items : items.slice(0, 5);
  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.exec.title")} lead={t("section.exec.lead")} />
      {!ins ? (
        <Skeleton rows={5} />
      ) : !items.length ? (
        <p className="issb-empty">{s("empty.insights")}</p>
      ) : (
        <ol className="issb-exec">
          {shown.map((i, n) => {
            const b = bigNumber(i, fx);
            return (
              <li key={i.id} className="issb-exec-i" data-sev={i.severity} style={{ ["--i" as string]: n }}>
                <div className="issb-exec-num">
                  <span className="issb-exec-v">{b.v}</span>
                  <span className="issb-exec-u">{b.u}</span>
                </div>
                <div className="issb-exec-body">
                  <div className="issb-exec-kind">
                    <Sev s={i.severity} />
                    <span>{s.dynamic(`insightKind.${i.kind}`, undefined, i.kind)}</span>
                  </div>
                  <p>
                    {fx.insight(i)}
                    <FootRef k={`ins:${i.id}`} />
                  </p>
                  {i.evidence.issue_id ? (
                    <button type="button" className="issb-link" onClick={() => f.select(i.evidence.issue_id!)}>
                      {t("dossier.open")} <ArrowUpRight aria-hidden />
                    </button>
                  ) : Object.keys(i.evidence.filter).length ? (
                    <button type="button" className="issb-link" onClick={() => f.set(Object.fromEntries(Object.entries(i.evidence.filter).map(([k, v]) => [k, k === "q" ? v : String(v).split(",")])))}>
                      {s("filters.title")}: {Object.entries(i.evidence.filter).map(([k, v]) => `${fx.column(k)} ${fx.value(k, String(v))}`).join(" · ")}
                      <ArrowUpRight aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 5 ? (
        <button type="button" className="btn sm issb-more" onClick={() => setAll((a) => !a)}>
          {all ? t("section.exec.less") : t("section.exec.more", { n: items.length - 5, count: items.length - 5 })}
        </button>
      ) : null}
    </section>
  );
}
