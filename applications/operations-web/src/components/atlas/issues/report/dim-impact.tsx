"use client";
/**
 * Report view — § Division impact and § Region impact: one small multiple per value
 * (Mobile/Wearable/Audio/TV/Appliance, KR/NA/EU/JP/LATAM) from GET /issues/breakdown?dim=.
 * Each panel: FAIL rate + change vs baseline, FAIL-rate trend on ONE shared scale with the baseline
 * dashed, issues by impact level, share of FAILs, the top 3 issues (→ /issues/[id]) and the top new
 * pattern. The header toggles the value as a filter (the brief regenerates); a footnote opens the
 * rows in /results with the brief's conditions carried.
 */
import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useFmt, useT } from "@/i18n/client";
import type { InsightList, IssueBreakdown, IssueBreakdownItem } from "@/lib/types";
import type { IssueFiltersApi, IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { Delta, DeltaLegend, deltaDir, Figure, FootRef, Spark, useTip } from "./bits";
import { LEVELS } from "./crosstab";
import type { BriefLinks } from "./links";
import { SecHead } from "./sec";

export type ImpactDim = "division" | "region";
export const noteKey = (dim: ImpactDim, v: string) => `${dim === "division" ? "div" : "reg"}:${v}`;

function SevStrip({ by, total }: { by: IssueBreakdownItem["by_severity"]; total: number }) {
  const t = useT("issuesReport");
  return (
    <div className="issb-sevstrip" role="img" aria-label={LEVELS.map((l) => `${l} ${by[l] ?? 0}`).join(", ")}>
      <div className="issb-sevstrip-bar">
        {LEVELS.map((l) => ((by[l] ?? 0) > 0 ? <i key={l} data-sev={l} style={{ flexGrow: by[l] }} title={`${l} · ${by[l]}`} /> : null))}
      </div>
      <div className="issb-sevstrip-n mono">
        {LEVELS.map((l) => (
          <span key={l} data-sev={l} data-zero={!by[l] || undefined}>
            {l} <b>{by[l] ?? 0}</b>
          </span>
        ))}
        <span className="issb-sevstrip-t">{t("dim.issues", { count: total })}</span>
      </div>
    </div>
  );
}

export function DimImpact({
  id,
  no,
  dim,
  bd,
  ins,
  f,
  fx,
  B,
}: {
  id: string;
  no: number;
  dim: ImpactDim;
  bd: IssueBreakdown | null | undefined;
  ins: InsightList | undefined;
  f: IssueFiltersApi;
  fx: IssueFormat;
  B: BriefLinks;
}) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const { attach, on, el } = useTip();
  const items = bd?.items ?? [];
  const order = dim === "division" ? ["Mobile", "Wearable", "Audio", "TV", "Appliance"] : ["KR", "NA", "EU", "JP", "LATAM"];
  const sorted = [...items].sort((a, b) => {
    const ia = order.indexOf(a.value);
    const ib = order.indexOf(b.value);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // one scale for every panel's trend (small multiples compare by position)
  const smax = Math.max(5, ...items.flatMap((i) => [...i.trend_rate.filter((v): v is number => v != null), i.baseline_fail_rate ?? 0]));
  const worst = [...items].filter((i) => i.total >= 20).sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99))[0];
  const callout = (ins?.items ?? []).find((i) => i.kind === dim);
  const sec = dim === "division" ? "division" : "region";
  const bucket = bd?.bucket ?? "day";
  const ts = bd?.t ?? [];

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t(`section.${sec}.title`)} lead={t(`section.${sec}.lead`)} />
      {bd === undefined ? (
        <Skeleton rows={6} />
      ) : !bd || !items.length ? (
        <p className="issb-empty">{t("dim.empty")}</p>
      ) : (
        <div className="issb-stack">
          {callout ? (
            <p className="issb-standout" data-sev={callout.severity}>
              {fx.insight(callout)}
              <FootRef k={`ins:${callout.id}`} />
            </p>
          ) : worst ? (
            <p className="issb-standout">
              {t("dim.worst", { value: fx.value(dim, worst.value), rate: fx.pct(worst.fail_rate), delta: fx.pp(worst.delta) })}
              <FootRef k={noteKey(dim, worst.value)} />
            </p>
          ) : null}
          <Figure n={`${no}.1`} title={t(`dim.fig.${dim}`)} src={`/issues/breakdown?dim=${dim}`} aside={<DeltaLegend />}>
            <div className="issb-dimgrid" ref={attach} data-n={sorted.length}>
              {sorted.map((it, k) => {
                const active = f.values[dim].includes(it.value);
                return (
                  <article key={it.value} className={clsx("issb-dimc", active && "on")} data-dir={deltaDir(it.delta)} style={{ ["--i" as string]: k }}>
                    <button
                      type="button"
                      className="issb-dimc-h"
                      aria-pressed={active}
                      onClick={() => f.toggle(dim, it.value)}
                      title={t("markets.filter", { value: fx.value(dim, it.value) })}
                    >
                      <span className="issb-dimc-code">{it.value}</span>
                      <span className="issb-dimc-name">{fx.value(dim, it.value)}</span>
                      <span className="issb-dimc-v">{fx.pct(it.fail_rate)}</span>
                      <Delta d={it.delta} fx={fx} />
                    </button>
                    <div className="issb-dimc-sub mono">
                      FAIL {fmt.number(it.fails)} / {fmt.number(it.total)} · {t("dim.shareOf", { share: fx.pct(it.share) })}
                      <FootRef k={noteKey(dim, it.value)} />
                    </div>
                    <div className="issb-dimc-spark">
                      <Spark values={it.trend_rate} base={it.baseline_fail_rate} max={smax} w={240} h={40} label={t("dim.trend", { value: fx.value(dim, it.value) })} />
                      <div className="issb-spark-hits">
                        {it.trend_rate.map((r, j) => (
                          <span
                            key={j}
                            tabIndex={-1}
                            {...on(
                              <>
                                <b>
                                  {fx.value(dim, it.value)} · {ts[j] ? (bucket === "hour" ? fmt.dateTimeLabel(ts[j]) : fmt.dateLabel(ts[j])) : j + 1}
                                </b>
                                <div>
                                  {s("kpi.failRate")} {fx.pct(r)} · FAIL {fmt.number(it.trend[j] ?? 0)}
                                </div>
                                <div>Baseline {fx.pct(it.baseline_fail_rate)}</div>
                              </>,
                            )}
                          />
                        ))}
                      </div>
                    </div>
                    <SevStrip by={it.by_severity} total={it.issues} />
                    <ol className="issb-dimc-top">
                      {it.top_issues.map((x) => (
                        <li key={x.id}>
                          <span className="iss-sev" data-sev={x.severity}>
                            {x.severity}
                          </span>
                          <Link href={B.issueHref(x.id)} title={fx.text(x.title)}>
                            {fx.text(x.title)}
                          </Link>
                          <small className="mono">{x.count_in_value}</small>
                        </li>
                      ))}
                    </ol>
                    {it.top_pattern ? (
                      <p className="issb-dimc-pat">
                        <span>{t("dim.newPattern")}</span> “{it.top_pattern.template}” <small className="mono">{fx.kind(it.top_pattern.kind)}</small>
                      </p>
                    ) : null}
                    <footer className="issb-dimc-f">
                      <Link className="issb-link" href={B.view([[dim, it.value]], "triage")}>
                        {t("dim.triage")} <ArrowUpRight aria-hidden />
                      </Link>
                      <Link className="issb-link" href={B.view([[dim, it.value]], "analysis")}>
                        {t("dim.analysis")} <ArrowUpRight aria-hidden />
                      </Link>
                    </footer>
                  </article>
                );
              })}
              {el}
            </div>
          </Figure>
        </div>
      )}
    </section>
  );
}
