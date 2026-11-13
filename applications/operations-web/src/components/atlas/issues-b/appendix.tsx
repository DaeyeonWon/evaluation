"use client";
/**
 * Market Brief — §6 Statistical appendix: FAIL trend (critical vs other), factor profile, severity × status,
 * risk class, per-column FAIL statistics (rows toggle filters → the brief regenerates), top movers.
 */
import clsx from "clsx";
import { useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { IssueColumn, IssueStatus, IssueSummary, SeverityClass } from "@/lib/types";
import { EChart } from "@/components/shared";
import { ISSUE_COLUMNS, ISSUE_STATUS_ORDER, type IssueFiltersApi, type IssueFormat } from "../issues-shared";
import { axisX, axisY, baseOpt, opt, tooltip } from "../chart";
import { Skeleton, useReducedMotionSafe } from "../ui";
import { ClsTag, Delta, deltaDir, Figure, Sev, StatusTag, useTip } from "./bits";
import { FactorBar } from "./dossiers";
import { SecHead } from "./sec";

export function Appendix({ id, no, sum, f, fx }: { id: string; no: number; sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesB");
  const s = useT("issues");
  const fmt = useFmt();
  const reduced = useReducedMotionSafe();
  const [col, setCol] = useState<IssueColumn>("agent_function");
  const { attach: sevTipAttach, on: sevTipOn, el: sevTipEl } = useTip();

  if (!sum)
    return (
      <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
        <SecHead id={id} no={no} title={t("section.appendix.title")} lead={t("section.appendix.lead")} />
        <Skeleton rows={6} />
      </section>
    );

  const pts = sum.trend.points;
  const bucket = sum.trend.bucket;
  const lab = (x: number) => (bucket === "hour" ? fmt.hm(x) : fmt.dateLabel(x));
  const maxCls = Math.max(1, ...sum.class_distribution.map((c) => c.fails));
  const sevMax = Math.max(1, ...sum.severity_distribution.map((d) => d.issues));
  const rows = sum.columns[col] ?? [];
  const rmax = Math.max(1, ...rows.map((r) => Math.max(r.fail_rate, r.baseline_fail_rate ?? 0)));
  const fmtVal = (c: string, v: string) => fx.value(c, v);

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.appendix.title")} lead={t("section.appendix.lead")} />
      <div className="issb-app">
        <Figure n="6.1" title={t("appendix.figTrend", { bucket: s(`bucket.${bucket}`) })} src={t("sources.summary")} className="span2">
          <EChart
            className="issb-chart"
            ariaLabel={t("appendix.figTrend", {
              bucket: s(`bucket.${bucket}`),
            })}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, {
                  grid: { left: 40, right: 10, top: 30, bottom: 26 },
                }),
                tooltip: tooltip(tk, {
                  formatter: (ps: { dataIndex: number }[]) => {
                    const p = pts[ps[0]?.dataIndex ?? 0];
                    if (!p) return "";
                    return `<b>${bucket === "hour" ? fmt.dateTimeLabel(p.t) : fmt.dateLabel(p.t)}</b><br/>${t("appendix.critical")}: ${p.critical_fails}<br/>${t("appendix.other")}: ${p.fails - p.critical_fails}<br/>${s("kpi.failRate")}: ${fx.pct(p.fail_rate)} (${fmt.number(p.fails)} / ${fmt.number(p.total)})<br/>${s("kpi.newPatterns")}: ${p.new_pattern_rows}`;
                  },
                }),
                legend: {
                  top: 0,
                  left: 0,
                  icon: "roundRect",
                  itemWidth: 10,
                  itemHeight: 10,
                  textStyle: {
                    color: tk.muted,
                    fontSize: 11,
                    fontFamily: tk.font,
                  },
                },
                xAxis: axisX(
                  tk,
                  pts.map((p) => lab(p.t)),
                  { boundaryGap: true },
                ),
                yAxis: axisY(tk, { minInterval: 1 }),
                series: [
                  {
                    name: t("appendix.critical"),
                    type: "bar",
                    stack: "f",
                    barMaxWidth: 26,
                    itemStyle: {
                      color: tk.read("--sev-p0"),
                      borderColor: tk.surface,
                      borderWidth: 1,
                    },
                    data: pts.map((p) => p.critical_fails),
                  },
                  {
                    name: t("appendix.other"),
                    type: "bar",
                    stack: "f",
                    barMaxWidth: 26,
                    itemStyle: {
                      color: tk.read("--issb-neutral-bar", "#9aa8b6"),
                      borderRadius: [3, 3, 0, 0],
                      borderColor: tk.surface,
                      borderWidth: 1,
                    },
                    data: pts.map((p) => p.fails - p.critical_fails),
                  },
                ],
              })
            }
          />
        </Figure>

        <div className="issb-app-col">
          <Figure n="6.2" title={t("appendix.figSeverity")} src={t("sources.summary")} aside={<StatusLegend fx={fx} />}>
            <div className="issb-rel" ref={sevTipAttach}>
              <ul className="issb-sevd">
                {sum.severity_distribution.map((d) => (
                  <li key={d.severity}>
                    <button
                      type="button"
                      className={clsx("issb-sevd-r", f.values.severity.includes(d.severity) && "on")}
                      onClick={() => f.toggle("severity", d.severity)}
                      aria-pressed={f.values.severity.includes(d.severity)}
                    >
                      <Sev s={d.severity} />
                      <span
                        className="issb-sevd-track"
                        style={{
                          width: `${Math.max(2, (d.issues / sevMax) * 100)}%`,
                        }}
                      >
                        {ISSUE_STATUS_ORDER.map((st) =>
                          d.by_status[st] ? (
                            <i
                              key={st}
                              data-st={st}
                              style={{ flexGrow: d.by_status[st] }}
                              {...sevTipOn(
                                <>
                                  <b>
                                    {d.severity} · {fx.status(st)}
                                  </b>
                                  <div>
                                    {s("kpi.issues")} {d.by_status[st]}
                                  </div>
                                </>,
                              )}
                            />
                          ) : null,
                        )}
                      </span>
                      <span className="issb-sevd-n mono">
                        {d.issues} <small>· FAIL {fmt.number(d.fails)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {sevTipEl}
            </div>
          </Figure>
          <Figure n="6.3" title={t("appendix.figClass")} src={t("sources.summary")}>
            <ul className="issb-clsd">
              {sum.class_distribution.map((c) => (
                <li key={c.cls}>
                  <button
                    type="button"
                    className={clsx("issb-clsd-r", f.values.severity_class.includes(c.cls) && "on")}
                    onClick={() => f.toggle("severity_class", c.cls)}
                    aria-pressed={f.values.severity_class.includes(c.cls)}
                  >
                    <ClsTag c={c.cls as SeverityClass} fx={fx} />
                    <span className="issb-clsd-track">
                      <i data-cls={c.cls} style={{ width: `${(c.fails / maxCls) * 100}%` }} />
                    </span>
                    <span className="mono">
                      {fmt.number(c.fails)} <small>· {c.issues}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Figure>
        </div>

        <div className="issb-app-col">
          <Figure n="6.4" title={t("appendix.figFactors")} src={t("sources.summary")}>
            <FactorBar parts={sum.factor_profile} fx={fx} />
          </Figure>
          <Figure n="6.5" title={t("appendix.figMovers")} src={t("sources.summary")}>
            <ul className="issb-movers">
              {sum.top_movers.slice(0, 8).map((m) => (
                <li key={`${m.column}:${m.value}`}>
                  <button type="button" onClick={() => f.toggle(m.column, m.value)} aria-pressed={f.values[m.column].includes(m.value)}>
                    <span className="issb-movers-l">
                      <small>{fx.column(m.column)}</small> {fmtVal(m.column, m.value)}
                    </span>
                    <span className="issb-movers-bar" data-dir={deltaDir(m.delta)}>
                      <i
                        style={{
                          width: `${Math.min(50, Math.abs(m.delta) * 2)}%`,
                        }}
                      />
                    </span>
                    <Delta d={m.delta} fx={fx} />
                  </button>
                </li>
              ))}
            </ul>
          </Figure>
        </div>

        <Figure n="6.6" title={t("appendix.figColumns")} src={t("sources.summary")} className="span2" aside={<span className="issb-hintx">{t("appendix.clickToFilter")}</span>}>
          <div className="issb-coltabs" role="tablist" aria-label={t("appendix.figColumns")}>
            {ISSUE_COLUMNS.map((c) => (
              <button key={c} role="tab" type="button" aria-selected={col === c} className={clsx(col === c && "on")} onClick={() => setCol(c)}>
                {fx.column(c)}
              </button>
            ))}
          </div>
          <div className="tbl-wrap issb-coltbl">
            <table className="t">
              <thead>
                <tr>
                  <th>{t("appendix.value")}</th>
                  <th className="r">{t("appendix.total")}</th>
                  <th className="r">{t("appendix.fails")}</th>
                  <th>{s("field.failRate")}</th>
                  <th className="r">{t("appendix.baseline")}</th>
                  <th className="r">{t("appendix.delta")}</th>
                  <th className="r">{t("appendix.issues")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = f.values[col].includes(r.value);
                  return (
                    <tr key={r.value} className={clsx("click", on && "on")} onClick={() => f.toggle(col, r.value)} aria-selected={on}>
                      <td>
                        <button type="button" className="issb-cellbtn" aria-pressed={on} onClick={(e) => (e.stopPropagation(), f.toggle(col, r.value))}>
                          {fmtVal(col, r.value)}
                        </button>
                      </td>
                      <td className="r mono">{fmt.number(r.total)}</td>
                      <td className="r mono">{fmt.number(r.fails)}</td>
                      <td>
                        <span className="issb-cellbar">
                          <i data-dir={deltaDir(r.delta)} style={{ width: `${(r.fail_rate / rmax) * 100}%` }} />
                          {r.baseline_fail_rate != null ? (
                            <b
                              style={{
                                left: `${(r.baseline_fail_rate / rmax) * 100}%`,
                              }}
                            />
                          ) : null}
                          <span className="mono">{fx.pct(r.fail_rate)}</span>
                        </span>
                      </td>
                      <td className="r mono">{fx.pct(r.baseline_fail_rate)}</td>
                      <td className="r">
                        <Delta d={r.delta} fx={fx} />
                      </td>
                      <td className="r mono">{r.issues}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Figure>
      </div>
    </section>
  );
}

function StatusLegend({ fx }: { fx: IssueFormat }) {
  return (
    <span className="issb-legend issb-stlegend" role="list">
      {ISSUE_STATUS_ORDER.map((st: IssueStatus) => (
        <span role="listitem" key={st}>
          <StatusTag s={st} fx={fx} />
        </span>
      ))}
    </span>
  );
}
