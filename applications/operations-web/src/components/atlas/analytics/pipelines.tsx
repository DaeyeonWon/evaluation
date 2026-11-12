"use client";
/**
 * Analytics · per-pipeline and per-sub-pipeline views.
 * - Root pipelines and sub-pipelines: avg / p95 run duration and failures over the period
 *   (AnalyticsSummary.pipelineSummary = GET /pipelines rows).
 * - Drill-down: one pipeline's node aggregates (GET /pipelines/{id}?version=) — durations of
 *   SUCCEEDED nodes, status counts, top error with its failure path. Sub-pipeline nodes link
 *   to their own definition.
 */
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { EChart } from "@/components/shared";
import type { ChartTokens } from "@/components/shared";
import { api, parseAsString, useApi, useQueryState } from "@/lib/client";
import type { JobStatus, PipelineSummary } from "@/lib/types";
import { statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { axisY, barLabel, baseOpt, catY, opt, tooltip } from "../chart";
import { Plate, Skeleton, useReducedMotionSafe } from "../ui";
import { QueryError, RangeTag } from "./kit";

const MIN = 60e3;
const legend = (tk: ChartTokens) => ({ top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: tk.muted, fontSize: 11, fontFamily: tk.font } });

function DurationChart({ rows, aria }: { rows: { id: string; avgMs: number; p95Ms: number; n: number }[]; aria: string }) {
  const t = useT("analytics");
  const reduced = useReducedMotionSafe();
  if (!rows.length) return <div className="ad-empty-chart">{t("empty.noRuns")}</div>;
  return (
    <EChart
      className="chart"
      style={{ height: Math.max(170, 50 + rows.length * 40) }}
      ariaLabel={aria}
      option={(tk) =>
        opt({
          ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 46, top: 26, bottom: 26 } }),
          legend: legend(tk),
          tooltip: tooltip(tk, { valueFormatter: (v: number) => (v == null ? "—" : `${v.toFixed(1)} ${t("units.min")}`) }),
          xAxis: axisY(tk, { name: t("units.min"), nameLocation: "end", nameGap: 6 }),
          yAxis: catY(tk, rows.map((r) => r.id), { axisLabel: { color: tk.text, fontSize: 11, fontFamily: tk.mono } }),
          series: [
            { name: t("series.avg"), type: "bar", barWidth: 8, barGap: "30%", itemStyle: { color: tk.read("--sx-metric"), borderRadius: [0, 3, 3, 0] }, data: rows.map((r) => +(r.avgMs / MIN).toFixed(2)) },
            { name: "p95", type: "bar", barWidth: 8, itemStyle: { color: tk.muted, borderRadius: [0, 3, 3, 0] }, data: rows.map((r) => +(r.p95Ms / MIN).toFixed(2)) },
          ],
        })
      }
    />
  );
}

function FailureChart({ rows, aria }: { rows: PipelineSummary[]; aria: string }) {
  const t = useT("analytics");
  const reduced = useReducedMotionSafe();
  if (!rows.length) return <div className="ad-empty-chart">{t("empty.noRuns")}</div>;
  return (
    <EChart
      className="chart"
      style={{ height: Math.max(170, 50 + rows.length * 40) }}
      ariaLabel={aria}
      option={(tk) =>
        opt({
          ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 64, top: 26, bottom: 26 } }),
          legend: legend(tk),
          tooltip: tooltip(tk, {
            formatter: (ps: { dataIndex: number }[]) => {
              const r = rows[ps[0].dataIndex];
              const fr = r.succeeded + r.failed ? r.failed / (r.succeeded + r.failed) : 0;
              return `<b style="font-family:${tk.mono}">${r.id}</b><br/>${t("series.failed")} ${r.failed} · ${t("series.cancelled")} ${r.cancelled}<br/>${t("series.failureRate")} ${(fr * 100).toFixed(1)}% · ${t("series.runs")} ${r.runs}`;
            },
          }),
          xAxis: axisY(tk, { minInterval: 1 }),
          yAxis: catY(tk, rows.map((r) => r.id), { axisLabel: { color: tk.text, fontSize: 11, fontFamily: tk.mono } }),
          series: [
            { name: t("series.failed"), type: "bar", stack: "f", barWidth: 12, itemStyle: { color: tk.tone.failed }, data: rows.map((r) => r.failed) },
            {
              name: t("series.cancelled"),
              type: "bar",
              stack: "f",
              barWidth: 12,
              itemStyle: { color: tk.tone.cancelled, borderRadius: [0, 3, 3, 0] },
              data: rows.map((r) => r.cancelled),
              label: {
                ...barLabel(tk),
                formatter: (p: { dataIndex: number }) => {
                  const r = rows[p.dataIndex];
                  return r.succeeded + r.failed ? `${((r.failed / (r.succeeded + r.failed)) * 100).toFixed(1)}%` : "";
                },
              },
            },
          ],
        })
      }
    />
  );
}

function Drill({ id, params, rangeKey, onPick }: { id: string; params: Record<string, string>; rangeKey: string; onPick: (id: string) => void }) {
  const t = useT("analytics");
  const locale = useLocale();
  const f = useFmt();
  const reduced = useReducedMotionSafe();
  const q = useApi(["pipeline", id, rangeKey], () => api.pipeline(id, { ...params }), { revalidateOn: ["transition"], throttleMs: 15000 });
  if (q.error) return <QueryError error={q.error} />;
  const d = q.data?.definition.id === id ? q.data : undefined;
  if (!d) return <Skeleton rows={6} />;
  const ns = d.nodeStats;
  const dur = ns.filter((n) => n.duration.n > 0);
  const STS: JobStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED", "SKIPPED"];
  return (
    <div className="ad-drill">
      <div className="ad-drill-head">
        <b className="mono">
          {d.definition.id}@{d.version}
        </b>
        <span className="muted">{locale === "en" ? d.definition.label : d.definition.labelKo}</span>
        <span className="chip">{d.definition.kind === "root" ? t("pipelines.root") : t("pipelines.sub")}</span>
        {d.definition.usedBy.length ? (
          <span className="muted mono" style={{ fontSize: 11 }}>
            {t("pipelines.usedBy", { list: d.definition.usedBy.join(", ") })}
          </span>
        ) : null}
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11.5 }}>
          {t("pipelines.summary", { runs: d.summary.runs, rate: d.summary.successRate == null ? "—" : f.pct(d.summary.successRate, 1), avg: f.duration(d.summary.avgDurationMs, { style: "short" }) })}
        </span>
      </div>
      <div className="split s-55">
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            {t("pipelines.nodeDuration")}
          </div>
          {dur.length ? (
            <EChart
              className="chart"
              style={{ height: Math.max(160, 50 + dur.length * 36) }}
              ariaLabel={t("pipelines.nodeDuration")}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 30, top: 26, bottom: 26 } }),
                  legend: legend(tk),
                  tooltip: tooltip(tk, { valueFormatter: (v: number) => (v == null ? "—" : `${v.toFixed(1)} ${t("units.min")}`) }),
                  xAxis: axisY(tk, { name: t("units.min"), nameLocation: "end", nameGap: 6 }),
                  yAxis: catY(tk, dur.map((n) => n.node_id), { axisLabel: { color: tk.text, fontSize: 11, fontFamily: tk.mono } }),
                  series: [
                    { name: "p50", type: "bar", barWidth: 8, barGap: "30%", itemStyle: { color: tk.read("--sx-metric"), borderRadius: [0, 3, 3, 0] }, data: dur.map((n) => +(n.duration.p50Ms / MIN).toFixed(2)) },
                    { name: "p95", type: "bar", barWidth: 8, itemStyle: { color: tk.muted, borderRadius: [0, 3, 3, 0] }, data: dur.map((n) => +(n.duration.p95Ms / MIN).toFixed(2)) },
                  ],
                })
              }
            />
          ) : (
            <div className="ad-empty-chart">{t("empty.noRuns")}</div>
          )}
        </div>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Node</th>
                {STS.map((s) => (
                  <th key={s} className="r" title={statusLabel("node", s, locale)}>
                    {statusLabel("node", s, locale)}
                  </th>
                ))}
                <th>{t("pipelines.topError")}</th>
              </tr>
            </thead>
            <tbody>
              {ns.map((n) => (
                <tr key={n.node_id}>
                  <td>
                    {n.ref ? (
                      <button className="btn sm ghost ad-link" onClick={() => onPick(n.ref!.pipeline_id)} title={t("pipelines.openSub", { id: n.ref.pipeline_id })}>
                        <span className="mono">{n.node_id}</span>
                        <span className="muted mono" style={{ fontSize: 10.5 }}>
                          ⟨{n.ref.pipeline_id}@{n.ref.version}⟩
                        </span>
                        <ChevronRight aria-hidden />
                      </button>
                    ) : (
                      <span className="mono">{n.node_id}</span>
                    )}
                  </td>
                  {STS.map((s) => (
                    <td key={s} className={clsx("mono r", s === "FAILED" && n.counts.FAILED > 0 && "sev-ERROR")}>
                      {n.counts[s] ?? 0}
                    </td>
                  ))}
                  <td className="mono" style={{ fontSize: 11 }}>
                    {n.topError ? (
                      <>
                        <span className="sev-ERROR">{n.topError.code}</span> ×{n.topError.count}
                        {n.topError.path ? (
                          <>
                            <br />
                            <span className="muted">{n.topError.path}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function PipelineViews({ summary, params, rangeKey, rangeLabel }: { summary: PipelineSummary[] | undefined; params: Record<string, string>; rangeKey: string; rangeLabel: string }) {
  const t = useT("analytics");
  const [pick, setPick] = useQueryState("pipeline", parseAsString);
  const all = summary ?? [];
  const roots = all.filter((p) => p.kind === "root").sort((a, b) => b.runs - a.runs);
  const subs = all.filter((p) => p.kind === "sub").sort((a, b) => b.runs - a.runs);
  const dur = (rows: PipelineSummary[]) => rows.filter((r) => r.succeeded > 0).map((r) => ({ id: r.id, avgMs: r.avgDurationMs, p95Ms: r.p95DurationMs, n: r.succeeded }));
  const sel = pick && all.some((p) => p.id === pick) ? pick : (roots[0]?.id ?? null);
  return (
    <>
      <div className="ad-section">
        <span className="dwg">{t("pipelines.section")}</span>
        <RangeTag label={rangeLabel} />
      </div>
      <div className="split s-55">
        <Plate title={t("pipelines.rootDuration")} refText={t("pipelines.durationRef")}>
          {summary ? <DurationChart rows={dur(roots)} aria={t("pipelines.rootDuration")} /> : <Skeleton rows={5} />}
        </Plate>
        <Plate title={t("pipelines.rootFailures")} refText={t("pipelines.failuresRef")}>
          {summary ? <FailureChart rows={roots} aria={t("pipelines.rootFailures")} /> : <Skeleton rows={5} />}
        </Plate>
      </div>
      <div className="split s-55">
        <Plate title={t("pipelines.subDuration")} refText={t("pipelines.subRef")}>
          {summary ? <DurationChart rows={dur(subs)} aria={t("pipelines.subDuration")} /> : <Skeleton rows={5} />}
        </Plate>
        <Plate title={t("pipelines.subFailures")} refText={t("pipelines.failuresRef")}>
          {summary ? <FailureChart rows={subs} aria={t("pipelines.subFailures")} /> : <Skeleton rows={5} />}
        </Plate>
      </div>
      <Plate title={t("pipelines.drill")} refText={t("pipelines.drillRef")}>
        <div className="chipset ad-pipe-chips" role="group" aria-label={t("pipelines.drill")}>
          {[...roots, ...subs].map((p) => (
            <button key={p.id} aria-pressed={sel === p.id} className={clsx("mono", p.kind === "sub" && "ad-sub")} onClick={() => setPick(p.id)}>
              {p.id}
            </button>
          ))}
        </div>
        {sel ? <Drill id={sel} params={params} rangeKey={rangeKey} onPick={(id) => setPick(id)} /> : <div className="ad-empty-chart">{t("empty.noRuns")}</div>}
      </Plate>
    </>
  );
}
