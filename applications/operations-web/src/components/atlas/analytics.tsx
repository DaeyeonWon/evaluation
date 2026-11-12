"use client";
/**
 * S-07 · Analytics over the global period (BigQuery-style aggregates from /api/v1/analytics/*).
 * Buckets: 5-min for ≤ 24h, hourly for ≤ 7d, daily for 30d — per chart, falling back to the nearest
 * bucket that carries the metric (the plate's ref text always names the bucket actually drawn).
 * Per-pipeline / per-sub-pipeline durations and failures live in ./analytics/pipelines.
 */
import "@/styles/atlas-data.css";
import { useMemo } from "react";
import { EChart, LangBadge } from "@/components/shared";
import type { ChartTokens } from "@/components/shared";
import { CAPSULES, LANG_CODES } from "@/lib/catalog";
import { api, parseAsString, useApi, useQueryState, useSimNow } from "@/lib/client";
import type { FailureCategory } from "@/lib/types";
import { capsuleLabel, failureCategoryLabel, languageName } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { axisX, axisY, barLabel, baseOpt, catY, opt, tooltip, verColor } from "./chart";
import { Plate, Sheet, SheetHead, Skeleton, useReducedMotionSafe } from "./ui";
import { QueryError, RangeTag, useRangeInfo, type Bucket } from "./analytics/kit";
import { PipelineViews } from "./analytics/pipelines";
import { durations, errorTrend, incidentAreas, labelInterval, rates, throughput, type Series } from "./analytics/series";

const COST_KEYS = ["vertex", "llmJudge", "workflows", "cloudRun", "firestore", "bigquery", "storage"] as const;
const COST_LAB: Record<(typeof COST_KEYS)[number], string> = { vertex: "Vertex AI", llmJudge: "LLM Judge", workflows: "Cloud Workflows", cloudRun: "Cloud Run", firestore: "Firestore", bigquery: "BigQuery", storage: "Cloud Storage" };
const CATS: FailureCategory[] = ["MODEL_TRANSIENT", "QUOTA", "TIMEOUT", "PIPELINE_EXECUTION", "CODE_DEFECT", "INPUT_SCHEMA", "AUTH_PERMISSION"];
const CAT_COLOR: Record<FailureCategory, string> = {
  MODEL_TRANSIENT: "--cost-1",
  QUOTA: "--cost-2",
  TIMEOUT: "--cost-3",
  PIPELINE_EXECUTION: "--cost-4",
  CODE_DEFECT: "--cost-5",
  INPUT_SCHEMA: "--cost-6",
  AUTH_PERMISSION: "--cost-7",
};
const pctAxis = (v: number) => Math.round(v * 100) + "%";

export function AnalyticsScreen() {
  const t = useT("analytics");
  const locale = useLocale();
  const fm = useFmt();
  const reduced = useReducedMotionSafe();
  const now = useSimNow();
  const tr0 = useRangeInfo();
  const rp = tr0.params;
  const [compPipe, setCompPipe] = useQueryState("comp", parseAsString);
  const sum = useApi(["analytics-summary", tr0.key], () => api.analyticsSummary({ ...rp }), { revalidateOn: ["transition"], throttleMs: 20000 });
  const errs = useApi(["analytics-errors", tr0.key], () => api.errors({ ...rp, top: 40 }), { revalidateOn: ["transition"], throttleMs: 20000 });
  const cost = useApi(["analytics-cost", tr0.key], () => api.cost({ ...rp }), { revalidateOnFocus: false });
  const inc = useApi(["incidents", tr0.key], () => api.incidentsPage({ ...rp }), { revalidateOnFocus: false });
  const tr = useRangeInfo(sum.data?.range);
  const s = sum.data;
  const want: Bucket = tr.bucket;
  const bucketName = (b: Bucket) => t(`bucket.${b}`);
  const ref = (b: Bucket, extra?: string) => [bucketName(b) + (b !== want ? ` (${t("bucket.fallback")})` : ""), extra].filter(Boolean).join(" · ");

  const thr = useMemo(() => (s ? throughput(s, want) : null), [s, want]);
  const rt = useMemo(() => (s ? rates(s, want) : null), [s, want]);
  const du = useMemo(() => (s ? durations(s) : null), [s]);
  const et = useMemo(() => (s ? errorTrend(s, want === "5m" ? "hour" : want, CATS) : null), [s, want]);
  const incidents = inc.data?.items ?? [];
  const area = (tk: ChartTokens, ser: Series | null) => ({
    silent: true,
    itemStyle: { color: tk.tone.failed, opacity: 0.07 },
    label: { show: false },
    data: ser ? incidentAreas(ser, incidents, now) : [],
  });
  const xCat = (tk: ChartTokens, ser: Series | null, boundaryGap = false) =>
    axisX(tk, ser?.labels ?? [], { boundaryGap, axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, interval: labelInterval(ser?.labels.length ?? 0), hideOverlap: true } });
  const zoom = (ser: Series | null) => ((ser?.labels.length ?? 0) > 60 ? [{ type: "inside" }] : []);

  const top = (errs.data?.topErrorCodes ?? []).slice(0, 10);
  const paths = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const e of errs.data?.topErrorCodes ?? []) for (const [p, n] of Object.entries(e.paths ?? {})) acc[p] = (acc[p] ?? 0) + n;
    return Object.entries(acc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [errs.data]);
  const vc = s?.versionComparison ?? [];
  const ls = s?.languageSummary ?? [];
  const roots = (s?.pipelineSummary ?? []).filter((p) => p.kind === "root");
  const rootIds = roots.map((p) => p.id);
  const comp = useMemo(() => {
    const all = s?.componentDurations ?? [];
    if (!compPipe) return all.map((c) => ({ id: c.component, label: c.label, avg: c.avgSec, p95: c.p95Sec, n: c.n }));
    return all
      .filter((c) => c.byPipeline?.[compPipe])
      .map((c) => ({ id: c.component, label: c.label, avg: c.byPipeline![compPipe].avgSec, p95: c.byPipeline![compPipe].p95Sec, n: c.byPipeline![compPipe].n }));
  }, [s, compPipe]);

  // headline numbers for the period
  const runs = roots.reduce((a, p) => a + p.runs, 0);
  const succ = roots.reduce((a, p) => a + p.succeeded, 0);
  const fail = roots.reduce((a, p) => a + p.failed, 0);
  const utt = ls.reduce((a, l) => a + l.utterancesToday, 0);
  const passN = ls.reduce((a, l) => a + (l.passRateToday ?? 0) * l.utterancesToday, 0);
  const dlq = ls.reduce((a, l) => a + l.deadLettered, 0);

  return (
    <Sheet>
      <SheetHead dwg="SHEET S-07 · ANALYTICS" title={t("title")} desc={t("desc")} acts={<span className="chip mono">bixby-eval-prod.bixby_eval.pipeline_events</span>} />
      <QueryError error={sum.error} />
      <div className="kpis">
        <div className="kpi">
          <div className="k">{t("kpi.period")}</div>
          <div className="v" style={{ fontSize: 17, whiteSpace: "normal" }}>
            {tr.label}
          </div>
          <div className="s">{t("kpi.bucket", { bucket: bucketName(want) })}</div>
        </div>
        <div className="kpi">
          <div className="k">{t("kpi.runs")}</div>
          <div className="v">{s ? fm.number(runs) : "—"}</div>
          <div className="s">{t("kpi.runsSub", { ok: succ, failed: fail })}</div>
        </div>
        <div className="kpi" data-tone style={{ ["--tc" as string]: "var(--st-success)" }}>
          <div className="k">{t("kpi.successRate")}</div>
          <div className="v">{s && succ + fail ? fm.pct(succ / (succ + fail), 1) : "—"}</div>
          <div className="s">{t("kpi.successSub")}</div>
        </div>
        <div className="kpi">
          <div className="k">{t("kpi.utterances")}</div>
          <div className="v">{s ? fm.number(utt) : "—"}</div>
          <div className="s">{t("kpi.passRate", { rate: utt ? fm.pct(passN / utt, 1) : "—" })}</div>
        </div>
        <div className="kpi" data-tone style={{ ["--tc" as string]: "var(--st-dlq)" }}>
          <div className="k">DLQ</div>
          <div className="v">{s ? fm.number(dlq) : "—"}</div>
          <div className="s">{t("kpi.dlqSub")}</div>
        </div>
        <div className="kpi">
          <div className="k">{t("kpi.cost")}</div>
          <div className="v">{cost.data ? fm.usd(cost.data.total7d) : "—"}</div>
          <div className="s">{t("kpi.costSub", { count: cost.data?.daily.length ?? 0 })}</div>
        </div>
      </div>
      {!s && !sum.error ? <Skeleton rows={6} /> : null}

      <div className="split s-55">
        <Plate title={t("charts.throughput")} refText={thr ? ref(thr.bucket, t("charts.throughputRef")) : undefined}>
          <EChart
            className="chart"
            ariaLabel={t("charts.throughput")}
            loading={!s}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 46, right: 14, top: 32, bottom: 28 } }),
                xAxis: xCat(tk, thr, true),
                yAxis: axisY(tk, { minInterval: 1 }),
                dataZoom: zoom(thr),
                series: LANG_CODES.map((c, i) => ({
                  name: c.toUpperCase(),
                  type: "bar",
                  stack: "d",
                  barMaxWidth: 22,
                  itemStyle: { color: tk.lang[c], ...(i === LANG_CODES.length - 1 ? { borderRadius: [3, 3, 0, 0] } : {}) },
                  data: thr?.byLang[c] ?? [],
                  ...(i === 0 ? { markArea: area(tk, thr) } : {}),
                })),
              })
            }
          />
        </Plate>
        <Plate title={t("charts.rates")} refText={rt ? ref(rt.bucket) : undefined}>
          <EChart
            className="chart"
            ariaLabel={t("charts.rates")}
            loading={!s}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 46, right: 14, top: 32, bottom: 28 } }),
                xAxis: xCat(tk, rt),
                yAxis: axisY(tk, { max: 1, axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: pctAxis } }),
                tooltip: tooltip(tk, { valueFormatter: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%") }),
                dataZoom: zoom(rt),
                series: [
                  { name: t("series.successRate"), type: "line", showSymbol: false, connectNulls: true, lineStyle: { width: 2, color: tk.tone.success }, itemStyle: { color: tk.tone.success }, data: rt?.success ?? [], markArea: area(tk, rt) },
                  { name: t("series.retryRate"), type: "line", showSymbol: false, connectNulls: true, lineStyle: { width: 2, color: tk.tone.retry }, itemStyle: { color: tk.tone.retry }, areaStyle: { color: tk.tone.retry, opacity: 0.08 }, data: rt?.retry ?? [] },
                ],
              })
            }
          />
        </Plate>
      </div>
      <div className="split s-55">
        <Plate title={t("charts.duration")} refText={du ? ref(du.bucket, t("units.sec")) : undefined}>
          <EChart
            className="chart"
            ariaLabel={t("charts.duration")}
            loading={!s}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 46, right: 14, top: 32, bottom: 28 } }),
                xAxis: xCat(tk, du),
                yAxis: axisY(tk),
                tooltip: tooltip(tk, { valueFormatter: (v: number | null) => (v == null ? "—" : `${fm.number(v)} ${t("units.secShort")}`) }),
                dataZoom: zoom(du),
                series: [
                  { name: t("series.avg"), type: "line", showSymbol: false, lineStyle: { width: 2, color: tk.read("--sx-metric") }, itemStyle: { color: tk.read("--sx-metric") }, data: du?.avg ?? [], markArea: area(tk, du) },
                  { name: "p95", type: "line", showSymbol: false, lineStyle: { width: 1.5, color: tk.muted, type: "dashed" }, itemStyle: { color: tk.muted }, data: du?.p95 ?? [] },
                ],
              })
            }
          />
        </Plate>
        <Plate title={t("charts.errorTrend")} refText={et ? ref(et.bucket, t("charts.errorTrendRef")) : undefined}>
          <EChart
            className="chart"
            ariaLabel={t("charts.errorTrend")}
            loading={!s}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 40, right: 14, top: 52, bottom: 28 } }),
                legend: { top: 0, left: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: tk.muted, fontSize: 10.5, fontFamily: tk.font } },
                xAxis: xCat(tk, et, true),
                yAxis: axisY(tk, { minInterval: 1 }),
                dataZoom: zoom(et),
                series: CATS.map((c) => ({ name: failureCategoryLabel(c, locale), type: "bar", stack: "e", barMaxWidth: 18, itemStyle: { color: tk.read(CAT_COLOR[c]) }, data: et?.byCat[c] ?? [] })),
              })
            }
          />
        </Plate>
      </div>

      <PipelineViews summary={s?.pipelineSummary} params={rp} rangeKey={tr0.key} rangeLabel={tr.label} />

      <div className="split s-55">
        <Plate
          title={t("charts.components")}
          right={
            <select className="in mono ad-sel" value={compPipe ?? ""} onChange={(e) => setCompPipe(e.target.value || null)} aria-label={t("charts.componentsFilter")}>
              <option value="">{t("charts.allPipelines")}</option>
              {rootIds.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          }
        >
          {comp.length || !s ? (
            <EChart
              className="chart"
              style={{ height: Math.max(260, 50 + comp.length * 24) }}
              ariaLabel={t("charts.components")}
              loading={!s}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 22, top: 28, bottom: 24 } }),
                  tooltip: tooltip(tk, {
                    formatter: (ps: { dataIndex: number }[]) => {
                      const c = comp[ps[0].dataIndex];
                      return `<b>${c.label}</b> <span style="font-family:${tk.mono}">${c.id}</span><br/>${t("series.avg")} ${c.avg}${t("units.secShort")} · p95 ${c.p95}${t("units.secShort")} · n=${c.n}`;
                    },
                  }),
                  xAxis: axisY(tk, { name: t("units.secShort"), nameLocation: "end", nameGap: 6 }),
                  yAxis: catY(tk, comp.map((x) => x.label), { axisLabel: { color: tk.text, fontSize: 11, fontFamily: tk.font } }),
                  series: [
                    { name: t("series.avg"), type: "bar", barWidth: 7, barGap: "30%", itemStyle: { color: tk.read("--sx-metric"), borderRadius: [0, 3, 3, 0] }, data: comp.map((x) => x.avg) },
                    { name: "p95", type: "bar", barWidth: 7, itemStyle: { color: tk.muted, borderRadius: [0, 3, 3, 0] }, data: comp.map((x) => x.p95) },
                  ],
                })
              }
            />
          ) : (
            <div className="ad-empty-chart">{t("empty.noRuns")}</div>
          )}
          <div className="mono muted" style={{ fontSize: 10.5, marginTop: 6 }}>
            {t("charts.componentsRef")}
          </div>
        </Plate>
        <Plate title={t("charts.paths")} refText={t("charts.pathsRef")}>
          {paths.length || !errs.data ? (
            <EChart
              className="chart"
              ariaLabel={t("charts.paths")}
              loading={!errs.data}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 40, top: 8, bottom: 22 } }),
                  legend: { show: false },
                  tooltip: tooltip(tk, { trigger: "item" }),
                  xAxis: axisY(tk, { minInterval: 1 }),
                  yAxis: catY(tk, paths.map(([p]) => p), { axisLabel: { color: tk.text, fontSize: 10.5, fontFamily: tk.mono, width: 210, overflow: "truncate" } }),
                  series: [{ name: t("series.failures"), type: "bar", barWidth: 10, itemStyle: { color: tk.tone.failed, borderRadius: [0, 3, 3, 0] }, data: paths.map(([, n]) => n), label: barLabel(tk) }],
                })
              }
            />
          ) : (
            <div className="ad-empty-chart">{t("empty.noErrors")}</div>
          )}
        </Plate>
      </div>

      <div className="split s-55">
        <Plate title={t("charts.topErrors")} refText={t("charts.topErrorsRef")}>
          <QueryError error={errs.error} />
          {top.length || !errs.data ? (
            <EChart
              className="chart"
              ariaLabel={t("charts.topErrors")}
              loading={!errs.data}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 34, top: 8, bottom: 22 } }),
                  legend: { show: false },
                  tooltip: tooltip(tk, {
                    trigger: "item",
                    formatter: (p: { dataIndex: number }) => {
                      const e = top[p.dataIndex];
                      return `<b style="font-family:${tk.mono}">${e.code}</b> ×${e.count}<br/>${failureCategoryLabel(e.category, locale)}<br/>${t("charts.lastAt", { time: fm.dateTimeLabel(e.lastAt) })}`;
                    },
                  }),
                  xAxis: axisY(tk, { minInterval: 1 }),
                  yAxis: catY(tk, top.map((x) => x.code), { axisLabel: { color: tk.text, fontSize: 10.5, fontFamily: tk.mono } }),
                  series: [{ name: t("series.failures"), type: "bar", barWidth: 10, itemStyle: { color: tk.tone.failed, borderRadius: [0, 3, 3, 0] }, data: top.map((x) => x.count), label: barLabel(tk) }],
                })
              }
            />
          ) : (
            <div className="ad-empty-chart">{t("empty.noErrors")}</div>
          )}
        </Plate>
        <Plate title={t("charts.cost")} refText={cost.data ? t("charts.costRef", { total: fm.usd(cost.data.total7d) }) : t("charts.costUnit")}>
          <EChart
            className="chart"
            ariaLabel={t("charts.cost")}
            loading={!cost.data}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 52, right: 14, top: 52, bottom: 28 } }),
                legend: { top: 0, left: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: tk.muted, fontSize: 10.5, fontFamily: tk.font } },
                xAxis: axisX(tk, (cost.data?.daily ?? []).map((x) => x.date.slice(5) + (x.partial ? "*" : "")), { boundaryGap: true, axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, hideOverlap: true } }),
                yAxis: axisY(tk, { axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: (v: number) => "$" + v } }),
                tooltip: tooltip(tk, { valueFormatter: (v: number) => fm.usd(v) }),
                series: COST_KEYS.map((k, i) => ({ name: COST_LAB[k], type: "bar", stack: "c", barMaxWidth: 22, itemStyle: { color: tk.read(`--cost-${i + 1}`) }, data: (cost.data?.daily ?? []).map((x) => x.costUsd[k]) })),
              })
            }
          />
        </Plate>
      </div>

      <Plate flush title={t("versions.title")} right={<RangeTag label={tr.label} />}>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Version</th>
                <th>{t("versions.statusTraffic")}</th>
                <th>{t("versions.model")}</th>
                <th className="r">{t("versions.runs")}</th>
                <th className="r">{t("versions.successRate")}</th>
                <th className="r">Retry</th>
                <th className="r">avg / p95</th>
                <th className="r">{t("versions.uttPass")}</th>
                <th className="r">{t("versions.devicePass")}</th>
                <th className="r">{t("versions.latency")}</th>
                <th className="r">Judge</th>
                <th className="r">$/run</th>
              </tr>
            </thead>
            <tbody>
              {vc.map((v) => {
                const dc = v.byCapsule.device_control;
                return (
                  <tr key={v.version}>
                    <td className="idc">{v.version}</td>
                    <td>
                      <span className="chip">
                        {v.status} · {v.trafficPct}%
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {v.modelUnderTest}
                      <br />
                      <span className="muted">{v.judgeModel}</span>
                    </td>
                    <td className="mono r">{fm.number(v.runs)}</td>
                    <td className="mono r">{fm.pct(v.pipelineSuccessRate, 1)}</td>
                    <td className="mono r">{fm.pct(v.retryRate, 1)}</td>
                    <td className="mono r">
                      {v.avgDurationSec}s / {v.p95DurationSec}s
                    </td>
                    <td className="mono r">{fm.pct(v.utterancePassRate, 1)}</td>
                    <td className="mono r" style={dc && (dc.passRate ?? 1) < 0.75 ? { color: "var(--st-failed)", fontWeight: 700 } : undefined}>
                      {dc ? fm.pct(dc.passRate, 1) : "—"}
                    </td>
                    <td className="mono r">{fm.number(v.p95LatencyMs)}ms</td>
                    <td className="mono r">{(v.avgJudgeScore || 0).toFixed(3)}</td>
                    <td className="mono r">{fm.usd(v.costPerRunUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="body">
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            {t("versions.capsuleChart")}
          </div>
          <EChart
            className="chart"
            ariaLabel={t("versions.capsuleChart")}
            loading={!s}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 46, right: 10, top: 30, bottom: 60 } }),
                legend: { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: tk.muted, fontSize: 11, fontFamily: tk.mono } },
                xAxis: axisX(
                  tk,
                  CAPSULES.map((c) => capsuleLabel(c.id, locale)),
                  { boundaryGap: true, axisLabel: { color: tk.text, fontSize: 10.5, rotate: 20, interval: 0, fontFamily: tk.font } },
                ),
                yAxis: axisY(tk, { min: 0.5, max: 1, axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: pctAxis } }),
                tooltip: tooltip(tk, { valueFormatter: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%") }),
                series: vc.map((v) => ({
                  name: v.version,
                  type: "bar",
                  barMaxWidth: 12,
                  itemStyle: { color: verColor(tk, v.version) },
                  data: CAPSULES.map((c) => (v.byCapsule[c.id]?.passRate != null ? +v.byCapsule[c.id].passRate!.toFixed(4) : null)),
                })),
              })
            }
          />
        </div>
      </Plate>
      <Plate flush title={t("languages.title")} right={<RangeTag label={tr.label} />}>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t("languages.language")}</th>
                <th className="r">Workflow</th>
                <th className="r">{t("languages.successRate")}</th>
                <th className="r">DLQ</th>
                <th className="r">avg / p95</th>
                <th className="r">{t("languages.utterances")}</th>
                <th className="r">{t("languages.passRate")}</th>
                <th className="r">{t("languages.throughput")}</th>
              </tr>
            </thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.code}>
                  <td>
                    <LangBadge lang={l.code} /> {languageName(l.code, locale)}
                  </td>
                  <td className="mono r">{fm.number(l.workflows)}</td>
                  <td className="mono r">{fm.pct(l.successRate, 1)}</td>
                  <td className="mono r">{l.deadLettered}</td>
                  <td className="mono r">
                    {l.avgDurationSec}s / {l.p95DurationSec}s
                  </td>
                  <td className="mono r">{fm.number(l.utterancesToday)}</td>
                  <td className="mono r">{fm.pct(l.passRateToday, 1)}</td>
                  <td className="mono r">{fm.number(Array.isArray(l.throughput7d) ? (l.throughput7d as number[]).reduce((a, b) => a + b, 0) : l.throughput7d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Plate>
    </Sheet>
  );
}
