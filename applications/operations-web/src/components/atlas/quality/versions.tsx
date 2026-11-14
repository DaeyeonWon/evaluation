"use client";
/**
 * /quality/versions — 버전 비교 / Versions: model_version · bixby_version · pipeline_version as a plain delta table
 * (each version vs the one before it, and vs the previous equal window), failure_reason mix per version, pass rate
 * per division / region / agent_function (grouped bars) and per version over time. No significance testing (M2).
 */
import { Info } from "lucide-react";
import Link from "next/link";
import { EChart, type ChartTokens } from "@/components/shared";
import { useT } from "@/i18n/client";
import { parseAsString, useApi, useQueryStates, qualityApi } from "@/lib/client";
import type { QualityVersionBy, QualityVersionDim, QualityVersions } from "@/lib/types";
import { axisX, axisY, baseOpt, opt, tooltip } from "../chart";
import { JudgeCaveat } from "../judge-caveat";
import { useReducedMotionSafe } from "../ui";
import { useRangeHref } from "../time-range";
import { Delta, Drill, Panel, QState, reasonVar, verColor, verVar } from "./bits";
import { bucketLabel, bucketTick, rateFloor, tipHead, tipRow } from "./charts";
import { FAILURE_REASONS, fmtRate, grp, useDrill, useQLabel, useQualityFilters, type QualityFiltersApi } from "./model";

const DIMS: QualityVersionDim[] = ["model_version", "bixby_version", "pipeline_version"];
const BYS: QualityVersionBy[] = ["division", "region", "agent_function"];
const P = {
  vdim: parseAsString.withDefault("model_version"),
  by: parseAsString.withDefault("division"),
};

function DeltaTable({ d, f }: { d: QualityVersions; f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  return (
    <div className="tbl-wrap">
      <table className="t qd-tbl qd-vt">
        <thead>
          <tr>
            <th>{L.dim(d.dim)}</th>
            <th className="num">{t("metric.total")}</th>
            <th className="num">{t("metric.pass_rate")}</th>
            <th className="num">{t("versions.vsPrevVersion")}</th>
            <th className="num hide-sm">{t("metric.delta")}</th>
            <th className="num">{t("metric.fail_count")}</th>
            <th className="qd-mix-h">{t("versions.mix")}</th>
            <th aria-label={t("drill.toResults")} />
          </tr>
        </thead>
        <tbody>
          {d.items.map((v, i) => {
            const mixTotal = Object.values(v.failure_mix).reduce((a, n) => a + (n ?? 0), 0);
            return (
              <tr key={v.value}>
                <td className="mono">
                  <span className="qd-sw" style={{ background: verVar(i, d.versions.length) }} aria-hidden />
                  {v.value}
                </td>
                <td className="num mono">{grp(v.total)}</td>
                <td className="num mono">{fmtRate(v.pass_rate)}</td>
                <td className="num">
                  {v.baseline_version ? <Delta v={v.vs_prev_version_pp} title={t("versions.vsVersion", { v: v.baseline_version })} /> : <span className="muted mono">{t("versions.base")}</span>}
                </td>
                <td className="num hide-sm">
                  <Delta v={v.delta_pp} />
                </td>
                <td className="num mono">{grp(v.fail)}</td>
                <td className="qd-mix-c">
                  <span className="qd-stack sm" role="img" aria-label={FAILURE_REASONS.map((r) => `${L.value("failure_reason", r)} ${v.failure_mix[r] ?? 0}`).join(", ")}>
                    {FAILURE_REASONS.filter((r) => v.failure_mix[r]).map((r) => (
                      <i
                        key={r}
                        style={{
                          flexGrow: v.failure_mix[r],
                          background: reasonVar(r),
                        }}
                        title={`${L.value("failure_reason", r)} · ${grp(v.failure_mix[r] ?? 0)} · ${(((v.failure_mix[r] ?? 0) / Math.max(1, mixTotal)) * 100).toFixed(1)}%`}
                      />
                    ))}
                  </span>
                </td>
                <td className="act">
                  <Drill link={drill({ [d.dim]: v.value })} label={t("drill.slice", { v: v.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MixLegend() {
  const L = useQLabel();
  return (
    <ul className="qd-legend">
      {FAILURE_REASONS.map((r) => (
        <li key={r}>
          <span className="qd-sw" style={{ background: reasonVar(r) }} aria-hidden />
          {L.value("failure_reason", r)}
        </li>
      ))}
    </ul>
  );
}

function GroupBars({ d }: { d: QualityVersions }) {
  const t = useT("quality");
  const L = useQLabel();
  const rm = useReducedMotionSafe();
  const groups = d.groups;
  return (
    <EChart
      className="qd-chart tall"
      ariaLabel={t("versions.byGroup", { by: L.dim(d.by) })}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, rm, {
            grid: {
              left: 44,
              right: 12,
              top: 36,
              bottom: d.by === "agent_function" ? 64 : 30,
            },
          }),
          legend: {
            top: 0,
            left: 0,
            icon: "roundRect",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: tk.text, fontSize: 11, fontFamily: tk.mono },
          },
          tooltip: tooltip(tk, {
            trigger: "axis",
            axisPointer: {
              type: "shadow",
              shadowStyle: { color: tk.read("--qd-hover") },
            },
            formatter: (ps: { dataIndex: number }[]) => {
              const g = groups[ps[0]?.dataIndex ?? 0];
              if (!g) return "";
              return (
                tipHead(tk, L.value(d.by, g.value)) +
                g.cells
                  .map((c, i) =>
                    tipRow(
                      tk,
                      verColor(tk, i, d.versions.length),
                      c.version,
                      c.total ? `${fmtRate(c.pass_rate)} · ${grp(c.total)}${c.vs_prev_version_pp != null ? ` · ${c.vs_prev_version_pp > 0 ? "+" : ""}${c.vs_prev_version_pp.toFixed(1)}pp` : ""}` : "—",
                    ),
                  )
                  .join("")
              );
            },
          }),
          xAxis: axisX(
            tk,
            groups.map((g) => L.value(d.by, g.value)),
            {
              boundaryGap: true,
              axisLabel: {
                color: tk.muted,
                fontSize: 10.5,
                fontFamily: tk.font,
                interval: 0,
                rotate: d.by === "agent_function" ? 32 : 0,
              },
            },
          ),
          yAxis: axisY(tk, {
            min: 0,
            max: 100,
            axisLabel: {
              color: tk.muted,
              fontSize: 10,
              fontFamily: tk.mono,
              formatter: "{value}%",
            },
          }),
          series: d.versions.map((v, i) => ({
            type: "bar",
            name: v,
            barMaxWidth: 18,
            barGap: "12%",
            itemStyle: {
              color: verColor(tk, i, d.versions.length),
              borderRadius: [3, 3, 0, 0],
              borderColor: tk.surface,
              borderWidth: 1,
            },
            emphasis: { focus: "series" },
            data: groups.map((g) => g.cells[i]?.pass_rate ?? null),
          })),
        })
      }
    />
  );
}

function VersionTrend({ d }: { d: QualityVersions }) {
  const t = useT("quality");
  const rm = useReducedMotionSafe();
  const tr = d.trend;
  const floor = rateFloor(tr.series.flatMap((s) => s.pass_rate));
  return (
    <EChart
      className="qd-chart"
      ariaLabel={t("versions.trend")}
      option={(tk: ChartTokens) =>
        opt({
          ...baseOpt(tk, rm, {
            grid: { left: 44, right: 16, top: 34, bottom: 28 },
          }),
          legend: {
            top: 0,
            left: 0,
            icon: "roundRect",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: tk.text, fontSize: 11, fontFamily: tk.mono },
          },
          tooltip: tooltip(tk, {
            formatter: (ps: { dataIndex: number }[]) => {
              const i = ps[0]?.dataIndex ?? 0;
              return (
                tipHead(tk, bucketLabel(tr.t[i], tr.bucket)) +
                tr.series.map((s, k) => tipRow(tk, verColor(tk, k, d.versions.length), s.version, s.total[i] ? `${fmtRate(s.pass_rate[i])} · ${grp(s.total[i])}` : "—")).join("")
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
          series: tr.series.map((s, k) => ({
            type: "line",
            name: s.version,
            data: s.pass_rate,
            connectNulls: false,
            showSymbol: tr.t.length <= 31,
            symbolSize: 6,
            lineStyle: { width: 2, color: verColor(tk, k, d.versions.length) },
            itemStyle: {
              color: verColor(tk, k, d.versions.length),
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

function GroupTable({ d, f }: { d: QualityVersions; f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  return (
    <div className="tbl-wrap">
      <table className="t qd-tbl qd-gv">
        <thead>
          <tr>
            <th>{L.dim(d.by)}</th>
            {d.versions.map((v, i) => (
              <th key={v} className="num mono">
                <span className="qd-sw" style={{ background: verVar(i, d.versions.length) }} aria-hidden />
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.groups.map((g) => (
            <tr key={g.value}>
              <td>{L.value(d.by, g.value)}</td>
              {g.cells.map((c) => (
                <td key={c.version} className="num">
                  {c.total ? (
                    <Link className="qd-gv-c" href={drill({ [d.by]: g.value, [d.dim]: c.version }).href} title={`${t("drill.toResults")} · ${grp(c.total)}`}>
                      <span className="mono">{fmtRate(c.pass_rate)}</span>
                      {c.vs_prev_version_pp != null ? <Delta v={c.vs_prev_version_pp} /> : null}
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QualityVersionsView() {
  const t = useT("quality");
  const L = useQLabel();
  const rh = useRangeHref();
  const f = useQualityFilters();
  const [p, setP] = useQueryStates(P);
  const dim = (DIMS.includes(p.vdim as QualityVersionDim) ? p.vdim : "model_version") as QualityVersionDim;
  const by = (BYS.includes(p.by as QualityVersionBy) ? p.by : "division") as QualityVersionBy;
  const q = { ...f.query, dim, by };
  const res = useApi(["quality", "versions", q], () => qualityApi.versions(q), {
    revalidateOn: ["transition"],
    throttleMs: 5000,
  });
  const d = res.data && res.data.dim === dim && res.data.by === by ? res.data : undefined;
  // judge-model confound: pipeline versions present in the compared rows (direct when pipeline_version is the axis)
  const pq = { ...f.query, dim: "pipeline_version" as const, sort: "natural" as const };
  const pv = useApi(["quality", "breakdown", pq], () => qualityApi.breakdown(pq), { revalidateOn: ["transition"], throttleMs: 8000 });
  const judgeVersions = dim === "pipeline_version" ? (d?.versions ?? []) : (pv.data?.items ?? []).filter((x) => x.total > 0).map((x) => x.value);
  return (
    <div className="qd-view">
      <div className="qd-bar">
        <div className="seg" role="group" aria-label={t("versions.dim")}>
          {DIMS.map((x) => (
            <button key={x} type="button" aria-pressed={dim === x} onClick={() => setP({ vdim: x })}>
              {L.dim(x)}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={t("versions.by")}>
          {BYS.map((x) => (
            <button key={x} type="button" aria-pressed={by === x} onClick={() => setP({ by: x })}>
              {L.dim(x)}
            </button>
          ))}
        </div>
      </div>
      <p className="note qd-note qd-m2">
        <Info aria-hidden />
        <span>
          {t("versions.noSig")} <Link href={rh("/issues")}>{t("versions.noSigLink")}</Link>
        </span>
      </p>
      {d ? <JudgeCaveat versions={judgeVersions} mode={dim === "pipeline_version" ? "direct" : "mixed"} /> : null}
      <QState error={res.error} loading={!d} empty={!!d && !d.items.length}>
        {d ? (
          <>
            <Panel title={t("versions.table", { dim: L.dim(dim) })} sub={t("versions.tableSub")} right={<MixLegend />}>
              <DeltaTable d={d} f={f} />
            </Panel>
            <div className="qd-grid2">
              <Panel title={t("versions.byGroup", { by: L.dim(by) })} sub={t("versions.byGroupSub")}>
                {d.versions.length ? <GroupBars d={d} /> : null}
              </Panel>
              <Panel title={t("versions.trend")} sub={t("versions.trendSub")}>
                <VersionTrend d={d} />
              </Panel>
            </div>
            <Panel
              title={t("versions.groupTable", {
                by: L.dim(by),
                dim: L.dim(dim),
              })}
              sub={t("versions.groupTableSub")}
            >
              <GroupTable d={d} f={f} />
            </Panel>
          </>
        ) : null}
      </QState>
    </div>
  );
}
