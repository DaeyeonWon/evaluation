"use client";
/** Signal Lab — metric tiles (R5): headline numbers with trend sparklines and the severity ladder. */
import clsx from "clsx";
import { AlertOctagon, Activity, Flame, GitCompareArrows, Globe2, Sparkles, Gauge } from "lucide-react";
import type { ReactNode } from "react";
import { useTween } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { IssueSummary } from "@/lib/types";
import { useIssueFormat, type IssueFiltersApi } from "../issues-shared";
import { SEVERITIES, deltaDir, sparkPath } from "./lab";

function Spark({ vals, label, tone }: { vals: number[]; label: string; tone: string }) {
  const w = 120;
  const h = 30;
  const pts = sparkPath(vals, w, h);
  if (!pts) return <div className="lab-spark" />;
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg className="lab-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ ["--tc" as string]: tone }}>
      <title>{label}</title>
      <polyline points={`1.5,${h} ${pts} ${w - 1.5},${h}`} className="area" />
      <polyline points={pts} className="line" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" className="dot" />
    </svg>
  );
}

function Tile({ k, icon, v, sub, tone, spark, onClick, active, delta }: { k: string; icon: ReactNode; v: ReactNode; sub?: ReactNode; tone?: string; spark?: ReactNode; onClick?: () => void; active?: boolean; delta?: ReactNode }) {
  const body = (
    <>
      <div className="lab-tile-k">
        {icon}
        <span>{k}</span>
      </div>
      <div className="lab-tile-v">
        {v}
        {delta}
      </div>
      {sub ? <div className="lab-tile-s">{sub}</div> : null}
      {spark}
    </>
  );
  const style = tone ? { ["--tc" as string]: tone } : undefined;
  return onClick ? (
    <button type="button" className={clsx("lab-tile", active && "on")} data-tone={tone ? "" : undefined} style={style} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className="lab-tile" data-tone={tone ? "" : undefined} style={style}>
      {body}
    </div>
  );
}

const Num = ({ n, d = 0 }: { n: number; d?: number }) => {
  const v = useTween(n, { duration: 700, decimals: d });
  const fm = useFmt();
  return <>{d ? v.toFixed(d) : fm.number(v)}</>;
};

export function MetricTiles({ sum, f }: { sum: IssueSummary; f: IssueFiltersApi }) {
  const t = useT("issuesC");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const k = sum.kpis;
  const pts = sum.trend.points;
  const bucket = s(`bucket.${sum.trend.bucket}`);
  const dd = deltaDir(k.fail_rate_delta);
  const totalIss = Math.max(1, k.issues);
  const sevOn = (v: string) => f.values.severity.length === 1 && f.values.severity[0] === v;
  const onlyToggle = (col: "severity" | "novelty" | "severity_class", v: string) => (f.values[col].length === 1 && f.values[col][0] === v ? f.only(col, null) : f.only(col, v));

  return (
    <div className="lab-tiles">
      <Tile
        k={s("kpi.failRate")}
        icon={<Activity aria-hidden />}
        v={
          <>
            <Num n={k.fail_rate ?? 0} d={1} />
            <small>%</small>
          </>
        }
        delta={
          k.fail_rate_delta != null ? (
            <span className="lab-delta" data-dir={dd}>
              {dd === "up" ? "▲" : dd === "down" ? "▼" : "■"} {fx.pp(k.fail_rate_delta)}
            </span>
          ) : null
        }
        sub={t("tiles.vsBaseline", { rate: fx.pct(k.baseline_fail_rate) })}
        spark={<Spark vals={pts.map((p) => p.fail_rate ?? 0)} label={`${s("kpi.failRate")} · ${bucket}`} tone="var(--issc-seq)" />}
      />
      <Tile
        k={s("kpi.fails")}
        icon={<Gauge aria-hidden />}
        v={<Num n={k.fails} />}
        sub={t("tiles.ofUtterances", { n: fm.number(k.utterances) })}
        spark={<Spark vals={pts.map((p) => p.fails)} label={`${s("kpi.fails")} · ${bucket}`} tone="var(--ink-3)" />}
      />
      <Tile
        k={s("kpi.criticalOpen")}
        icon={<Flame aria-hidden />}
        tone="var(--sev-p0)"
        v={<Num n={k.critical_open} />}
        sub={t("tiles.criticalSub", { p0: k.by_severity.P0, p1: k.by_severity.P1 })}
        spark={<Spark vals={pts.map((p) => p.critical_fails)} label={t("tiles.criticalSpark", { bucket })} tone="var(--sev-p0)" />}
        onClick={() => (f.values.severity.join() === "P0,P1" ? f.set({ severity: [] }) : f.set({ severity: ["P0", "P1"] }))}
        active={f.values.severity.join() === "P0,P1"}
      />
      <Tile
        k={s("kpi.newPatterns")}
        icon={<Sparkles aria-hidden />}
        tone="var(--iss-new)"
        v={<Num n={k.new_patterns} />}
        sub={t("tiles.newIssuesSub", { n: k.new_issues })}
        spark={<Spark vals={pts.map((p) => p.new_pattern_rows)} label={t("tiles.newSpark", { bucket })} tone="var(--iss-new)" />}
        onClick={() => onlyToggle("novelty", "new")}
        active={f.values.novelty.length === 1 && f.values.novelty[0] === "new"}
      />
      <Tile
        k={s("kpi.safety")}
        icon={<AlertOctagon aria-hidden />}
        tone="var(--cls-safety)"
        v={<Num n={k.safety_issues} />}
        sub={t("tiles.regressionsSub", { n: k.regressions })}
        onClick={() => onlyToggle("severity_class", "safety")}
        active={f.values.severity_class.length === 1 && f.values.severity_class[0] === "safety"}
      />
      <Tile
        k={s("kpi.markets")}
        icon={<Globe2 aria-hidden />}
        v={
          <>
            <Num n={k.markets_affected} />
            <small>/ 6</small>
          </>
        }
        sub={t("tiles.maxScoreSub", { max: fx.score(k.max_score), avg: fx.score(k.avg_score) })}
      />
      <div className="lab-tile lab-ladder">
        <div className="lab-tile-k">
          <GitCompareArrows aria-hidden />
          <span>{t("tiles.ladder", { n: fm.number(k.issues) })}</span>
        </div>
        <div className="lab-ladder-bar" role="group" aria-label={t("tiles.ladder", { n: k.issues })}>
          {SEVERITIES.map((sv) => {
            const n = k.by_severity[sv];
            if (!n) return null;
            return (
              <button
                key={sv}
                type="button"
                className={clsx("seg-" + sv.toLowerCase(), sevOn(sv) && "on")}
                style={{ flexGrow: Math.max(n / totalIss, 0.06) }}
                title={`${sv} · ${n} · ${fx.severityHelp(sv)}`}
                aria-pressed={sevOn(sv)}
                onClick={() => onlyToggle("severity", sv)}
              />
            );
          })}
        </div>
        <ul className="lab-ladder-legend">
          {SEVERITIES.map((sv) => {
            const row = sum.severity_distribution.find((x) => x.severity === sv);
            return (
              <li key={sv}>
                <span className="iss-sev" data-sev={sv}>
                  {sv}
                </span>
                <b className="mono">{k.by_severity[sv]}</b>
                <span className="muted mono">{row ? t("tiles.openOf", { open: (row.by_status.NEW ?? 0) + (row.by_status.TRIAGED ?? 0) + (row.by_status.TICKETED ?? 0) }) : ""}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
