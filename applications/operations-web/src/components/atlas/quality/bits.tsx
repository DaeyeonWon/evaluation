"use client";
/**
 * Quality dashboard — small shared pieces: Δ readouts, KPI tiles, drill-down links, query states, sparkline,
 * and the color scales (categorical failure codes / versions, sequential, diverging) read from atlas-quality.css.
 */
import clsx from "clsx";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useT } from "@/i18n/client";
import type { ChartTokens } from "@/components/shared";
import type { QualityStat } from "@/lib/types";
import { Empty, Skeleton } from "../ui";
import { QueryError } from "../analytics/kit";
import { FAILURE_REASONS, fmtPp, fmtSigned, grp, type DrillLink } from "./model";

// ───────────────────────────────────────── color ──
/** categorical slot of a failure code (fixed order — color follows the code on every view) */
export const reasonSlot = (code: string) => Math.max(0, FAILURE_REASONS.indexOf(code as (typeof FAILURE_REASONS)[number])) + 1;
export const reasonVar = (code: string) => `var(--qd-c${reasonSlot(code)})`;
export const slotColor = (t: ChartTokens, i: number) => t.read(`--qd-c${(i % 8) + 1}`);
export const reasonColor = (t: ChartTokens, code: string) => t.read(`--qd-c${reasonSlot(code)}`);

/** ordinal version ramp (one hue, old → new = light → dark): step 1..4 for version i of n */
export const verStep = (i: number, n: number) => (n <= 1 ? 4 : Math.min(4, Math.round((i * 3) / Math.max(1, Math.min(n, 4) - 1)) + 1));
export const verVar = (i: number, n: number) => `var(--qd-v${verStep(i, n)})`;
export const verColor = (t: ChartTokens, i: number, n: number) => t.read(`--qd-v${verStep(i, n)}`);

/** sequential (one hue, light → dark) cell background for v in [lo, hi] */
export function seqStyle(v: number | null, lo: number, hi: number): CSSProperties {
  if (v == null) return {};
  const k = hi > lo ? (v - lo) / (hi - lo) : 1;
  const p = Math.round(8 + k * 92);
  return {
    background: `color-mix(in oklab, var(--qd-seq-hi) ${p}%, var(--qd-seq-lo))`,
    color: p > 55 ? "var(--qd-on-strong)" : "var(--ink)",
  };
}
/** diverging (neg arm · neutral mid · pos arm) cell background, symmetric around `mid` */
export function divStyle(v: number | null, mid: number, span: number): CSSProperties {
  if (v == null) return {};
  const k = span > 0 ? Math.max(-1, Math.min(1, (v - mid) / span)) : 0;
  const p = Math.round(Math.abs(k) * 100);
  const pole = k >= 0 ? "var(--qd-div-pos)" : "var(--qd-div-neg)";
  return {
    background: `color-mix(in oklab, ${pole} ${p}%, var(--qd-div-mid))`,
    color: p > 55 ? "var(--qd-on-strong)" : "var(--ink)",
  };
}

// ───────────────────────────────────────── Δ ──
/**
 * Δ readout with an arrow icon + sign (never color alone). `good` = which direction is an improvement:
 * "up" for pass rates / judge score, "down" for FAIL counts / latency.
 */
export function Delta({
  v,
  unit = "pp",
  good = "up",
  title,
  className,
}: {
  v: number | null | undefined;
  unit?: "pp" | "count" | "ms" | "score";
  good?: "up" | "down" | "none";
  title?: string;
  className?: string;
}) {
  const t = useT("quality");
  if (v == null) {
    return (
      <span className={clsx("qd-delta", className)} data-dir="na" title={title ?? t("delta.na")}>
        —
      </span>
    );
  }
  const eps = unit === "pp" ? 0.05 : unit === "score" ? 0.0005 : 0.5;
  const dir = v > eps ? "up" : v < -eps ? "down" : "flat";
  const tone = dir === "flat" || good === "none" ? "flat" : dir === good ? "good" : "bad";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const text = unit === "pp" ? fmtPp(v) : unit === "count" ? fmtSigned(v) : unit === "ms" ? `${fmtSigned(Math.round(v))}ms` : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(3)}`;
  return (
    <span className={clsx("qd-delta", className)} data-dir={dir} data-tone={tone} title={title}>
      <Icon aria-hidden />
      {text}
    </span>
  );
}

export const deltaOf = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a - b);

// ───────────────────────────────────────── KPI ──
export function Kpi({ k, v, unit, sub, delta, href, title }: { k: ReactNode; v: ReactNode; unit?: string; sub?: ReactNode; delta?: ReactNode; href?: string; title?: string }) {
  const body = (
    <>
      <span className="qd-kpi-k">{k}</span>
      <span className="qd-kpi-v">
        {v}
        {unit ? <small>{unit}</small> : null}
      </span>
      <span className="qd-kpi-s">
        {delta}
        {sub ? <span className="muted">{sub}</span> : null}
      </span>
    </>
  );
  return href ? (
    <Link className="qd-kpi link" href={href} title={title}>
      {body}
    </Link>
  ) : (
    <div className="qd-kpi" title={title}>
      {body}
    </div>
  );
}

// ───────────────────────────────────────── drill-down ──
export function Drill({ link, children, className, label }: { link: DrillLink; children?: ReactNode; className?: string; label?: string }) {
  const t = useT("quality");
  const title = label ?? t("drill.toResults");
  return (
    <Link className={clsx("qd-drill", className)} href={link.href} title={title} aria-label={children ? undefined : title}>
      {children ?? <ExternalLink aria-hidden />}
      {children ? <ArrowRight aria-hidden className="qd-drill-arrow" /> : null}
    </Link>
  );
}

// ───────────────────────────────────────── panels / states ──
export function Panel({ title, sub, right, children, className, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={clsx("plate qd-panel", className)} id={id}>
      <header>
        <div className="qd-panel-t">
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </div>
        {right ? <div className="qd-panel-r">{right}</div> : null}
      </header>
      <div className="body">{children}</div>
    </section>
  );
}

export function QState({ error, loading, empty, rows = 5, children }: { error?: unknown; loading?: boolean; empty?: boolean; rows?: number; children: ReactNode }) {
  const t = useT("quality");
  if (error) return <QueryError error={error} />;
  if (loading) return <Skeleton rows={rows} />;
  if (empty) return <Empty title={t("state.empty")}>{t("state.emptyHint")}</Empty>;
  return <>{children}</>;
}

/** pass-rate sparkline (single series → no legend); gaps where a bucket has no rows */
export function Spark({ values, label, w = 96, h = 24 }: { values: (number | null)[]; label: string; w?: number; h?: number }) {
  const pts = values.map((v, i) => (v == null ? null : ([values.length > 1 ? (i / (values.length - 1)) * (w - 4) + 2 : w / 2, v] as const)));
  const vs = values.filter((v): v is number => v != null);
  if (!vs.length) return <span className="qd-spark-na muted">—</span>;
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const y = (v: number) => (hi > lo ? h - 3 - ((v - lo) / (hi - lo)) * (h - 6) : h / 2);
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${y(p[1]).toFixed(1)}`;
    pen = true;
  }
  const last = [...pts].reverse().find(Boolean);
  return (
    <svg className="qd-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={d} fill="none" />
      {last ? <circle cx={last[0]} cy={y(last[1])} r={2.5} /> : null}
    </svg>
  );
}

/** "n rows · prev m" sub line for a stat */
export function useStatSub() {
  const t = useT("quality");
  return (s: Pick<QualityStat, "total" | "prev_total">) => t("stat.rows", { total: grp(s.total), prev: grp(s.prev_total) });
}
