"use client";
/**
 * S7 — Analytics (BigQuery-style aggregates). Per-language throughput trend, success/retry rate,
 * avg/p95 duration, per-component duration, top-N error codes, cost trend, version comparison.
 * Source: GET /analytics/summary + /analytics/errors + /analytics/cost.
 */
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { Activity, AlertTriangle, Clock, Cpu, Database, GitBranch, RotateCcw, Target, TrendingDown } from "lucide-react";
import { CAPSULES, FAILURE_CATEGORY_META, LANG_CODES } from "@/lib/catalog";
import { api, useApi } from "@/lib/client";
import { fmt } from "@/lib/format";
import { EChart, type ChartTokens } from "@/components/shared";
import { ErrorBox, LangTag, Pill, axX, axY, chartBase, dur, eo, langName, pct } from "./core";

const INC: [number, number] = [new Date("2026-11-10T03:00:00+09:00").getTime(), new Date("2026-11-10T06:00:00+09:00").getTime()];
const COST_KEYS = ["vertex", "llmJudge", "workflows", "cloudRun", "firestore", "bigquery", "storage"] as const;
const COST_LBL: Record<string, string> = { vertex: "Vertex AI", llmJudge: "LLM Judge", workflows: "Workflows", cloudRun: "Cloud Run", firestore: "Firestore", bigquery: "BigQuery", storage: "Storage" };

export function AnalyticsScreen() {
  const reduced = !!useReducedMotion();
  const sum = useApi(["lanes-an-summary"], () => api.analyticsSummary(), { revalidateOn: ["transition"], throttleMs: 15000 });
  const errs = useApi(["lanes-errors-7d"], () => api.errors({ range: "7d" }), { revalidateOn: ["transition"], throttleMs: 15000 });
  const cost = useApi(["lanes-cost"], () => api.cost(), { revalidateOn: ["transition"], throttleMs: 30000 });
  const s = sum.data;
  const mark = (t: ChartTokens, pos = "insideTop") => ({
    silent: true,
    itemStyle: { color: t.tone.failed + "1f" },
    label: { show: true, position: pos, distance: 3, color: t.muted, fontSize: 9, formatter: "GPU quota 장애" },
    data: [[{ xAxis: INC[0] }, { xAxis: INC[1] }]],
  });
  const timeX = (t: ChartTokens) => axX(t, "time", { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => fmt.date(v).slice(5), hideOverlap: true } });
  if (sum.error && !s) return <ErrorBox error={sum.error} retry={() => sum.mutate()} />;
  const h = s?.hourly;
  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Screen 7 · BigQuery analytics</div>
          <h1>Analytics</h1>
          <p>7일 운영 성능과 품질. 11월 10일 03–06시 Vertex AI GPU 할당량 장애(INC-20261110-01) 구간이 음영으로 표시됩니다.</p>
        </div>
        {cost.data && (
          <div className="strip" style={{ borderTop: 0 }}>
            <div className="m">
              <span>7일 비용</span>
              <b>{fmt.usd(cost.data.total7d, 0)}</b>
            </div>
            <div className="m">
              <span>Vertex AI 비중</span>
              <b>{pct(cost.data.byComponent7d.vertex / cost.data.total7d, 0)}</b>
            </div>
          </div>
        )}
      </div>
      <div className="panel flush" style={{ marginBottom: 14 }}>
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>언어</th>
                <th className="r">Workflows</th>
                <th className="r">성공률</th>
                <th className="r">DLQ</th>
                <th className="r">평균 / p95 Duration</th>
                <th className="r">오늘 발화</th>
                <th className="r">오늘 PASS율</th>
                <th className="r">7일 처리</th>
              </tr>
            </thead>
            <tbody>
              {s
                ? s.languageSummary.map((l) => (
                    <tr key={l.code}>
                      <td>
                        <LangTag code={l.code} />
                      </td>
                      <td className="r mono">{l.workflows}</td>
                      <td className="r mono">{pct(l.successRate)}</td>
                      <td className="r mono" style={{ color: "var(--st-dlq)" }}>
                        {l.deadLettered}
                      </td>
                      <td className="r mono">
                        {dur(l.avgDurationSec * 1000)} / {dur(l.p95DurationSec * 1000)}
                      </td>
                      <td className="r mono">{fmt.number(l.utterancesToday)}</td>
                      <td className="r mono">{pct(l.passRateToday)}</td>
                      <td className="r mono">{fmt.number(l.throughput7d)}</td>
                    </tr>
                  ))
                : Array.from({ length: 4 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={8}>
                        <div className="skel" />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid g2">
        <Panel icon={<Activity className="i" />} title="언어별 처리량 추이" sub="7일 · 6시간 합계 pipelines" fill>
          {h ? (
            <EChart
              className="chart"
              ariaLabel="언어별 처리량 추이"
              option={(t) => {
                const b: number[] = [];
                for (let i = 0; i < h.ts.length; i += 6) b.push(i);
                return eo({
                  ...chartBase(t, reduced),
                  xAxis: timeX(t),
                  yAxis: axY(t),
                  series: LANG_CODES.map((l, li) => ({
                    type: "line",
                    name: langName(l),
                    showSymbol: false,
                    smooth: 0.3,
                    lineStyle: { width: 1.6 },
                    itemStyle: { color: t.lang[l] },
                    data: b.map((i) => [h.ts[i], h.throughput[l].slice(i, i + 6).reduce((a, x) => a + x, 0)]),
                    markArea: li === 0 ? mark(t) : undefined,
                  })),
                });
              }}
            />
          ) : (
            <div className="skel chart" />
          )}
        </Panel>
        <Panel icon={<Target className="i" />} title="성공률" sub="시간별">
          {h ? (
            <>
              <EChart
                className="chart sm"
                ariaLabel="시간별 성공률"
                option={(t) =>
                  eo({
                    ...chartBase(t, reduced),
                    legend: { show: false },
                    grid: { left: 40, right: 10, top: 20, bottom: 22 },
                    xAxis: timeX(t),
                    yAxis: axY(t, { min: 0.6, max: 1, axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => Math.round(v * 100) + "%" } }),
                    tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => pct(v as number) },
                    series: [{ type: "line", name: "성공률", showSymbol: false, lineStyle: { width: 1.4, color: t.tone.success }, itemStyle: { color: t.tone.success }, data: h.ts.map((x, i) => [x, h.successRate[i]]), markArea: mark(t, "top") }],
                  })
                }
              />
              <div className="panel-h" style={{ marginTop: 6 }}>
                <h2 className="sec">
                  <RotateCcw className="i" />
                  Retry 비율
                </h2>
              </div>
              <EChart
                className="chart sm"
                ariaLabel="시간별 Retry 비율"
                option={(t) =>
                  eo({
                    ...chartBase(t, reduced),
                    legend: { show: false },
                    grid: { left: 40, right: 10, top: 20, bottom: 22 },
                    xAxis: timeX(t),
                    yAxis: axY(t, { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => Math.round(v * 100) + "%" } }),
                    tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => pct(v as number) },
                    series: [
                      {
                        type: "line",
                        name: "Retry 비율",
                        showSymbol: false,
                        lineStyle: { width: 1.4, color: t.tone.retry },
                        itemStyle: { color: t.tone.retry },
                        areaStyle: { color: t.tone.retry + "22" },
                        data: h.ts.map((x, i) => [x, h.retryRate[i]]),
                        markArea: mark(t, "top"),
                      },
                    ],
                  })
                }
              />
            </>
          ) : (
            <div className="skel chart" />
          )}
        </Panel>
        <Panel icon={<Clock className="i" />} title="평균 / p95 Pipeline Duration">
          {h ? (
            <EChart
              className="chart"
              ariaLabel="Pipeline Duration"
              option={(t) =>
                eo({
                  ...chartBase(t, reduced),
                  xAxis: timeX(t),
                  yAxis: axY(t, { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => Math.round(v / 60) + "m" } }),
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => dur((v as number) * 1000) },
                  series: [
                    { type: "line", name: "평균", showSymbol: false, lineStyle: { width: 1.6, color: t.read("--ink") }, itemStyle: { color: t.read("--ink") }, data: h.ts.map((x, i) => [x, h.avgDurationSec[i]]) },
                    { type: "line", name: "p95", showSymbol: false, lineStyle: { width: 1.2, color: t.muted, type: "dashed" }, itemStyle: { color: t.muted }, data: h.ts.map((x, i) => [x, h.p95DurationSec[i]]) },
                  ],
                })
              }
            />
          ) : (
            <div className="skel chart" />
          )}
        </Panel>
        <Panel icon={<Cpu className="i" />} title="컴포넌트별 실행 시간" sub="avg · p95 (초)">
          {s ? (
            <EChart
              className="chart"
              ariaLabel="컴포넌트별 실행 시간"
              option={(t) =>
                eo({
                  ...chartBase(t, reduced),
                  grid: { left: 96, right: 20, top: 30, bottom: 22 },
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => dur((v as number) * 1000) },
                  xAxis: axY(t),
                  yAxis: axX(t, "category", { data: s.componentDurations.map((x) => x.labelKo), inverse: true, axisLabel: { color: t.text, fontSize: 11 } }),
                  series: [
                    { type: "bar", name: "평균", barWidth: 8, itemStyle: { color: t.tone.running, borderRadius: [0, 2, 2, 0] }, data: s.componentDurations.map((x) => x.avgSec) },
                    { type: "bar", name: "p95", barWidth: 8, itemStyle: { color: t.tone.running + "66", borderRadius: [0, 2, 2, 0] }, data: s.componentDurations.map((x) => x.p95Sec) },
                  ],
                })
              }
            />
          ) : (
            <div className="skel chart" />
          )}
        </Panel>
        <Panel icon={<AlertTriangle className="i" />} title="오류 원인 Top N" sub="7일 · error code">
          {errs.data ? (
            <EChart
              className="chart"
              ariaLabel="오류 코드 Top N"
              option={(t) => {
                const top = errs.data!.topErrorCodes.slice(0, 8);
                return eo({
                  ...chartBase(t, reduced),
                  legend: { show: false },
                  grid: { left: 170, right: 30, top: 8, bottom: 20 },
                  tooltip: {
                    ...(chartBase(t, reduced).tooltip as object),
                    trigger: "item",
                    formatter: (p: unknown) => {
                      const x = p as { name: string; value: number; dataIndex: number };
                      return `${x.name}<br>${FAILURE_CATEGORY_META[top[x.dataIndex].category]?.label} · ${x.value}건`;
                    },
                  },
                  xAxis: axY(t),
                  yAxis: axX(t, "category", { data: top.map((x) => x.code), inverse: true, axisLabel: { color: t.text, fontSize: 10, fontFamily: t.mono } }),
                  series: [
                    {
                      type: "bar",
                      barWidth: 10,
                      data: top.map((x) => ({ value: x.count, itemStyle: { color: FAILURE_CATEGORY_META[x.category]?.retryable ? t.tone.retry : t.tone.failed, borderRadius: [0, 2, 2, 0] } })),
                      label: { show: true, position: "right", color: t.text, fontSize: 10, fontFamily: t.mono },
                    },
                  ],
                });
              }}
            />
          ) : (
            <div className="skel chart" />
          )}
        </Panel>
        <Panel icon={<Database className="i" />} title="비용 추이" sub="일별 USD · 마지막 날 부분 집계(*)">
          {cost.data ? (
            <EChart
              className="chart"
              ariaLabel="일별 비용"
              option={(t) =>
                eo({
                  ...chartBase(t, reduced),
                  grid: { left: 44, right: 10, top: 44, bottom: 24 },
                  legend: { ...(chartBase(t, reduced).legend as object), type: "scroll" },
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => fmt.usd(v as number) },
                  xAxis: axX(t, "category", { data: cost.data!.daily.map((d) => d.date.slice(5) + (d.partial ? "*" : "")) }),
                  yAxis: axY(t, { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => "$" + v } }),
                  series: COST_KEYS.map((k, i) => ({ type: "bar", name: COST_LBL[k], stack: "c", barWidth: "55%", itemStyle: { color: t.read(`--c-${i + 1}`) }, data: cost.data!.daily.map((d) => d.costUsd[k]) })),
                })
              }
            />
          ) : (
            <div className="skel chart" />
          )}
        </Panel>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-h">
          <h2 className="sec">
            <GitBranch className="i" />
            Pipeline Version별 성능 비교
          </h2>
        </div>
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Version</th>
                <th>상태</th>
                <th className="r">Traffic</th>
                <th>Model under test</th>
                <th>Judge</th>
                <th className="r">Runs</th>
                <th className="r">Pipeline 성공률</th>
                <th className="r">Retry</th>
                <th className="r">평균 / p95</th>
                <th className="r">발화 PASS율</th>
                <th className="r">Judge 평균</th>
                <th className="r">Latency p95</th>
                <th className="r">$/run</th>
                <th className="r">기기제어</th>
              </tr>
            </thead>
            <tbody>
              {(s?.versionComparison ?? []).map((v) => {
                const dc = v.byCapsule?.device_control;
                return (
                  <tr key={v.version}>
                    <td className="mono">
                      <b>{v.version}</b>
                    </td>
                    <td>
                      <Pill tone={v.status === "CANARY" ? "retry" : v.status === "STABLE" ? "success" : "cancelled"}>{v.status}</Pill>
                    </td>
                    <td className="r mono">{v.trafficPct}%</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {v.modelUnderTest}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {v.judgeModel}
                    </td>
                    <td className="r mono">{v.runs}</td>
                    <td className="r mono">{pct(v.pipelineSuccessRate)}</td>
                    <td className="r mono">{pct(v.retryRate)}</td>
                    <td className="r mono">
                      {dur(v.avgDurationSec * 1000)} / {dur(v.p95DurationSec * 1000)}
                    </td>
                    <td className="r mono">
                      <b>{pct(v.utterancePassRate)}</b>
                    </td>
                    <td className="r mono">{(v.avgJudgeScore || 0).toFixed(3)}</td>
                    <td className="r mono">{fmt.number(v.p95LatencyMs)}ms</td>
                    <td className="r mono">{fmt.usd(v.costPerRunUsd)}</td>
                    <td className="r mono" style={v.version === "v1.2-rc" ? { color: "var(--st-failed)", fontWeight: 700 } : undefined}>
                      {dc ? pct(dc.passRate) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid g-12-8" style={{ marginTop: 10 }}>
          {s ? (
            <EChart
              className="chart"
              ariaLabel="버전별 Capsule PASS율"
              option={(t) => {
                const vs = s.versionComparison.filter((v) => v.byCapsule && Object.keys(v.byCapsule).length);
                const VC: Record<string, string> = { "v1.0": t.read("--c-6"), "v1.1": t.read("--c-1"), "v1.2-rc": t.read("--c-2") };
                return eo({
                  ...chartBase(t, reduced),
                  grid: { left: 16, right: 10, top: 30, bottom: 8, containLabel: true },
                  xAxis: axX(t, "category", { data: CAPSULES.map((x) => x.label), axisLabel: { color: t.text, fontSize: 10, rotate: 30, interval: 0 } }),
                  yAxis: axY(t, { min: 0.5, max: 1, axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => Math.round(v * 100) + "%" } }),
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => (v == null ? "—" : pct(v as number)) },
                  series: vs.map((v, i) => ({
                    type: "bar",
                    name: v.version,
                    barWidth: 7,
                    itemStyle: { color: VC[v.version] ?? t.read(`--c-${i + 3}`), borderRadius: [2, 2, 0, 0] },
                    data: CAPSULES.map((x) => v.byCapsule[x.id]?.passRate ?? null),
                  })),
                });
              }}
            />
          ) : (
            <div className="skel chart" />
          )}
          <div className="note t-retry" style={{ alignSelf: "start" }}>
            <TrendingDown className="i sm" /> <b>v1.2-rc</b>는 전체 PASS율·속도에서 우위지만 <b>기기제어(SmartThings)</b> Capsule에서 회귀가 있습니다. 승격 전 slot 파서 수정 또는 해당 Capsule 제외 Canary를 권장합니다.
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Link className="btn sm" href="/lanes/results?capsule=device_control">
                <Target />
                평가 결과에서 확인
              </Link>
              <Link className="btn sm" href="/lanes/config#versions">
                버전 설정
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Panel({ icon, title, sub, fill, children }: { icon: React.ReactNode; title: string; sub?: string; fill?: boolean; children: React.ReactNode }) {
  return (
    <div className={fill ? "panel fill" : "panel"}>
      <div className="panel-h">
        <h2 className="sec">
          {icon}
          {title} {sub && <span className="eyebrow">{sub}</span>}
        </h2>
      </div>
      {children}
    </div>
  );
}
