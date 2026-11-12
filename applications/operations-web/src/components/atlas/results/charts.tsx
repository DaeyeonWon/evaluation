"use client";
/** Result charts (U-01). Every chart reads the server aggregates of the FILTERED, ranged rows. */
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/shared";
import type { ChartTokens } from "@/components/shared";
import { CAPSULES, FAILURE_REASON_META, LANG_CODES } from "@/lib/catalog";
import type { FailureReason, RateStat, ResultsAggregates } from "@/lib/types";
import { capsuleLabel, failureReasonLabel } from "@/i18n";
import { useLocale, useT } from "@/i18n/client";
import { axisX, axisY, barLabel, baseOpt, catY, opt, tooltip, verColor } from "../chart";
import { Plate, Skeleton, useReducedMotionSafe } from "../ui";
import type { F } from "../results";

const pctFmt = (v: number) => Math.round(v * 100) + "%";

/** Horizontal pass-rate bars for one dimension (pipeline_id, model_version, …). Single series. */
function RateBars({
  stats,
  active,
  onPick,
  ariaLabel,
  seriesName,
  rowsLabel,
}: {
  stats: Record<string, RateStat>;
  active: string | null;
  onPick: (k: string) => void;
  ariaLabel: string;
  seriesName: string;
  rowsLabel: (n: number) => string;
}) {
  const reduced = useReducedMotionSafe();
  const t = useT("results");
  const entries = Object.entries(stats)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);
  if (!entries.length) return <div className="ad-empty-chart">{t("charts.noRows")}</div>;
  const min = Math.min(...entries.map(([, v]) => v.passRate ?? 1));
  const xMin = min >= 0.55 ? 0.5 : 0;
  return (
    <EChart
      className="chart short"
      style={{ height: Math.max(150, 46 + entries.length * 34) }}
      ariaLabel={ariaLabel}
      onEvents={{
        click: (p) => {
          const k = entries[(p as { dataIndex: number }).dataIndex]?.[0];
          if (k) onPick(k);
        },
      }}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 96, top: 6, bottom: 24 } }),
          legend: { show: false },
          tooltip: tooltip(tk, {
            trigger: "item",
            formatter: (p: { dataIndex: number }) => {
              const [k, v] = entries[p.dataIndex];
              return `<b style="font-family:${tk.mono}">${k}</b><br/>${seriesName}: ${((v.passRate ?? 0) * 100).toFixed(1)}%<br/>PASS ${v.pass} · FAIL ${v.fail} · ${rowsLabel(v.total)}`;
            },
          }),
          xAxis: axisY(tk, { min: xMin, max: 1, axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: pctFmt } }),
          yAxis: catY(tk, entries.map(([k]) => k), { axisLabel: { color: tk.text, fontSize: 11, fontFamily: tk.mono } }),
          series: [
            {
              name: seriesName,
              type: "bar",
              barWidth: 12,
              data: entries.map(([k, v]) => ({
                value: v.passRate == null ? null : +v.passRate.toFixed(4),
                itemStyle: { color: tk.read("--sx-metric"), opacity: active && active !== k ? 0.35 : 1, borderRadius: [0, 3, 3, 0] },
              })),
              label: { ...barLabel(tk), formatter: (p: { dataIndex: number }) => `${((entries[p.dataIndex][1].passRate ?? 0) * 100).toFixed(1)}% · n=${entries[p.dataIndex][1].total}` },
            },
          ],
        })
      }
    />
  );
}

export function ResultCharts({ ag, f, onPick, rangeLabel }: { ag: ResultsAggregates | undefined; f: F; onPick: (p: Partial<F>) => void; rangeLabel: string }) {
  const reduced = useReducedMotionSafe();
  const t = useT("results");
  const tc = useT("common");
  const locale = useLocale();
  if (!ag)
    return (
      <div className="split s-64">
        <Plate title={t("charts.capsuleVersion")}>
          <Skeleton rows={6} />
        </Plate>
        <Plate title={t("charts.reasons")}>
          <Skeleton rows={6} />
        </Plate>
      </div>
    );
  const caps = CAPSULES.filter((c) => ag.byCapsuleVersion[c.id]);
  const vers = [...new Set(Object.values(ag.byCapsuleVersion).flatMap((o) => Object.keys(o)))].sort();
  const allPr = caps.flatMap((c) => Object.values(ag.byCapsuleVersion[c.id]).map((x) => x.passRate ?? 0));
  const minPr = allPr.length ? Math.min(...allPr) : 1;
  const yMin = minPr >= 0.55 ? 0.5 : Math.max(0, Math.floor((minPr - 0.05) * 10) / 10);
  const capNote = f.result === "FAIL" ? t("charts.noteFail") : f.result === "PASS" ? t("charts.notePass") : !caps.length ? t("charts.noRows") : "";
  const reasons = Object.entries(ag.byFailureReason).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [FailureReason, number][];
  const ls = LANG_CODES.filter((c) => ag.byLanguage[c]);
  const rowsLabel = (n: number) => tc("count.rows", { count: n });
  return (
    <>
      <div className="split s-55">
        <Plate title={t("charts.byPipeline")} refText={`${rangeLabel} · ${t("charts.clickFilter")}`}>
          <RateBars
            stats={ag.byPipeline ?? {}}
            active={f.pipeline_id}
            ariaLabel={t("charts.byPipeline")}
            seriesName={t("kpi.passRate")}
            rowsLabel={rowsLabel}
            onPick={(k) => onPick({ pipeline_id: f.pipeline_id === k ? null : k })}
          />
        </Plate>
        <Plate title={t("charts.byModel")} refText={`${rangeLabel} · ${t("charts.clickFilter")}`}>
          <RateBars
            stats={ag.byModelVersion ?? {}}
            active={f.model_version}
            ariaLabel={t("charts.byModel")}
            seriesName={t("kpi.passRate")}
            rowsLabel={rowsLabel}
            onPick={(k) => onPick({ model_version: f.model_version === k ? null : k })}
          />
        </Plate>
      </div>
      <div className="split s-64">
        <Plate title={t("charts.capsuleVersion")} refText={t("charts.capsuleVersionRef")}>
          <EChart
            className="chart tall"
            ariaLabel={t("charts.capsuleVersion")}
            onEvents={{
              click: (p) => {
                const c = caps[(p as { dataIndex: number }).dataIndex];
                if (c) onPick({ capsule: f.capsule === c.id ? null : c.id });
              },
            }}
            option={(tk) => ({
              ...baseOpt(tk, reduced, { grid: { left: 44, right: 10, top: capNote ? 52 : 34, bottom: 70 } }),
              legend: { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: tk.muted, fontSize: 11, fontFamily: tk.mono } },
              graphic: [{ type: "text", left: 48, top: 22, style: { text: capNote, fill: tk.muted, font: `500 11.5px ${tk.font}`, width: 560, overflow: "break" } }],
              xAxis: axisX(
                tk,
                caps.map((c) => capsuleLabel(c.id, locale)),
                { boundaryGap: true, axisLabel: { color: tk.text, fontSize: 11, rotate: 30, interval: 0, fontFamily: tk.font } },
              ),
              yAxis: axisY(tk, { min: yMin, max: 1, axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: pctFmt } }),
              tooltip: tooltip(tk, { valueFormatter: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%") }),
              series: vers.map((v) => ({
                name: v,
                type: "bar",
                barGap: "10%",
                barMaxWidth: 14,
                itemStyle: { color: verColor(tk, v) },
                data: caps.map((c) => {
                  const x = ag.byCapsuleVersion[c.id][v];
                  return x && x.passRate != null ? +x.passRate.toFixed(4) : null;
                }),
                markPoint:
                  v === "v1.2-rc" && caps.some((c) => c.id === "device_control") && !f.result
                    ? {
                        symbol: "pin",
                        symbolSize: 36,
                        itemStyle: { color: tk.tone.failed },
                        label: { color: "#fff", fontSize: 9.5, formatter: t("charts.regression"), fontFamily: tk.font },
                        data: [{ coord: [caps.findIndex((c) => c.id === "device_control"), ag.byCapsuleVersion.device_control?.[v]?.passRate ?? 0] }],
                      }
                    : undefined,
              })) as EChartsOption["series"],
            })}
          />
        </Plate>
        <Plate title={t("charts.reasons")} refText={t("charts.reasonsRef")}>
          {reasons.length ? (
            <EChart
              className="chart tall"
              ariaLabel={t("charts.reasons")}
              onEvents={{
                click: (p) => {
                  const k = reasons[(p as { dataIndex: number }).dataIndex]?.[0];
                  if (k) onPick({ reason: f.reason === k ? null : k });
                },
              }}
              option={(tk) => ({
                ...baseOpt(tk, reduced, { grid: { left: 8, containLabel: true, right: 40, top: 8, bottom: 22 } }),
                legend: { show: false },
                tooltip: tooltip(tk, { trigger: "item" }),
                xAxis: axisY(tk, { minInterval: 1 }),
                yAxis: catY(tk, reasons.map(([k]) => failureReasonLabel(k, locale))),
                series: [
                  {
                    name: t("charts.failRows"),
                    type: "bar",
                    barWidth: 11,
                    data: reasons.map(([k, v]) => ({ value: v, itemStyle: { color: tk.tone[FAILURE_REASON_META[k]?.tone ?? "failed"], opacity: f.reason && f.reason !== k ? 0.35 : 1 } })),
                    label: barLabel(tk),
                  },
                ],
              })}
            />
          ) : (
            <div className="ad-empty-chart">{t("charts.noFails")}</div>
          )}
        </Plate>
      </div>
      <div className="split s-55">
        <Plate title={t("charts.byLanguage")} refText={t("charts.byLanguageRef")}>
          <EChart
            className="chart"
            ariaLabel={t("charts.byLanguage")}
            onEvents={{
              click: (p) => {
                const c = ls[(p as { dataIndex: number }).dataIndex];
                if (c) onPick({ language: f.language.length === 1 && f.language[0] === c ? [] : [c] });
              },
            }}
            option={(tk) => ({
              ...baseOpt(tk, reduced),
              xAxis: axisX(tk, ls.map((c) => c.toUpperCase()), { boundaryGap: true }),
              yAxis: axisY(tk),
              series: [
                { name: "PASS", type: "bar", stack: "r", barWidth: 28, itemStyle: { color: tk.tone.success }, data: ls.map((c) => ag.byLanguage[c].pass) },
                { name: "FAIL", type: "bar", stack: "r", barWidth: 28, itemStyle: { color: tk.tone.failed }, data: ls.map((c) => ag.byLanguage[c].fail) },
              ],
            })}
          />
        </Plate>
        <Plate title={t("charts.judge")} refText={t("charts.judgeRef")}>
          <EChart
            className="chart"
            ariaLabel={t("charts.judge")}
            option={(tk) => ({
              ...baseOpt(tk, reduced),
              legend: { show: false },
              xAxis: axisX(
                tk,
                ag.judgeScoreHistogram.map((_, i) => (i / 10).toFixed(1)),
                { boundaryGap: true, name: "judge score", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: tk.muted, fontSize: 10 } },
              ),
              yAxis: axisY(tk),
              series: [
                {
                  name: t("charts.rows"),
                  type: "bar",
                  barWidth: "78%",
                  data: ag.judgeScoreHistogram.map((v, i) => ({ value: v, itemStyle: { color: i >= 7 ? tk.tone.success : tk.tone.failed } })),
                  markLine: { symbol: "none", lineStyle: { color: tk.read("--mark"), type: "dashed" }, label: { color: tk.text, formatter: "PASS 0.7", fontSize: 10, fontFamily: tk.mono }, data: [{ xAxis: "0.7" }] },
                },
              ],
            })}
          />
        </Plate>
      </div>
    </>
  );
}
