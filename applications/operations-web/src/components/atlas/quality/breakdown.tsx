"use client";
/**
 * /quality/breakdown — 분해 / Breakdown: any row dim → table or cards of pass rate, FAILs, Δ (vs the previous
 * equal window), share of FAILs and a pass-rate trend sparkline. Rows drill down to /results.
 */
import clsx from "clsx";
import { LayoutGrid, Table2 } from "lucide-react";
import { motion } from "motion/react";
import { useT } from "@/i18n/client";
import { parseAsString, useApi, useQueryStates, qualityApi } from "@/lib/client";
import type { QualityBreakdown, QualityBreakdownItem, QualityDim } from "@/lib/types";
import { useReducedMotionSafe } from "../ui";
import { Delta, Drill, Panel, QState, Spark, useStatSub } from "./bits";
import { Q_DIMS, fmtRate, grp, useDrill, useQLabel, useQualityFilters, type QualityFiltersApi } from "./model";

const SORTS = ["fail_count", "pass_rate", "delta", "volume", "natural"] as const;
type Sort = (typeof SORTS)[number];
const P = {
  dim: parseAsString.withDefault("agent_function"),
  sort: parseAsString.withDefault("fail_count"),
  mode: parseAsString.withDefault("table"),
};

export function DimSelect({ value, onChange, label, exclude = [], id }: { value: QualityDim; onChange: (d: QualityDim) => void; label: string; exclude?: QualityDim[]; id?: string }) {
  const L = useQLabel();
  return (
    <label className="qd-field">
      <span>{label}</span>
      <select id={id} className="in" value={value} onChange={(e) => onChange(e.target.value as QualityDim)}>
        {Q_DIMS.filter((d) => !exclude.includes(d) || d === value).map((d) => (
          <option key={d} value={d}>
            {L.dim(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

function trendLabel(t: ReturnType<typeof useT<"quality">>, label: string, it: QualityBreakdownItem) {
  const vs = it.trend_rate.filter((v): v is number => v != null);
  return t("breakdown.sparkLabel", {
    v: label,
    first: fmtRate(vs[0] ?? null),
    last: fmtRate(vs[vs.length - 1] ?? null),
  });
}

function Table({ d, f }: { d: QualityBreakdown; f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  const reason = d.dim === "failure_reason";
  return (
    <div className="tbl-wrap">
      <table className="t qd-tbl qd-bd">
        <thead>
          <tr>
            <th>{L.dim(d.dim)}</th>
            <th className="num">{reason ? t("metric.rowsScope") : t("metric.total")}</th>
            <th className="num">{reason ? t("metric.codeRate") : t("metric.pass_rate")}</th>
            <th className="num">{t("metric.fail_count")}</th>
            <th className="num hide-sm">{t("metric.share")}</th>
            <th className="num">{t("metric.delta")}</th>
            <th className="num hide-sm">{t("metric.failDelta")}</th>
            <th className="hide-sm">{t("metric.trend")}</th>
            <th aria-label={t("drill.toResults")} />
          </tr>
        </thead>
        <tbody>
          {d.items.map((it) => {
            const label = L.value(d.dim, it.value);
            const rate = reason ? (it.total ? 100 - (it.pass_rate ?? 100) : null) : it.pass_rate;
            return (
              <tr key={it.value}>
                <td className="qd-bd-k">
                  <span title={it.value}>{label}</span>
                  {label !== it.value ? <span className="mono muted qd-code">{it.value}</span> : null}
                </td>
                <td className="num mono">{grp(it.total)}</td>
                <td className="num mono">
                  <span className="qd-cellbar" aria-hidden>
                    <i style={{ width: `${rate ?? 0}%` }} />
                  </span>
                  {fmtRate(rate)}
                </td>
                <td className="num mono">{grp(it.fail)}</td>
                <td className="num mono hide-sm">{it.share.toFixed(1)}%</td>
                <td className="num">{reason ? <Delta v={it.delta_pp == null ? null : -it.delta_pp} good="down" /> : <Delta v={it.delta_pp} />}</td>
                <td className="num hide-sm">
                  <Delta v={it.prev_total ? it.fail_delta : null} unit="count" good="down" />
                </td>
                <td className="hide-sm">
                  <Spark values={reason ? it.trend_rate.map((v) => (v == null ? null : 100 - v)) : it.trend_rate} label={trendLabel(t, label, it)} />
                </td>
                <td className="act">
                  <Drill
                    link={drill({
                      [d.dim]: it.value,
                      ...(reason ? { result: "FAIL" } : {}),
                    })}
                    label={t("drill.slice", { v: label })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cards({ d, f }: { d: QualityBreakdown; f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const drill = useDrill(f);
  const sub = useStatSub();
  const rm = useReducedMotionSafe();
  const reason = d.dim === "failure_reason";
  return (
    <ul className="qd-cards">
      {d.items.map((it, i) => {
        const label = L.value(d.dim, it.value);
        const rate = reason ? (it.total ? 100 - (it.pass_rate ?? 100) : null) : it.pass_rate;
        return (
          <motion.li
            key={it.value}
            initial={rm ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: rm ? 0 : 0.24,
              delay: rm ? 0 : Math.min(i, 12) * 0.025,
            }}
          >
            <Drill
              link={drill({
                [d.dim]: it.value,
                ...(reason ? { result: "FAIL" } : {}),
              })}
              className="qd-card"
              label={t("drill.slice", { v: label })}
            >
              <span className="qd-card-k" title={it.value}>
                {label}
              </span>
              <span className="qd-card-v mono">
                {fmtRate(rate)}
                <small>{reason ? t("metric.codeRate") : t("metric.pass_rate")}</small>
              </span>
              <span className="qd-card-d">
                {reason ? <Delta v={it.delta_pp == null ? null : -it.delta_pp} good="down" /> : <Delta v={it.delta_pp} />}
                <span className="mono muted">
                  {t("stat.failsShare", {
                    n: grp(it.fail),
                    share: it.share.toFixed(1),
                  })}
                </span>
              </span>
              <Spark values={reason ? it.trend_rate.map((v) => (v == null ? null : 100 - v)) : it.trend_rate} label={trendLabel(t, label, it)} w={220} h={30} />
              <span className="qd-card-s mono muted">{sub(it)}</span>
            </Drill>
          </motion.li>
        );
      })}
    </ul>
  );
}

export function QualityBreakdownView() {
  const t = useT("quality");
  const L = useQLabel();
  const f = useQualityFilters();
  const [p, setP] = useQueryStates(P);
  const dim = (Q_DIMS.includes(p.dim as QualityDim) ? p.dim : "agent_function") as QualityDim;
  const sort = ((SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort : "fail_count") as Sort;
  const mode = p.mode === "cards" ? "cards" : "table";
  const q = { ...f.query, dim, sort, limit: 200 };
  const res = useApi(["quality", "breakdown", q], () => qualityApi.breakdown(q), { revalidateOn: ["transition"], throttleMs: 5000 });
  const d = res.data && res.data.dim === dim ? res.data : undefined;
  return (
    <div className="qd-view">
      <Panel
        title={t("breakdown.title", { dim: L.dim(dim) })}
        sub={dim === "failure_reason" ? t("breakdown.reasonSub") : t("breakdown.sub")}
        right={
          <div className="qd-ctls">
            <DimSelect value={dim} onChange={(v) => setP({ dim: v })} label={t("breakdown.dim")} />
            <label className="qd-field">
              <span>{t("breakdown.sort")}</span>
              <select className="in" value={sort} onChange={(e) => setP({ sort: e.target.value })}>
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg" role="group" aria-label={t("breakdown.mode")}>
              <button type="button" aria-pressed={mode === "table"} onClick={() => setP({ mode: "table" })} title={t("breakdown.table")}>
                <Table2 aria-hidden className="qd-seg-i" />
                <span className="hide-sm">{t("breakdown.table")}</span>
              </button>
              <button type="button" aria-pressed={mode === "cards"} onClick={() => setP({ mode: "cards" })} title={t("breakdown.cards")}>
                <LayoutGrid aria-hidden className="qd-seg-i" />
                <span className="hide-sm">{t("breakdown.cards")}</span>
              </button>
            </div>
          </div>
        }
      >
        <QState error={res.error} loading={!d} empty={!!d && !d.items.length}>
          {d ? (
            <>
              <p className={clsx("qd-meta mono muted")}>
                {t("breakdown.meta", {
                  n: d.total,
                  rows: grp(d.totals.total),
                  fails: grp(d.totals.fail),
                  rate: fmtRate(d.totals.pass_rate),
                })}
                {d.truncated ? ` · ${t("breakdown.truncated", { n: d.items.length })}` : ""}
              </p>
              {mode === "table" ? <Table d={d} f={f} /> : <Cards d={d} f={f} />}
            </>
          ) : null}
        </QState>
      </Panel>
    </div>
  );
}
