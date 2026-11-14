"use client";
/**
 * /quality — 개요 / Overview: KPIs with Δ vs the previous equal window, pass-rate trend, by division / region,
 * failure_reason distribution and top failing intents. Every slice drills down to /results.
 */
import { motion } from "motion/react";
import { EChart, type ChartTokens } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import { useApi, qualityApi } from "@/lib/client";
import type { QualitySummary, QualityValueStat } from "@/lib/types";
import { axisX, axisY, baseOpt, opt, tooltip } from "../chart";
import { useReducedMotionSafe } from "../ui";
import { Delta, Drill, Kpi, Panel, QState, deltaOf, reasonVar } from "./bits";
import { bucketLabel, bucketTick, rateFloor, tipHead, tipRow } from "./charts";
import { fmtRate, grp, useDrill, useQLabel, useQualityFilters, type FilterKey } from "./model";

function useSummary() {
  const f = useQualityFilters();
  const res = useApi(["quality", "summary", f.query], () => qualityApi.summary(f.query), { revalidateOn: ["transition"], throttleMs: 5000 });
  return { f, res };
}

function Kpis({ d, f }: { d: QualitySummary; f: ReturnType<typeof useQualityFilters> }) {
  const t = useT("quality");
  const drill = useDrill(f);
  const k = d.kpis;
  return (
    <div className="qd-kpis">
      <Kpi k={t("kpi.passRate")} v={fmtRate(k.pass_rate)} delta={<Delta v={k.delta_pp} />} sub={t("kpi.prev", { v: fmtRate(k.prev_pass_rate) })} />
      <Kpi
        k={t("kpi.fails")}
        v={grp(k.fail)}
        delta={<Delta v={k.prev_total ? k.fail_delta : null} unit="count" good="down" />}
        sub={t("kpi.prev", { v: grp(k.prev_fail) })}
        href={drill({ result: "FAIL" }).href}
        title={t("drill.failRows")}
      />
      <Kpi
        k={t("kpi.rows")}
        v={grp(k.total)}
        delta={<Delta v={k.prev_total ? k.total - k.prev_total : null} unit="count" good="none" />}
        sub={t("kpi.prev", { v: grp(k.prev_total) })}
        href={drill().href}
        title={t("drill.toResults")}
      />
      <Kpi
        k={t("kpi.avgScore")}
        v={k.avg_judge_score == null ? "—" : k.avg_judge_score.toFixed(3)}
        delta={<Delta v={deltaOf(k.avg_judge_score, k.prev_avg_judge_score)} unit="score" />}
        sub={t("kpi.prev", {
          v: k.prev_avg_judge_score == null ? "—" : k.prev_avg_judge_score.toFixed(3),
        })}
      />
      <Kpi
        k={t("kpi.p50")}
        v={k.latency_p50_ms == null ? "—" : grp(k.latency_p50_ms)}
        unit="ms"
        delta={<Delta v={deltaOf(k.latency_p50_ms, k.prev_latency_p50_ms)} unit="ms" good="down" />}
        sub={t("kpi.prev", {
          v: k.prev_latency_p50_ms == null ? "—" : grp(k.prev_latency_p50_ms) + "ms",
        })}
      />
      <Kpi
        k={t("kpi.p95")}
        v={k.latency_p95_ms == null ? "—" : grp(k.latency_p95_ms)}
        unit="ms"
        delta={<Delta v={deltaOf(k.latency_p95_ms, k.prev_latency_p95_ms)} unit="ms" good="down" />}
        sub={t("kpi.prev", {
          v: k.prev_latency_p95_ms == null ? "—" : grp(k.prev_latency_p95_ms) + "ms",
        })}
      />
    </div>
  );
}

function Trend({ d }: { d: QualitySummary }) {
  const t = useT("quality");
  const rm = useReducedMotionSafe();
  const tr = d.trend;
  const floor = rateFloor(tr.pass_rate);
  return (
    <EChart
      className="qd-chart"
      ariaLabel={t("overview.trend")}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, rm, {
            grid: { left: 44, right: 16, top: 16, bottom: 28 },
          }),
          legend: { show: false },
          tooltip: tooltip(tk, {
            formatter: (ps: { dataIndex: number }[]) => {
              const i = ps[0]?.dataIndex ?? 0;
              return (
                tipHead(tk, bucketLabel(tr.t[i], tr.bucket)) +
                tipRow(tk, tk.read("--qd-line"), t("metric.pass_rate"), fmtRate(tr.pass_rate[i])) +
                tipRow(tk, null, t("metric.total"), grp(tr.total[i])) +
                tipRow(tk, null, t("metric.fail_count"), grp(tr.fail[i]))
              );
            },
          }),
          xAxis: axisX(
            tk,
            tr.t.map((x) => bucketTick(x, tr.bucket)),
          ),
          yAxis: axisY(tk, {
            min: floor,
            max: 100,
            axisLabel: {
              color: tk.muted,
              fontSize: 10,
              fontFamily: tk.mono,
              formatter: "{value}%",
            },
          }),
          series: [
            {
              type: "line",
              name: t("metric.pass_rate"),
              data: tr.pass_rate,
              connectNulls: false,
              showSymbol: tr.t.length <= 31,
              symbolSize: 6,
              lineStyle: { width: 2, color: tk.read("--qd-line") },
              itemStyle: {
                color: tk.read("--qd-line"),
                borderColor: tk.surface,
                borderWidth: 2,
              },
              areaStyle: { color: tk.read("--qd-line-area") },
            },
          ],
        })
      }
    />
  );
}

/** horizontal pass-rate bars (single measure, 0-baseline) with FAILs, Δ and a drill link per row */
function RateList({ dim, items, f }: { dim: FilterKey; items: QualityValueStat[]; f: ReturnType<typeof useQualityFilters> }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  const rm = useReducedMotionSafe();
  const shown = items.filter((i) => i.total > 0);
  if (!shown.length) return <p className="qd-empty muted">{t("state.empty")}</p>;
  return (
    <ul className="qd-rates">
      {shown.map((i, n) => (
        <li key={i.value}>
          <Drill link={drill({ [dim]: i.value })} className="qd-rate" label={t("drill.slice", { v: L.value(dim, i.value) })}>
            <span className="qd-rate-k">{L.value(dim, i.value)}</span>
            <span className="qd-rate-bar" aria-hidden>
              <motion.i
                initial={rm ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: rm ? 0 : 0.5,
                  delay: rm ? 0 : n * 0.03,
                }}
                style={{ width: `${i.pass_rate ?? 0}%` }}
              />
            </span>
            <span className="qd-rate-v mono">{fmtRate(i.pass_rate)}</span>
            <Delta v={i.delta_pp} />
            <span className="qd-rate-n mono muted" title={t("metric.fail_count")}>
              {t("stat.failsShort", { n: grp(i.fail) })}
            </span>
          </Drill>
        </li>
      ))}
    </ul>
  );
}

function Reasons({ d, f }: { d: QualitySummary; f: ReturnType<typeof useQualityFilters> }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  const all = d.failure_reasons;
  const sum = all.reduce((a, r) => a + r.fail, 0);
  if (!sum) return <p className="qd-empty muted">{t("state.noFails")}</p>;
  return (
    <div className="qd-reasons">
      <div className="qd-stack" role="img" aria-label={t("overview.reasonsStack")}>
        {all
          .filter((r) => r.fail > 0)
          .map((r) => (
            <i key={r.value} style={{ flexGrow: r.fail, background: reasonVar(r.value) }} title={`${L.value("failure_reason", r.value)} · ${grp(r.fail)} · ${r.share.toFixed(1)}%`} />
          ))}
      </div>
      <div className="tbl-wrap">
        <table className="t qd-tbl">
          <thead>
            <tr>
              <th>{t("dim.failure_reason")}</th>
              <th className="num">{t("metric.fail_count")}</th>
              <th className="num">{t("metric.share")}</th>
              <th className="num">{t("metric.failDelta")}</th>
              <th aria-label={t("drill.toResults")} />
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.value}>
                <td>
                  <span className="qd-sw" style={{ background: reasonVar(r.value) }} aria-hidden />
                  {L.value("failure_reason", r.value)} <span className="mono muted qd-code hide-sm">{r.value}</span>
                </td>
                <td className="num mono">{grp(r.fail)}</td>
                <td className="num mono">{r.share.toFixed(1)}%</td>
                <td className="num">
                  <Delta v={r.prev_total ? r.fail_delta : null} unit="count" good="down" />
                </td>
                <td className="act">
                  <Drill link={drill({ failure_reason: r.value, result: "FAIL" })} label={t("drill.failRows")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopIntents({ d, f }: { d: QualitySummary; f: ReturnType<typeof useQualityFilters> }) {
  const t = useT("quality");
  const drill = useDrill(f);
  if (!d.top_intents.length) return <p className="qd-empty muted">{t("state.noFails")}</p>;
  const max = Math.max(...d.top_intents.map((i) => i.fail));
  return (
    <div className="tbl-wrap">
      <table className="t qd-tbl">
        <thead>
          <tr>
            <th>{t("dim.intent")}</th>
            <th className="num">{t("metric.fail_count")}</th>
            <th className="num hide-sm">{t("metric.total")}</th>
            <th className="num">{t("metric.pass_rate")}</th>
            <th className="num">{t("metric.delta")}</th>
            <th aria-label={t("drill.toResults")} />
          </tr>
        </thead>
        <tbody>
          {d.top_intents.map((i) => (
            <tr key={i.value}>
              <td className="mono qd-intent">
                <span className="qd-inbar" style={{ width: `${(i.fail / max) * 100}%` }} aria-hidden />
                {i.value}
              </td>
              <td className="num mono">{grp(i.fail)}</td>
              <td className="num mono hide-sm">{grp(i.total)}</td>
              <td className="num mono">{fmtRate(i.pass_rate)}</td>
              <td className="num">
                <Delta v={i.delta_pp} />
              </td>
              <td className="act">
                <Drill link={drill({ intent: i.value, result: "FAIL" })} label={t("drill.failRows")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QualityOverview() {
  const t = useT("quality");
  const fm = useFmt();
  const { f, res } = useSummary();
  const d = res.data;
  return (
    <div className="qd-view">
      <QState error={res.error} loading={!d} rows={3}>
        {d ? (
          <>
            <Kpis d={d} f={f} />
            {!d.kpis.prev_total ? (
              <p className="note qd-note">
                {t("delta.noPrevWindow", {
                  from: fm.dateTimeLabel(d.previous.from, { tz: false }),
                  to: fm.dateTimeLabel(d.previous.to, { tz: false }),
                })}
              </p>
            ) : null}
            <Panel
              title={t("overview.trend")}
              sub={t("overview.trendSub", {
                bucket: t(`bucket.${d.trend.bucket}`),
              })}
            >
              {d.kpis.total ? <Trend d={d} /> : <p className="qd-empty muted">{t("state.empty")}</p>}
            </Panel>
            <div className="qd-grid2">
              <Panel title={t("overview.byDivision")} sub={t("overview.byRefSub", { table: "R1 device → division" })}>
                <RateList dim="division" items={d.by_division} f={f} />
              </Panel>
              <Panel title={t("overview.byRegion")} sub={t("overview.byRefSub", { table: "R2 market → region" })}>
                <RateList dim="region" items={d.by_region} f={f} />
              </Panel>
            </div>
            <div className="qd-grid2">
              <Panel title={t("overview.reasons")} sub={t("overview.reasonsSub")}>
                <Reasons d={d} f={f} />
              </Panel>
              <Panel title={t("overview.topIntents")} sub={t("overview.topIntentsSub")}>
                <TopIntents d={d} f={f} />
              </Panel>
            </div>
          </>
        ) : null}
      </QState>
    </div>
  );
}
