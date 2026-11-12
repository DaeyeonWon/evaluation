"use client";
/** S-07 · Long-range analytics (BigQuery-style aggregates from /api/v1/analytics/*). */

import { EChart, LangBadge, fmt } from "@/components/shared";
import { CAPSULES, LANG_CODES } from "@/lib/catalog";
import { api, useApi } from "@/lib/client";
import type { ChartTokens } from "@/components/shared";
import { axisX, axisY, barLabel, baseOpt, catY, opt, tooltip, verColor } from "./chart";
import { Plate, Sheet, SheetHead, Skeleton, useReducedMotionSafe } from "./ui";

const COST_KEYS = ["vertex", "llmJudge", "workflows", "cloudRun", "firestore", "bigquery", "storage"] as const;
const COST_LAB: Record<(typeof COST_KEYS)[number], string> = { vertex: "Vertex AI", llmJudge: "LLM Judge", workflows: "Workflows", cloudRun: "Cloud Run", firestore: "Firestore", bigquery: "BigQuery", storage: "Storage" };

export function AnalyticsScreen() {
  const reduced = useReducedMotionSafe();
  const sum = useApi(["analytics-summary"], () => api.analyticsSummary(), { revalidateOn: ["transition"], throttleMs: 20000 });
  const errs = useApi(["analytics-errors"], () => api.errors({ top: 40 }), { revalidateOn: ["transition"], throttleMs: 20000 });
  const cost = useApi(["analytics-cost"], () => api.cost(), { revalidateOnFocus: false });
  const s = sum.data;
  const h = s?.hourly;
  const d = s?.daily ?? [];
  const hx = (h?.ts ?? []).map((t) => fmt.date(t).slice(5) + " " + fmt.hm(t));
  const incident = (t: ChartTokens) => ({
    silent: true,
    itemStyle: { color: t.tone.failed, opacity: 0.07 },
    label: { color: t.tone.failed, fontSize: 10, formatter: "GPU quota 장애", position: "top", distance: 4, fontFamily: t.font },
    data: [[{ xAxis: "11-10 03:00" }, { xAxis: "11-10 06:00" }]],
  });
  const hAxis = (t: ChartTokens) => axisX(t, hx, { axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono, interval: 23, formatter: (v: string) => v.split(" ")[0] } });
  const dx = d.map((x) => x.date.slice(5) + (x.partial ? "*" : ""));
  const top = (errs.data?.topErrorCodes ?? []).slice(0, 10);
  const vc = s?.versionComparison ?? [];
  const ls = s?.languageSummary ?? [];
  const comp = s?.componentDurations ?? [];

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-07 · ANALYTICS"
        title="장기 운영 분석"
        desc="BigQuery 집계 기준 7일. 11/10 03–06시는 GPU quota 장애(INC-20261110-01) 구간입니다. 차트는 드래그·휠로 기간을 이동할 수 있습니다."
        acts={<span className="chip">bixby-eval-prod.bixby_eval.pipeline_events</span>}
      />
      {!s ? <Skeleton rows={10} /> : null}
      <div className="split s-55">
        <Plate title="언어별 처리량 추이" refText="일별 Pipeline 수 · * 집계 중">
          <EChart className="chart" ariaLabel="언어별 일별 처리량" loading={!s} option={(t) => ({ ...baseOpt(t, reduced), xAxis: axisX(t, dx, { boundaryGap: true }), yAxis: axisY(t), series: LANG_CODES.map((c) => ({ name: c.toUpperCase(), type: "bar", stack: "d", barWidth: 22, itemStyle: { color: t.lang[c] }, data: d.map((x) => x.pipelines[c]) })) })} />
        </Plate>
        <Plate title="성공률 및 Retry 비율" refText="시간당 · 168h">
          <EChart
            className="chart"
            ariaLabel="성공률과 Retry 비율"
            loading={!s}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 46, right: 14, top: 44, bottom: 28 } }),
                xAxis: hAxis(t),
                yAxis: axisY(t, { max: 1, axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono, formatter: (v: number) => Math.round(v * 100) + "%" } }),
                tooltip: tooltip(t, { valueFormatter: (v: number) => (v * 100).toFixed(1) + "%" }),
                dataZoom: [{ type: "inside" }],
                series: [
                  { name: "성공률", type: "line", showSymbol: false, lineStyle: { width: 1.4, color: t.tone.success }, itemStyle: { color: t.tone.success }, data: h?.successRate ?? [], markArea: incident(t) },
                  { name: "Retry 비율", type: "line", showSymbol: false, lineStyle: { width: 1.4, color: t.tone.retry }, itemStyle: { color: t.tone.retry }, areaStyle: { color: t.tone.retry, opacity: 0.08 }, data: h?.retryRate ?? [] },
                ],
              })
            }
          />
        </Plate>
      </div>
      <div className="split s-55">
        <Plate title="평균 / p95 Pipeline Duration" refText="시간당 · 초">
          <EChart
            className="chart"
            ariaLabel="평균과 p95 실행 시간"
            loading={!s}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 46, right: 14, top: 44, bottom: 28 } }),
                xAxis: hAxis(t),
                yAxis: axisY(t, { name: "초" }),
                dataZoom: [{ type: "inside" }],
                series: [
                  { name: "평균", type: "line", showSymbol: false, lineStyle: { width: 1.4, color: t.read("--sx-metric") }, itemStyle: { color: t.read("--sx-metric") }, data: h?.avgDurationSec ?? [], markArea: incident(t) },
                  { name: "p95", type: "line", showSymbol: false, lineStyle: { width: 1.2, color: t.muted, type: "dashed" }, itemStyle: { color: t.muted }, data: h?.p95DurationSec ?? [] },
                ],
              })
            }
          />
        </Plate>
        <Plate title="컴포넌트별 실행 시간" refText="avg · p95 (초) · DAG 6단계">
          <EChart
            className="chart"
            ariaLabel="컴포넌트별 실행 시간"
            loading={!s}
            option={(t) => ({
              ...baseOpt(t, reduced, { grid: { left: 124, right: 22, top: 30, bottom: 22 } }),
              xAxis: axisY(t, { name: "초" }),
              yAxis: catY(t, comp.map((x) => x.labelKo)),
              series: [
                { name: "평균", type: "bar", barWidth: 8, itemStyle: { color: t.read("--sx-metric") }, data: comp.map((x) => x.avgSec) },
                { name: "p95", type: "bar", barWidth: 8, itemStyle: { color: t.muted }, data: comp.map((x) => x.p95Sec) },
              ],
            })}
          />
        </Plate>
      </div>
      <div className="split s-55">
        <Plate title="오류 원인 Top N" refText="error_code · Attempt 기준">
          <EChart
            className="chart"
            ariaLabel="오류 코드 Top N"
            loading={!errs.data}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 200, right: 34, top: 8, bottom: 22 } }),
                legend: { show: false },
                tooltip: tooltip(t, { trigger: "item" }),
                xAxis: axisY(t, { minInterval: 1 }),
                yAxis: catY(t, top.map((x) => x.code), { axisLabel: { color: t.text, fontSize: 10.5, fontFamily: t.mono } }),
                series: [{ type: "bar", barWidth: 10, itemStyle: { color: t.tone.failed }, data: top.map((x) => x.count), label: barLabel(t) }],
              })
            }
          />
        </Plate>
        <Plate title="비용 추이" refText={cost.data ? `USD/일 · 7일 합계 ${fmt.usd(cost.data.total7d)} · * 집계 중` : "USD/일"}>
          <EChart
            className="chart"
            ariaLabel="비용 추이"
            loading={!cost.data}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 52, right: 14, top: 52, bottom: 28 } }),
                legend: { top: 0, left: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: t.muted, fontSize: 10.5, fontFamily: t.font } },
                xAxis: axisX(t, (cost.data?.daily ?? []).map((x) => x.date.slice(5) + (x.partial ? "*" : "")), { boundaryGap: true }),
                yAxis: axisY(t, { axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono, formatter: (v: number) => "$" + v } }),
                tooltip: tooltip(t, { valueFormatter: (v: number) => fmt.usd(v) }),
                series: COST_KEYS.map((k, i) => ({ name: COST_LAB[k], type: "bar", stack: "c", barWidth: 22, itemStyle: { color: t.read(`--cost-${i + 1}`) }, data: (cost.data?.daily ?? []).map((x) => x.costUsd[k]) })),
              })
            }
          />
        </Plate>
      </div>
      <Plate flush title="Pipeline Version별 성능 비교" refText="v1.2-rc는 전체 지표 개선, 기기제어 캡슐 회귀">
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>버전</th>
                <th>상태 · 트래픽</th>
                <th>모델 / Judge</th>
                <th className="r">실행</th>
                <th className="r">Pipeline 성공률</th>
                <th className="r">Retry</th>
                <th className="r">avg / p95</th>
                <th className="r">실발화 pass</th>
                <th className="r">기기제어 pass</th>
                <th className="r">지연 p95</th>
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
                    <td className="mono r">{v.runs}</td>
                    <td className="mono r">{fmt.pct(v.pipelineSuccessRate, 1)}</td>
                    <td className="mono r">{fmt.pct(v.retryRate, 1)}</td>
                    <td className="mono r">
                      {v.avgDurationSec}s / {v.p95DurationSec}s
                    </td>
                    <td className="mono r">{fmt.pct(v.utterancePassRate, 1)}</td>
                    <td className="mono r" style={dc && (dc.passRate ?? 1) < 0.75 ? { color: "var(--st-failed)", fontWeight: 700 } : undefined}>
                      {dc ? fmt.pct(dc.passRate, 1) : "—"}
                    </td>
                    <td className="mono r">{fmt.number(v.p95LatencyMs)}ms</td>
                    <td className="mono r">{(v.avgJudgeScore || 0).toFixed(3)}</td>
                    <td className="mono r">{fmt.usd(v.costPerRunUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="body">
          <EChart
            className="chart"
            ariaLabel="캡슐별 버전 Pass rate 비교"
            loading={!s}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 46, right: 10, top: 30, bottom: 54 } }),
                xAxis: axisX(t, CAPSULES.map((c) => c.label), { boundaryGap: true, axisLabel: { color: t.text, fontSize: 10.5, rotate: 20, interval: 0, fontFamily: t.font } }),
                yAxis: axisY(t, { min: 0.5, max: 1, axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono, formatter: (v: number) => Math.round(v * 100) + "%" } }),
                tooltip: tooltip(t, { valueFormatter: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%") }),
                series: vc.map((v) => ({ name: v.version, type: "bar", barMaxWidth: 12, itemStyle: { color: verColor(t, v.version) }, data: CAPSULES.map((c) => (v.byCapsule[c.id]?.passRate != null ? +v.byCapsule[c.id].passRate!.toFixed(4) : null)) })),
              })
            }
          />
        </div>
      </Plate>
      <Plate flush title="언어 요약" refText="Workflow registry + 오늘 결과 CSV">
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>언어</th>
                <th className="r">Workflow</th>
                <th className="r">성공률</th>
                <th className="r">DLQ</th>
                <th className="r">avg / p95</th>
                <th className="r">오늘 실발화</th>
                <th className="r">오늘 pass</th>
                <th className="r">7일 처리량</th>
              </tr>
            </thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.code}>
                  <td>
                    <LangBadge lang={l.code} /> {l.name}
                  </td>
                  <td className="mono r">{l.workflows}</td>
                  <td className="mono r">{fmt.pct(l.successRate, 1)}</td>
                  <td className="mono r">{l.deadLettered}</td>
                  <td className="mono r">
                    {l.avgDurationSec}s / {l.p95DurationSec}s
                  </td>
                  <td className="mono r">{fmt.number(l.utterancesToday)}</td>
                  <td className="mono r">{fmt.pct(l.passRateToday, 1)}</td>
                  <td className="mono r">{fmt.number(Array.isArray(l.throughput7d) ? (l.throughput7d as number[]).reduce((a, b) => a + b, 0) : l.throughput7d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Plate>
    </Sheet>
  );
}
