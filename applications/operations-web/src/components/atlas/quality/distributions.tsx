"use client";
/**
 * /quality/distributions — 분포 / Distributions: judge_score and latency histograms (PASS vs FAIL), failure_reason ×
 * any row dim, FAILs per failure code over time, and the latest FAIL rows per code with their judge_reason verbatim
 * (row-level only — nothing aggregates judge_reason text; that is M1 / M4).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EChart, type ChartTokens } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import { parseAsString, useApi, useQueryStates, qualityApi } from "@/lib/client";
import type { QualityDim, QualityDistributions, QualityHistogram } from "@/lib/types";
import { axisX, axisY, baseOpt, catY, opt, tooltip } from "../chart";
import { useReducedMotionSafe } from "../ui";
import { Delta, Drill, Panel, QState, deltaOf, reasonColor, reasonVar } from "./bits";
import { DimSelect } from "./breakdown";
import { bucketLabel, bucketTick, tipHead, tipRow } from "./charts";
import { Q_DIMS, grp, useDrill, useQLabel, useQualityFilters, type QualityFiltersApi } from "./model";

const P = { by: parseAsString.withDefault("division") };

function Histogram({ h, labels, name, marks }: { h: QualityHistogram; labels: string[]; name: string; marks?: { at: number; label: string }[] }) {
  const t = useT("quality");
  const rm = useReducedMotionSafe();
  return (
    <EChart
      className="qd-chart"
      ariaLabel={name}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, rm, {
            grid: { left: 48, right: 12, top: 34, bottom: 30 },
          }),
          legend: {
            top: 0,
            left: 0,
            icon: "roundRect",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: tk.text, fontSize: 11, fontFamily: tk.font },
          },
          tooltip: tooltip(tk, {
            axisPointer: {
              type: "shadow",
              shadowStyle: { color: tk.read("--qd-hover") },
            },
            formatter: (ps: { dataIndex: number }[]) => {
              const i = ps[0]?.dataIndex ?? 0;
              const tot = h.pass[i] + h.fail[i];
              return (
                tipHead(tk, labels[i]) +
                tipRow(tk, tk.read("--qd-pass"), "PASS", grp(h.pass[i])) +
                tipRow(tk, tk.read("--qd-fail"), "FAIL", grp(h.fail[i])) +
                tipRow(tk, null, t("metric.total"), grp(tot))
              );
            },
          }),
          xAxis: axisX(tk, labels, {
            boundaryGap: true,
            axisLabel: {
              color: tk.muted,
              fontSize: 10,
              fontFamily: tk.mono,
              hideOverlap: true,
            },
          }),
          yAxis: axisY(tk, { min: 0 }),
          series: [
            {
              type: "bar",
              name: "PASS",
              stack: "h",
              data: h.pass,
              barCategoryGap: "18%",
              itemStyle: {
                color: tk.read("--qd-pass"),
                borderColor: tk.surface,
                borderWidth: 1,
              },
            },
            {
              type: "bar",
              name: "FAIL",
              stack: "h",
              data: h.fail,
              itemStyle: {
                color: tk.read("--qd-fail"),
                borderColor: tk.surface,
                borderWidth: 1,
                borderRadius: [3, 3, 0, 0],
              },
              markLine: marks?.length
                ? {
                    symbol: "none",
                    silent: true,
                    label: {
                      color: tk.text,
                      fontFamily: tk.mono,
                      fontSize: 10,
                      formatter: (p: { name: string }) => p.name,
                    },
                    lineStyle: { color: tk.muted, type: "dashed", width: 1 },
                    data: marks.map((m) => ({ name: m.label, xAxis: m.at })),
                  }
                : undefined,
            },
          ],
        })
      }
    />
  );
}

function scoreLabels(h: QualityHistogram) {
  return h.edges.map((e, i) => `${e.toFixed(1)}–${(h.edges[i + 1] ?? 1).toFixed(1)}`);
}
function latencyLabels(h: QualityHistogram) {
  const s = (ms: number) => (ms >= 1000 ? `${ms / 1000}s` : `${ms}`);
  return h.edges.map((e, i) => (i === h.edges.length - 1 ? `${s(e)}+` : `${s(e)}–${s(h.edges[i + 1])}`));
}
const binOf = (edges: number[], v: number | null) => {
  if (v == null) return 0;
  let i = edges.length - 1;
  while (i > 0 && v < edges[i]) i--;
  return i;
};

function ReasonBy({ d, f }: { d: QualityDistributions; f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const rm = useReducedMotionSafe();
  const drill = useDrill(f);
  const router = useRouter();
  const rb = d.reason_by;
  const labels = rb.values.map((v) => L.value(rb.dim, v));
  if (!rb.values.length) return <p className="qd-empty muted">{t("state.noFails")}</p>;
  return (
    <EChart
      className="qd-chart"
      style={{ height: Math.max(200, 60 + rb.values.length * 30) }}
      ariaLabel={t("dist.reasonBy", { by: L.dim(rb.dim) })}
      onEvents={{
        click: (p) => {
          const pp = p as { dataIndex: number; seriesIndex: number };
          const v = rb.values[pp.dataIndex];
          const r = rb.reasons[pp.seriesIndex];
          if (v && r) router.push(drill({ [rb.dim]: v, failure_reason: r, result: "FAIL" }).href);
        },
      }}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, rm, {
            grid: {
              left: 8,
              right: 16,
              top: 56,
              bottom: 24,
              containLabel: true,
            },
          }),
          legend: {
            top: 0,
            left: 0,
            icon: "roundRect",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: tk.text, fontSize: 11, fontFamily: tk.font },
          },
          tooltip: tooltip(tk, {
            axisPointer: {
              type: "shadow",
              shadowStyle: { color: tk.read("--qd-hover") },
            },
            formatter: (ps: { dataIndex: number }[]) => {
              const i = ps[0]?.dataIndex ?? 0;
              const tot = rb.totals[i] || 1;
              return (
                tipHead(tk, `${labels[i]} · FAIL ${grp(rb.totals[i])}`) +
                rb.reasons.map((r, k) => tipRow(tk, reasonColor(tk, r), L.value("failure_reason", r), `${grp(rb.counts[k][i])} · ${((rb.counts[k][i] / tot) * 100).toFixed(1)}%`)).join("")
              );
            },
          }),
          xAxis: axisY(tk, { min: 0 }),
          yAxis: catY(tk, labels),
          series: rb.reasons.map((r, k) => ({
            type: "bar",
            name: L.value("failure_reason", r),
            stack: "r",
            barMaxWidth: 18,
            data: rb.counts[k],
            itemStyle: {
              color: reasonColor(tk, r),
              borderColor: tk.surface,
              borderWidth: 1,
            },
            emphasis: { focus: "series" },
          })),
        })
      }
    />
  );
}

function ReasonTrend({ d }: { d: QualityDistributions }) {
  const t = useT("quality");
  const L = useQLabel();
  const rm = useReducedMotionSafe();
  const tr = d.reason_trend;
  return (
    <EChart
      className="qd-chart"
      ariaLabel={t("dist.reasonTrend")}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, rm, {
            grid: { left: 44, right: 16, top: 56, bottom: 28 },
          }),
          legend: {
            top: 0,
            left: 0,
            icon: "roundRect",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: tk.text, fontSize: 11, fontFamily: tk.font },
          },
          tooltip: tooltip(tk, {
            formatter: (ps: { dataIndex: number }[]) => {
              const i = ps[0]?.dataIndex ?? 0;
              return tipHead(tk, bucketLabel(tr.t[i], tr.bucket)) + tr.series.map((s) => tipRow(tk, reasonColor(tk, s.reason), L.value("failure_reason", s.reason), grp(s.fail[i]))).join("");
            },
          }),
          xAxis: axisX(
            tk,
            tr.t.map((x) => bucketTick(x, tr.bucket)),
          ),
          yAxis: axisY(tk, { min: 0 }),
          series: tr.series.map((s) => ({
            type: "line",
            name: L.value("failure_reason", s.reason),
            data: s.fail,
            showSymbol: tr.t.length <= 31,
            symbolSize: 6,
            lineStyle: { width: 2, color: reasonColor(tk, s.reason) },
            itemStyle: {
              color: reasonColor(tk, s.reason),
              borderColor: tk.surface,
              borderWidth: 2,
            },
            emphasis: { focus: "series" },
          })),
        })
      }
    />
  );
}

function Examples({ d, f }: { d: QualityDistributions; f: QualityFiltersApi }) {
  const t = useT("quality");
  const fm = useFmt();
  const L = useQLabel();
  const drill = useDrill(f);
  const prevAny = d.reason_trend.series.some((x) => x.prev_total > 0);
  return (
    <div className="qd-ex">
      {d.examples.map((g) => {
        const base = drill({ failure_reason: g.reason, result: "FAIL" });
        const s = d.reason_trend.series.find((x) => x.reason === g.reason);
        return (
          <section key={g.reason} className="qd-ex-g" style={{ ["--rc" as string]: reasonVar(g.reason) }}>
            <header>
              <span className="qd-sw" aria-hidden />
              <b>{L.value("failure_reason", g.reason)}</b>
              <span className="mono muted qd-code">{g.reason}</span>
              <span className="qd-ex-n mono">{grp(g.count)}</span>
              {s ? <Delta v={prevAny ? s.total - s.prev_total : null} unit="count" good="down" /> : null}
            </header>
            {g.rows.length ? (
              <ul>
                {g.rows.map((r) => (
                  <li key={r.utterance_id}>
                    <Link href={base.href + (base.href.includes("?") ? "&" : "?") + "utt=" + encodeURIComponent(r.utterance_id)} className="qd-ex-row" title={t("dist.openRow")}>
                      <span className="qd-ex-u">“{r.utterance_text}”</span>
                      <span className="qd-ex-i mono">
                        {r.intent_expected} → {r.intent_predicted || "—"} · {r.judge_score.toFixed(2)}
                      </span>
                      <span className="qd-ex-r">{r.judge_reason}</span>
                      <span className="qd-ex-m mono muted">
                        {L.value("device", r.device_type)} · {L.value("language", r.language)} · {fm.dateTimeLabel(r.eval_ts, { tz: false })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="qd-empty muted">{t("state.noFails")}</p>
            )}
            {g.count ? (
              <Drill link={base} className="qd-ex-all" label={t("drill.failRows")}>
                {t("dist.allRows", { n: grp(g.count) })}
              </Drill>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function QualityDistributionsView() {
  const t = useT("quality");
  const L = useQLabel();
  const f = useQualityFilters();
  const [p, setP] = useQueryStates(P);
  const by = (Q_DIMS.includes(p.by as QualityDim) && p.by !== "failure_reason" ? p.by : "division") as QualityDim;
  const q = { ...f.query, by, examples: 3 };
  const res = useApi(["quality", "dist", q], () => qualityApi.distributions(q), { revalidateOn: ["transition"], throttleMs: 5000 });
  const d = res.data && res.data.reason_by.dim === by ? res.data : undefined;
  return (
    <div className="qd-view">
      <QState error={res.error} loading={!d} empty={!!d && !d.total}>
        {d ? (
          <>
            <div className="qd-grid2">
              <Panel
                title={t("dist.score")}
                sub={t("dist.scoreSub")}
                right={
                  <span className="qd-panel-stat">
                    <span className="mono">
                      {t("dist.avg", {
                        v: d.judge_score.avg?.toFixed(3) ?? "—",
                      })}
                    </span>
                    <Delta v={deltaOf(d.judge_score.avg, d.judge_score.prev_avg)} unit="score" />
                  </span>
                }
              >
                <Histogram
                  h={d.judge_score}
                  labels={scoreLabels(d.judge_score)}
                  name={t("dist.score")}
                  marks={
                    d.judge_score.avg != null
                      ? [
                          {
                            at: binOf(d.judge_score.edges, d.judge_score.avg),
                            label: t("dist.avgMark"),
                          },
                        ]
                      : []
                  }
                />
              </Panel>
              <Panel
                title={t("dist.latency")}
                sub={t("dist.latencySub")}
                right={
                  <span className="qd-panel-stat">
                    <span className="mono">p50 {d.latency.p50 != null ? grp(d.latency.p50) : "—"}ms</span>
                    <Delta v={deltaOf(d.latency.p50, d.latency.prev_p50)} unit="ms" good="down" />
                    <span className="mono">p95 {d.latency.p95 != null ? grp(d.latency.p95) : "—"}ms</span>
                    <Delta v={deltaOf(d.latency.p95, d.latency.prev_p95)} unit="ms" good="down" />
                  </span>
                }
              >
                <Histogram
                  h={d.latency}
                  labels={latencyLabels(d.latency)}
                  name={t("dist.latency")}
                  marks={[
                    ...(d.latency.p50 != null
                      ? [
                          {
                            at: binOf(d.latency.edges, d.latency.p50),
                            label: "p50",
                          },
                        ]
                      : []),
                    ...(d.latency.p95 != null
                      ? [
                          {
                            at: binOf(d.latency.edges, d.latency.p95),
                            label: "p95",
                          },
                        ]
                      : []),
                  ]}
                />
              </Panel>
            </div>
            <div className="qd-grid2">
              <Panel
                title={t("dist.reasonBy", { by: L.dim(by) })}
                sub={t("dist.reasonBySub")}
                right={<DimSelect value={by} onChange={(v) => setP({ by: v })} label={t("dist.by")} exclude={["failure_reason"]} />}
              >
                <ReasonBy d={d} f={f} />
                {d.reason_by.folded ? <p className="qd-meta muted">{t("dist.folded", { n: d.reason_by.folded })}</p> : null}
              </Panel>
              <Panel
                title={t("dist.reasonTrend")}
                sub={t("dist.reasonTrendSub", {
                  bucket: t(`bucket.${d.reason_trend.bucket}`),
                })}
              >
                <ReasonTrend d={d} />
              </Panel>
            </div>
            <Panel title={t("dist.examples")} sub={t("dist.examplesSub")}>
              <Examples d={d} f={f} />
            </Panel>
          </>
        ) : null}
      </QState>
    </div>
  );
}
