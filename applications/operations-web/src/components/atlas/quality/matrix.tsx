"use client";
/**
 * /quality/matrix — 매트릭스 / Matrix: row dim × row dim heatmap of pass_rate (diverging around the overall
 * pass rate), fail_count (sequential) or delta (diverging around 0 pp). Cells drill down to /results.
 */
import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { useT } from "@/i18n/client";
import { parseAsString, useApi, useQueryStates, qualityApi } from "@/lib/client";
import type { QualityDim, QualityMatrix, QualityMatrixCell, QualityMatrixMetric } from "@/lib/types";
import { Delta, Panel, QState, divStyle, seqStyle } from "./bits";
import { DimSelect } from "./breakdown";
import { Q_DIMS, fmtPp, fmtRate, grp, useDrill, useQLabel, useQualityFilters, type QualityFiltersApi } from "./model";

const METRICS: QualityMatrixMetric[] = ["pass_rate", "fail_count", "delta"];
const P = {
  x: parseAsString.withDefault("division"),
  y: parseAsString.withDefault("agent_function"),
  metric: parseAsString.withDefault("pass_rate"),
};

/** cells with fewer rows than this do not stretch the color scale (they are clamped and drawn faded) */
const MIN_N = 10;

function scaleFor(d: QualityMatrix) {
  const solid = d.items.filter((c) => c.total >= MIN_N && c.value != null);
  const vals = (solid.length ? solid : d.items).map((c) => c.value).filter((v): v is number => v != null);
  if (d.metric === "fail_count") {
    const hi = Math.max(1, ...vals);
    return {
      kind: "seq" as const,
      lo: 0,
      hi,
      style: (v: number | null) => seqStyle(v, 0, hi),
    };
  }
  const all = d.y_totals.reduce((a, s) => ({ t: a.t + s.total, f: a.f + s.fail }), { t: 0, f: 0 });
  const mid = d.metric === "delta" ? 0 : all.t ? ((all.t - all.f) / all.t) * 100 : 0;
  let span = Math.max(1, ...vals.map((v) => Math.abs(v - mid)));
  if (d.metric === "pass_rate") span = Math.min(span, Math.max(1, mid, 100 - mid));
  const lo = d.metric === "pass_rate" ? Math.max(0, mid - span) : mid - span;
  const hi = d.metric === "pass_rate" ? Math.min(100, mid + span) : mid + span;
  return {
    kind: "div" as const,
    lo,
    hi,
    mid,
    style: (v: number | null) => divStyle(v, mid, span),
  };
}

function fmtMetric(m: QualityMatrixMetric, v: number | null) {
  return m === "pass_rate" ? fmtRate(v) : m === "delta" ? fmtPp(v) : v == null ? "—" : grp(v);
}

function Legend({ d, sc }: { d: QualityMatrix; sc: ReturnType<typeof scaleFor> }) {
  const t = useT("quality");
  const stops = Array.from({ length: 7 }, (_, i) => sc.lo + ((sc.hi - sc.lo) * i) / 6);
  return (
    <div className="qd-scale" aria-label={t("matrix.legend")}>
      <span className="qd-scale-k mono">{t(`metric.${d.metric}`)}</span>
      <span className="qd-scale-bar" aria-hidden>
        {stops.map((s, i) => (
          <i key={i} style={sc.style(s)} />
        ))}
      </span>
      <span className="qd-scale-ends mono">
        <span>{fmtMetric(d.metric, Math.round(sc.lo * 10) / 10)}</span>
        {sc.kind === "div" ? <span>{d.metric === "delta" ? "0pp" : t("matrix.mid", { v: fmtRate(sc.mid) })}</span> : null}
        <span>{fmtMetric(d.metric, Math.round(sc.hi * 10) / 10)}</span>
      </span>
      <span className="qd-scale-n muted">
        {sc.kind === "div" ? (d.metric === "delta" ? t("matrix.divDelta") : t("matrix.divRate")) : t("matrix.seq")} · {t("matrix.lowN", { n: MIN_N })}
      </span>
    </div>
  );
}

function Grid({ d, f }: { d: QualityMatrix; f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  const sc = scaleFor(d);
  const cell = new Map<string, QualityMatrixCell>(d.items.map((c) => [c.x + "\u0000" + c.y, c]));
  const reasonAxis = d.x === "failure_reason" || d.y === "failure_reason";
  const tip = (c: QualityMatrixCell) =>
    [
      `${L.dim(d.y)}: ${L.value(d.y, c.y)}`,
      `${L.dim(d.x)}: ${L.value(d.x, c.x)}`,
      `${t("metric.total")}: ${grp(c.total)} · ${t("metric.fail_count")}: ${grp(c.fail)}`,
      `${t("metric.pass_rate")}: ${fmtRate(c.pass_rate)} (${t("delta.prevShort")} ${fmtRate(c.prev_pass_rate)})`,
      `${t("metric.delta")}: ${fmtPp(c.delta_pp)}`,
    ].join("\n");
  return (
    <>
      <Legend d={d} sc={sc} />
      <div className="qd-hm-wrap" tabIndex={0} aria-label={t("matrix.title")}>
        <table className="qd-hm">
          <thead>
            <tr>
              <th className="qd-hm-corner">
                <span className="mono muted">
                  {L.dim(d.y)} ↓ · {L.dim(d.x)} →
                </span>
              </th>
              {d.x_values.map((x, i) => (
                <th key={x} scope="col" title={x}>
                  <span className="qd-hm-xl">{L.value(d.x, x)}</span>
                  <span className="mono muted qd-hm-tot">{fmtRate(d.x_totals[i]?.pass_rate)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.y_values.map((y, yi) => (
              <tr key={y}>
                <th scope="row" title={y}>
                  <span className="qd-hm-yl">{L.value(d.y, y)}</span>
                  <span className="mono muted qd-hm-tot">{fmtRate(d.y_totals[yi]?.pass_rate)}</span>
                </th>
                {d.x_values.map((x) => {
                  const c = cell.get(x + "\u0000" + y);
                  if (!c || !c.total)
                    return (
                      <td key={x} className="qd-hm-na" title={t("matrix.noRows")}>
                        ·
                      </td>
                    );
                  const link = drill({
                    [d.x]: x,
                    [d.y]: y,
                    ...(d.metric === "fail_count" || reasonAxis ? { result: "FAIL" } : {}),
                  });
                  return (
                    <td key={x} style={sc.style(c.value)} className={c.total < MIN_N ? "qd-hm-low" : undefined}>
                      <Link
                        href={link.href}
                        title={tip(c) + (c.total < MIN_N ? "\n" + t("matrix.lowN", { n: MIN_N }) : "") + "\n" + t("drill.toResults")}
                        className="qd-hm-c"
                      >
                        <span className="mono">{fmtMetric(d.metric, c.value)}</span>
                        {d.metric !== "fail_count" ? <span className="qd-hm-n mono">{grp(c.total)}</span> : null}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.folded.x || d.folded.y ? <p className="qd-meta muted">{t("matrix.folded", { x: d.folded.x, y: d.folded.y })}</p> : null}
    </>
  );
}

export function QualityMatrixView() {
  const t = useT("quality");
  const L = useQLabel();
  const f = useQualityFilters();
  const [p, setP] = useQueryStates(P);
  const x = (Q_DIMS.includes(p.x as QualityDim) ? p.x : "division") as QualityDim;
  let y = (Q_DIMS.includes(p.y as QualityDim) ? p.y : "agent_function") as QualityDim;
  if (y === x) y = x === "agent_function" ? "division" : "agent_function";
  const metric = (METRICS.includes(p.metric as QualityMatrixMetric) ? p.metric : "pass_rate") as QualityMatrixMetric;
  const q = { ...f.query, x, y, metric };
  const res = useApi(["quality", "matrix", q], () => qualityApi.matrix(q), {
    revalidateOn: ["transition"],
    throttleMs: 5000,
  });
  const d = res.data && res.data.x === x && res.data.y === y && res.data.metric === metric ? res.data : undefined;
  const allNullDelta = d && metric === "delta" && d.items.every((c) => c.value == null);
  return (
    <div className="qd-view">
      <Panel
        title={t("matrix.title")}
        sub={t("matrix.sub", { y: L.dim(y), x: L.dim(x) })}
        right={
          <div className="qd-ctls">
            <DimSelect value={y} onChange={(v) => setP({ y: v })} label={t("matrix.rows")} exclude={[x]} />
            <button type="button" className="btn sm icon qd-swap" onClick={() => setP({ x: y, y: x })} title={t("matrix.swap")} aria-label={t("matrix.swap")}>
              <ArrowLeftRight aria-hidden />
            </button>
            <DimSelect value={x} onChange={(v) => setP({ x: v })} label={t("matrix.cols")} exclude={[y]} />
            <div className="seg" role="group" aria-label={t("matrix.metric")}>
              {METRICS.map((m) => (
                <button key={m} type="button" aria-pressed={metric === m} onClick={() => setP({ metric: m })}>
                  {t(`metricShort.${m}`)}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <QState error={res.error} loading={!d} empty={!!d && !d.items.some((c) => c.total)}>
          {d ? (
            <>
              {allNullDelta ? <p className="note qd-note">{t("delta.noPrevCells")}</p> : null}
              <Grid d={d} f={f} />
            </>
          ) : null}
        </QState>
      </Panel>
      {d ? <AxisNote d={d} /> : null}
    </div>
  );
}

function AxisNote({ d }: { d: QualityMatrix }) {
  const t = useT("quality");
  const L = useQLabel();
  const worst = [...d.items].filter((c) => c.total >= 20 && c.pass_rate != null).sort((a, b) => (a.pass_rate ?? 0) - (b.pass_rate ?? 0))[0];
  if (!worst) return null;
  return (
    <p className="qd-meta muted">
      {t("matrix.lowest", {
        y: L.value(d.y, worst.y),
        x: L.value(d.x, worst.x),
        rate: fmtRate(worst.pass_rate),
        n: grp(worst.total),
      })}{" "}
      {worst.delta_pp != null ? <Delta v={worst.delta_pp} /> : null}
    </p>
  );
}
