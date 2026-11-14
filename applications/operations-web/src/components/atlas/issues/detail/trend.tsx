"use client";
/**
 * Issue detail — trend vs baseline: FAIL count and FAIL rate as two separate single-axis charts
 * (never a dual axis), the baseline as a dashed reference line, the spike bucket marked; plus the
 * Bixby-version / release regression comparison when the issue has one.
 */
import { GitCompareArrows, TrendingUp } from "lucide-react";
import { EChart } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { IssueDetail } from "@/lib/types";
import { useDimLabel, type IssueFormat } from "../../issues-shared";
import { axisX, axisY, baseOpt, opt, tooltip } from "../../chart";
import { Plate, useReducedMotionSafe } from "../../ui";
import { sevKey } from "./lib";

const DAY = 86_400_000;

function Compare({ rows, fx }: { rows: { label: string; rate: number; total: number; cur?: boolean }[]; fx: IssueFormat }) {
  const fm = useFmt();
  const max = Math.max(1, ...rows.map((r) => r.rate));
  return (
    <ul className="idt-cmp">
      {rows.map((r) => (
        <li key={r.label} data-cur={r.cur ? "" : undefined}>
          <span className="mono idt-cmp-l">{r.label}</span>
          <span className="idt-cmp-bar" aria-hidden>
            <i style={{ width: `${(r.rate / max) * 100}%` }} />
          </span>
          <span className="mono idt-cmp-v">
            {fx.pct(r.rate)} <small>n={fm.number(r.total)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Trend({ d, fx }: { d: IssueDetail; fx: IssueFormat }) {
  const t = useT("issuesDetail");
  const s = useT("issues");
  const fm = useFmt();
  const dl = useDimLabel();
  const rm = useReducedMotionSafe();
  const pts = d.trend.points;
  const hour = d.trend.bucket === "hour";
  const lbl = (ts: number) => (hour ? fm.hm(ts) : fm.dateLabel(ts));
  const bucket = s(`bucket.${d.trend.bucket}`);
  // expected FAILs per bucket from the baseline window (same intent scope)
  const bDays = Math.max(1, (d.baseline.to - d.baseline.from) / DAY);
  const perBucket = d.baseline.sufficient ? (d.baseline_count / bDays) * (hour ? 1 / 24 : 1) : null;
  const trendF = d.factors.find((f) => f.key === "trend");
  const z = typeof trendF?.detail.z === "number" ? (trendF.detail.z as number) : null;
  let spike = -1;
  pts.forEach((p, i) => {
    if (spike < 0 || p.fails > pts[spike].fails) spike = i;
  });
  const spiking = spike >= 0 && pts[spike].fails > 0 && (z ?? 0) >= 2;
  const sev = `--sev-${sevKey(d.severity)}`;
  const br = d.bixby_regression;
  const rg = d.regression;
  return (
    <Plate title={<><TrendingUp aria-hidden /> {t("trend.title")}</>} refText={t("trend.ref", { bucket, mode: s(`baseline.mode.${d.baseline.mode}`) })}>
      <div className="idt-trend">
        <figure className="idt-chart">
          <figcaption>
            <b>{t("trend.countTitle")}</b>
            <span className="muted">{perBucket != null ? t("trend.countSub", { n: perBucket.toFixed(perBucket < 10 ? 1 : 0), bucket }) : t("trend.noBaseline")}</span>
          </figcaption>
          <EChart
            className="idt-ec"
            ariaLabel={t("trend.countTitle")}
            option={(tk) =>
              opt(
                baseOpt(tk, rm, {
                  grid: { left: 36, right: 14, top: 18, bottom: 26 },
                  legend: { show: false },
                  tooltip: tooltip(tk, {
                    axisPointer: { type: "shadow", shadowStyle: { color: tk.read("--accent-soft") } },
                    formatter: (ps: { dataIndex: number }[]) => {
                      const p = pts[ps[0]?.dataIndex ?? 0];
                      if (!p) return "";
                      return `${lbl(p.t)}<br/>FAIL <b>${fm.number(p.fails)}</b>${perBucket != null ? ` · ${t("trend.expected")} ${perBucket.toFixed(1)}` : ""}${spiking && ps[0]?.dataIndex === spike ? `<br/><b>${t("trend.spike")}</b> z=${z?.toFixed(1)}` : ""}`;
                    },
                  }),
                  xAxis: axisX(tk, pts.map((p) => lbl(p.t)), { boundaryGap: true }),
                  yAxis: axisY(tk, { minInterval: 1 }),
                  series: [
                    {
                      type: "bar",
                      name: "FAIL",
                      barMaxWidth: 16,
                      itemStyle: { color: tk.read(sev), borderRadius: [4, 4, 0, 0] },
                      emphasis: { itemStyle: { color: tk.read(sev) } },
                      data: pts.map((p, i) => (spiking && i === spike ? { value: p.fails, itemStyle: { color: tk.read(sev), borderColor: tk.text, borderWidth: 1.5 } } : p.fails)),
                      markLine:
                        perBucket != null && perBucket > 0
                          ? {
                              symbol: "none",
                              silent: true,
                              lineStyle: { color: tk.muted, type: "dashed", width: 1.5 },
                              label: { formatter: t("trend.baseline"), color: tk.muted, fontFamily: tk.mono, fontSize: 10, position: "insideEndTop" },
                              data: [{ yAxis: Number(perBucket.toFixed(2)) }],
                            }
                          : undefined,
                      markPoint: spiking
                        ? {
                            symbol: "pin",
                            symbolSize: 40,
                            itemStyle: { color: tk.text },
                            label: { formatter: t("trend.spikeShort"), color: tk.surface, fontSize: 8, fontFamily: tk.mono },
                            data: [{ coord: [spike, pts[spike].fails] }],
                          }
                        : undefined,
                    },
                  ],
                }),
              )
            }
          />
        </figure>
        <figure className="idt-chart">
          <figcaption>
            <b>{t("trend.rateTitle")}</b>
            <span className="muted">{d.baseline_rate != null ? t("trend.rateSub", { rate: fx.pct(d.baseline_rate) }) : t("trend.noBaseline")}</span>
          </figcaption>
          <EChart
            className="idt-ec"
            ariaLabel={t("trend.rateTitle")}
            option={(tk) =>
              opt(
                baseOpt(tk, rm, {
                  grid: { left: 40, right: 14, top: 18, bottom: 26 },
                  legend: { show: false },
                  tooltip: tooltip(tk, {
                    formatter: (ps: { dataIndex: number }[]) => {
                      const p = pts[ps[0]?.dataIndex ?? 0];
                      if (!p) return "";
                      return `${lbl(p.t)}<br/>${t("trend.rate")} <b>${fx.pct(p.fail_rate)}</b> (${fm.number(p.fails)}/${fm.number(p.total)})${d.baseline_rate != null ? `<br/>Baseline ${fx.pct(d.baseline_rate)}` : ""}`;
                    },
                  }),
                  xAxis: axisX(tk, pts.map((p) => lbl(p.t)), { boundaryGap: true }),
                  yAxis: axisY(tk, { axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: "{value}%" } }),
                  series: [
                    {
                      type: "line",
                      name: t("trend.rate"),
                      connectNulls: false,
                      symbol: "circle",
                      symbolSize: 8,
                      showSymbol: pts.length <= 31,
                      lineStyle: { width: 2, color: tk.read("--accent") },
                      itemStyle: { color: tk.read("--accent"), borderColor: tk.surface, borderWidth: 2 },
                      areaStyle: { color: tk.read("--accent-soft") },
                      data: pts.map((p) => p.fail_rate),
                      markLine:
                        d.baseline_rate != null
                          ? {
                              symbol: "none",
                              silent: true,
                              lineStyle: { color: tk.muted, type: "dashed", width: 1.5 },
                              label: { formatter: `Baseline ${fx.pct(d.baseline_rate)}`, color: tk.muted, fontFamily: tk.mono, fontSize: 10, position: "insideEndTop" },
                              data: [{ yAxis: d.baseline_rate }],
                            }
                          : undefined,
                    },
                  ],
                }),
              )
            }
          />
        </figure>
        {br || rg ? (
          <div className="idt-regs">
            {br ? (
              <section className="idt-reg" data-kind="bixby">
                <h3>
                  <GitCompareArrows aria-hidden /> {t("trend.bixbyTitle", { division: dl.value("division", br.division) })}
                </h3>
                <p>{t("trend.bixbyLine", { division: dl.value("division", br.division), previous: br.previous, prevRate: fx.pct(br.previousRate), current: br.current, curRate: fx.pct(br.currentRate), z: br.z.toFixed(1) })}</p>
                <Compare
                  fx={fx}
                  rows={[
                    { label: `Bixby ${br.previous}`, rate: br.previousRate, total: br.previousTotal },
                    { label: `Bixby ${br.current}`, rate: br.currentRate, total: br.currentTotal, cur: true },
                  ]}
                />
              </section>
            ) : null}
            {rg ? (
              <section className="idt-reg" data-kind="release">
                <h3>
                  <GitCompareArrows aria-hidden /> {t("trend.releaseTitle", { axis: fx.column(rg.axis) })}
                </h3>
                <Compare
                  fx={fx}
                  rows={[
                    { label: rg.previous, rate: rg.previousRate, total: rg.previousTotal },
                    { label: rg.current, rate: rg.currentRate, total: rg.currentTotal, cur: true },
                  ]}
                />
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </Plate>
  );
}
