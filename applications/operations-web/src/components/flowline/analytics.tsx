"use client";
/**
 * S7 Analytics — per-language throughput, success & retry rate, avg/p95 duration, per-component
 * duration, top-N errors, cost trend, version comparison (with the device_control regression call-out),
 * language summary. All from /api/v1/analytics/*.
 */
import { CheckCircle, GitBranch, Table2, Archive } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { CAPSULE_BY_ID, LANG_CODES } from "@/lib/catalog";
import { api, useApi } from "@/lib/client";
import { fmt } from "@/lib/format";
import { accent, axX, axY, baseOpt, itemTooltip } from "./chart";
import { ErrorBox, Lang, Panel, Skel, dur } from "./ui";

const VER_META: Record<string, [string, ReactNode]> = {
  STABLE: ["success", <CheckCircle key="i" aria-hidden />],
  CANARY: ["retry", <GitBranch key="i" aria-hidden />],
  DEPRECATED: ["cancelled", <Archive key="i" aria-hidden />],
};
export function VerPill({ status }: { status: string }) {
  const m = VER_META[status] ?? ["queued", null];
  return (
    <span className={`pill sm t-${m[0]}`}>
      {m[1]}
      {status}
    </span>
  );
}

const COST_KEYS = ["vertex", "llmJudge", "workflows", "cloudRun", "firestore", "bigquery", "storage"] as const;
const COST_LABEL: Record<(typeof COST_KEYS)[number], string> = { vertex: "Vertex AI", llmJudge: "LLM Judge", workflows: "Workflows", cloudRun: "Cloud Run", firestore: "Firestore", bigquery: "BigQuery", storage: "Storage" };

export function Analytics() {
  const sum = useApi(["analytics-summary"], () => api.analyticsSummary(), { revalidateOn: ["tick"], throttleMs: 30000 });
  const quality = useApi(["analytics-quality", "7d"], () => api.quality({ range: "7d" }), { revalidateOn: ["tick"], throttleMs: 30000 });
  const errors = useApi(["errors", "top8"], () => api.errors({ range: "7d", top: 8 }), { revalidateOn: ["transition"], throttleMs: 10000 });
  const cost = useApi(["analytics-cost"], () => api.cost());
  const ov = useApi(["overview"], () => api.overview(), { revalidateOn: ["tick"], throttleMs: 30000 });
  const s = sum.data;

  const charts = useMemo(() => {
    if (!s) return null;
    const H = s.hourly;
    const lab = H.ts.map((t) => fmt.date(t).slice(5) + " " + fmt.hm(t));
    const zoom = [{ type: "inside" as const, start: 0, end: 100 }];
    const x = (t: ChartTokens) => axX(t, lab, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 10, interval: 23, fontFamily: t.mono, alignMinLabel: "left", alignMaxLabel: "right" } });
    const thr = (t: ChartTokens) =>
      baseOpt(t, {
        dataZoom: zoom,
        xAxis: x(t),
        yAxis: axY(t),
        series: LANG_CODES.map((l) => ({ type: "line" as const, name: l.toUpperCase(), showSymbol: false, lineStyle: { width: 1.3, color: t.lang[l] }, itemStyle: { color: t.lang[l] }, data: H.throughput[l] })),
      });
    const dur = (t: ChartTokens) =>
      baseOpt(t, {
        dataZoom: zoom,
        xAxis: x(t),
        yAxis: axY(t, { axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "{value}m" } }),
        tooltip: { ...(baseOpt(t, {}).tooltip as object), valueFormatter: (v: unknown) => v + "분" },
        series: [
          { type: "line", name: "평균", showSymbol: false, lineStyle: { width: 1.4, color: accent(t) }, itemStyle: { color: accent(t) }, data: H.avgDurationSec.map((v) => (v == null ? null : +(v / 60).toFixed(1))) },
          { type: "line", name: "p95", showSymbol: false, lineStyle: { width: 1.2, color: t.tone.queued, type: "dashed" }, itemStyle: { color: t.tone.queued }, data: H.p95DurationSec.map((v) => (v == null ? null : +(v / 60).toFixed(1))) },
        ],
      });
    const cd = s.componentDurations;
    const comp = (t: ChartTokens) =>
      baseOpt(t, {
        tooltip: { ...(baseOpt(t, {}).tooltip as object), axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => v + "s" },
        grid: { left: 6, right: 16, top: 28, bottom: 4, containLabel: true },
        xAxis: axY(t),
        yAxis: axX(t, cd.map((c) => c.labelKo.replace(" (LLM Judge)", "")), { axisLabel: { color: t.text, fontSize: 11, fontFamily: t.font } }),
        series: [
          { type: "bar", name: "평균", barWidth: 8, itemStyle: { color: accent(t) }, data: cd.map((c) => c.avgSec) },
          { type: "bar", name: "p95", barWidth: 8, itemStyle: { color: t.tone.queued }, data: cd.map((c) => c.p95Sec) },
        ],
      });
    const vc = s.versionComparison;
    const v11 = vc.find((v) => v.version === "v1.1");
    const capIds = Object.keys(v11?.byCapsule ?? {});
    const ver = (t: ChartTokens) =>
      baseOpt(t, {
        tooltip: { ...(baseOpt(t, {}).tooltip as object), axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => v + "%" },
        xAxis: axX(t, capIds.map((c) => CAPSULE_BY_ID[c]?.label ?? c), { axisLabel: { color: t.muted, fontSize: 10.5, interval: 0, fontFamily: t.font } }),
        yAxis: axY(t, { min: 50, max: 100, axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "{value}%" } }),
        series: (
          [
            ["v1.1", t.tone.queued],
            ["v1.2-rc", accent(t)],
          ] as const
        ).map(([v, c]) => ({
          type: "bar" as const,
          name: v + " 캡슐별 Pass rate",
          barGap: "8%",
          itemStyle: { color: c },
          data: capIds.map((id) => {
            const r = vc.find((z) => z.version === v)?.byCapsule[id];
            return r ? { value: +((r.passRate ?? 0) * 100).toFixed(1), itemStyle: id === "device_control" && v === "v1.2-rc" ? { color: t.tone.failed } : undefined } : null;
          }),
        })),
      });
    return { thr, dur, comp, ver };
  }, [s]);

  const rateOpt = useMemo(() => {
    const q = quality.data;
    const sr7 = ov.data?.successRate7d;
    if (!q) return null;
    const lab = q.ts.map((t) => fmt.date(t).slice(5) + " " + fmt.hm(t));
    const pct = (v: number | null) => (v == null ? null : +(v * 100).toFixed(1));
    const a = lab.findIndex((x) => x.startsWith("11-10 03"));
    const b = lab.findIndex((x) => x.startsWith("11-10 06"));
    return (t: ChartTokens) =>
      baseOpt(t, {
        dataZoom: [{ type: "inside", start: 0, end: 100 }],
        tooltip: { ...(baseOpt(t, {}).tooltip as object), valueFormatter: (v: unknown) => (v == null ? "-" : v + "%") },
        grid: { left: 8, right: 62, top: 30, bottom: 6, containLabel: true },
        xAxis: axX(t, lab, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 10, interval: 23, fontFamily: t.mono, alignMinLabel: "left", alignMaxLabel: "right" } }),
        yAxis: axY(t, { min: 0, max: 100, axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "{value}%" } }),
        series: [
          {
            type: "line",
            name: "Workflow 성공률",
            showSymbol: false,
            lineStyle: { width: 1.6, color: t.tone.success },
            itemStyle: { color: t.tone.success },
            data: q.successRate.map(pct),
            markLine:
              sr7 != null
                ? { symbol: "none", silent: true, lineStyle: { color: t.muted, type: "dashed", width: 1 }, label: { color: t.text, fontSize: 10, fontFamily: t.mono, formatter: `7일\n${fmt.pct(sr7, 1)}`, position: "end", distance: 6, lineHeight: 13 }, data: [{ yAxis: +(sr7 * 100).toFixed(1) }] }
                : undefined,
            markArea: a >= 0 && b >= 0 ? { itemStyle: { color: t.tone.failed, opacity: 0.08 }, label: { color: t.muted, fontSize: 10 }, data: [[{ name: "GPU quota 장애", xAxis: a }, { xAxis: b }]] } : undefined,
          },
          { type: "line", name: "Retry 발생 비율", showSymbol: false, lineStyle: { width: 1.4, color: t.tone.retry }, itemStyle: { color: t.tone.retry }, data: q.retryRate.map(pct) },
        ],
      });
  }, [quality.data, ov.data?.successRate7d]);

  const errOpt = useMemo(() => {
    const top = [...(errors.data?.topErrorCodes ?? [])].slice(0, 8).reverse();
    if (!errors.data) return null;
    return (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        tooltip: itemTooltip(t),
        grid: { left: 6, right: 30, top: 4, bottom: 4, containLabel: true },
        xAxis: axY(t, { splitNumber: 3 }),
        yAxis: axX(t, top.map((c) => c.code), { axisLabel: { color: t.text, fontSize: 10.5, fontFamily: t.mono } }),
        series: [{ type: "bar", barWidth: 10, label: { show: true, position: "right", color: t.text, fontSize: 10.5, fontFamily: t.mono }, data: top.map((c) => ({ value: c.count, itemStyle: { color: t.tone.failed, borderRadius: 2 } })) }],
      });
  }, [errors.data]);

  const costOpt = useMemo(() => {
    const D = cost.data?.daily;
    if (!D) return null;
    return (t: ChartTokens) => {
      const pal = [accent(t), t.tone.dlq, t.tone.retry, t.tone.success, t.tone.running, t.tone.queued, t.tone.cancelled];
      return baseOpt(t, {
        tooltip: { ...(baseOpt(t, {}).tooltip as object), axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => "$" + v },
        xAxis: axX(t, D.map((d) => d.date.slice(5) + (d.partial ? "*" : ""))),
        yAxis: axY(t, { axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "${value}" } }),
        series: COST_KEYS.map((k, i) => ({ type: "bar" as const, name: COST_LABEL[k], stack: "c", barWidth: "55%", itemStyle: { color: pal[i] }, data: D.map((d) => d.costUsd[k]) })),
      });
    };
  }, [cost.data]);

  if (sum.error && !s) return <div className="screen"><ErrorBox error={sum.error} retry={() => sum.mutate()} /></div>;
  const vc = s?.versionComparison ?? [];
  const v11 = vc.find((v) => v.version === "v1.1");
  const v12 = vc.find((v) => v.version === "v1.2-rc");
  const dc11 = v11?.byCapsule.device_control;
  const dc12 = v12?.byCapsule.device_control;

  return (
    <div className="screen enter">
      <div className="head-row">
        <div>
          <div className="eyebrow">Screen 7 · BigQuery 집계</div>
          <h1 className="h1">Analytics</h1>
          <div className="sub">최근 7일 · BigQuery 운영 이벤트 집계 (mock). 11/10 03–06시 GPU quota 장애 구간 포함.</div>
        </div>
        {cost.data && (
          <div className="sub" style={{ textAlign: "right" }}>
            7일 비용 <b className="mono" style={{ fontSize: 18, color: "var(--text)", letterSpacing: "-0.03em" }}>{fmt.usd(cost.data.total7d)}</b>
          </div>
        )}
      </div>
      <div className="grid g2">
        <Panel title="언어별 처리량 추이" right={<span className="sub">pipeline/h · 168h · 휠로 확대</span>}>
          {charts ? <EChart className="chart" option={charts.thr} ariaLabel="언어별 처리량 추이 7일" /> : <Skel h={230} />}
        </Panel>
        <Panel title="성공률 · Retry 비율" right={<span className="sub">Workflow 기준 · 7일 평균 {fmt.pct(ov.data?.successRate7d, 1)} (관제 KPI와 동일 정의)</span>}>
          {rateOpt ? <EChart className="chart" option={rateOpt} ariaLabel="성공률과 Retry 비율" /> : <Skel h={230} />}
        </Panel>
        <Panel title="평균 / p95 Pipeline Duration" right={<span className="sub">Pipeline 완료 기준 · 시간대별 · 단위 분 · 휠로 확대</span>}>
          {charts ? <EChart className="chart" option={charts.dur} ariaLabel="평균 및 p95 Pipeline 소요 시간" /> : <Skel h={230} />}
        </Panel>
        <Panel title="컴포넌트별 실행 시간" right={<span className="sub">avg · p95 (초)</span>}>
          {charts ? <EChart className="chart" option={charts.comp} ariaLabel="컴포넌트별 실행 시간" /> : <Skel h={230} />}
        </Panel>
        <Panel title="오류 원인 Top N" right={<span className="sub">Error code · 최근 7일 Attempt 기준</span>}>
          {errOpt ? <EChart className="chart" option={errOpt} ariaLabel="오류 코드 Top N" /> : <Skel h={230} />}
        </Panel>
        <Panel title="비용 추이" right={<span className="sub">일별 USD · * 진행 중</span>}>
          {costOpt ? <EChart className="chart" option={costOpt} ariaLabel="일별 비용 추이" /> : <Skel h={230} />}
        </Panel>
      </div>
      <Panel title="Pipeline Version 비교" icon={<GitBranch aria-hidden />} right={<span className="sub">후보 v1.2-rc vs 기준 v1.1</span>} bodyClassName="stack" bodyStyle={{ gap: 12 }}>
        {v11 && v12 && dc11 && dc12 && (
          <div className="callout t-failed">
            <b>회귀 감지 · 기기제어(SmartThings)</b> — v1.2-rc는 전체 Pass rate <span className="mono">{fmt.pct(v12.utterancePassRate, 1)}</span>로 v1.1(<span className="mono">{fmt.pct(v11.utterancePassRate, 1)}</span>)보다 높고 평균{" "}
            <span className="mono">{dur(v12.avgDurationSec * 1000)}</span>로 더 빠르지만, device_control 캡슐은{" "}
            <b className="mono">
              {fmt.pct(dc11.passRate, 1)} → {fmt.pct(dc12.passRate, 1)}
            </b>
            로 떨어졌습니다. 승격 전 해당 캡슐 실패 사례를 확인하세요.{" "}
            <Link className="btn sm" href="/flowline/results?capsule=device_control&version=v1.2-rc&result=FAIL">
              <Table2 aria-hidden />
              실패 사례 보기
            </Link>
          </div>
        )}
        {!s ? (
          <Skel h={160} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>버전</th>
                  <th>상태</th>
                  <th className="r">트래픽</th>
                  <th>모델 · Judge</th>
                  <th className="r">실행</th>
                  <th className="r">Pipeline 성공률</th>
                  <th className="r">Retry율</th>
                  <th className="r">평균 / p95</th>
                  <th className="r">발화 Pass rate</th>
                  <th className="r">Judge 평균</th>
                  <th className="r">p95 지연</th>
                  <th className="r">실행당 비용</th>
                </tr>
              </thead>
              <tbody>
                {vc.map((v) => (
                  <tr key={v.version}>
                    <td className="mono">
                      <b>{v.version}</b>
                    </td>
                    <td>
                      <VerPill status={v.status} />
                    </td>
                    <td className="r mono">{v.trafficPct}%</td>
                    <td className="mono sub">
                      {v.modelUnderTest} · {v.judgeModel}
                    </td>
                    <td className="r mono">{v.runs}</td>
                    <td className="r mono">{fmt.pct(v.pipelineSuccessRate, 1)}</td>
                    <td className="r mono">{fmt.pct(v.retryRate, 1)}</td>
                    <td className="r mono">
                      {dur(v.avgDurationSec * 1000)} / {dur(v.p95DurationSec * 1000)}
                    </td>
                    <td className="r mono">{fmt.pct(v.utterancePassRate, 1)}</td>
                    <td className="r mono">{v.avgJudgeScore != null ? v.avgJudgeScore.toFixed(2) : "-"}</td>
                    <td className="r mono">{fmt.number(v.p95LatencyMs)}ms</td>
                    <td className="r mono">{fmt.usd(v.costPerRunUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {charts ? <EChart className="chart" option={charts.ver} ariaLabel="버전별 캡슐 Pass rate 비교" /> : <Skel h={230} />}
      </Panel>
      <Panel title="언어별 요약">
        {!s ? (
          <Skel h={160} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>언어</th>
                  <th className="r">Workflow</th>
                  <th className="r">성공</th>
                  <th className="r">성공률</th>
                  <th className="r">DLQ</th>
                  <th className="r">평균 / p95</th>
                  <th className="r">오늘 발화</th>
                  <th className="r">오늘 Pass rate</th>
                  <th className="r">7일 처리량</th>
                </tr>
              </thead>
              <tbody>
                {s.languageSummary.map((l) => (
                  <tr key={l.code}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <Lang code={l.code} /> {l.name}
                      </span>
                    </td>
                    <td className="r mono">{l.workflows}</td>
                    <td className="r mono">{l.succeeded}</td>
                    <td className="r mono">{fmt.pct(l.successRate, 1)}</td>
                    <td className="r mono">{l.deadLettered}</td>
                    <td className="r mono">
                      {dur(l.avgDurationSec * 1000)} / {dur(l.p95DurationSec * 1000)}
                    </td>
                    <td className="r mono">{fmt.number(l.utterancesToday)}</td>
                    <td className="r mono">{fmt.pct(l.passRateToday, 1)}</td>
                    <td className="r mono">{fmt.number(l.throughput7d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
