"use client";
/**
 * Triage Deck — SVG marks: the segmented criticality ring (one arc per factor, arc length ∝ weight,
 * fill ∝ value) and the hover sparkline. Pure SVG so 25+ cards stay cheap.
 */
import clsx from "clsx";
import { useId, useState, type CSSProperties } from "react";
import type { IssueFactor, IssueFactorKey } from "@/lib/types";

export const FACTOR_ORDER: IssueFactorKey[] = ["volume", "severity", "trend", "regression", "reach", "novelty"];
export const factorVar = (k: IssueFactorKey) => `var(--fa-${k})`;

const TAU = Math.PI * 2;
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Segmented ring: 6 tracks (weight share of the circle), each filled to its normalized value. */
export function Gauge({
  score,
  factors,
  size = 92,
  stroke = 9,
  label,
  sev,
  focus,
  onFocus,
}: {
  score: number;
  factors: IssueFactor[];
  size?: number;
  stroke?: number;
  label: string;
  sev: string;
  focus?: IssueFactorKey | null;
  onFocus?: (k: IssueFactorKey | null) => void;
}) {
  const c = size / 2;
  const r = c - stroke / 2 - 4;
  const by = new Map(factors.map((f) => [f.key, f]));
  const total = FACTOR_ORDER.reduce((s, k) => s + (by.get(k)?.weight ?? 0), 0) || 100;
  const gap = 0.05;
  const starts = FACTOR_ORDER.map((_, n) => FACTOR_ORDER.slice(0, n).reduce((acc, k) => acc + ((by.get(k)?.weight ?? 0) / total) * TAU, 0));
  const segs = FACTOR_ORDER.map((k, n) => {
    const f = by.get(k);
    const span = ((f?.weight ?? 0) / total) * TAU;
    const a0 = starts[n] + gap / 2;
    const a1 = starts[n] + span - gap / 2;
    const v = Math.max(0, Math.min(1, f?.value ?? 0));
    return { k, a0, a1, fill: v > 0.004 ? a0 + (a1 - a0) * v : null };
  });
  // 40 blueprint ticks around the outside
  const ticks = Array.from({ length: 40 }, (_, i) => {
    const t = (i / 40) * TAU;
    const r0 = c - 2.5;
    const r1 = i % 5 === 0 ? c - 0.2 : c - 1.4;
    return `M${(c + r0 * Math.sin(t)).toFixed(2)} ${(c - r0 * Math.cos(t)).toFixed(2)}L${(c + r1 * Math.sin(t)).toFixed(2)} ${(c - r1 * Math.cos(t)).toFixed(2)}`;
  }).join("");
  return (
    <svg className="ia-gauge" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label} data-sev={sev}>
      <path d={ticks} className="ia-g-ticks" />
      {segs.map((s) => (
        <g
          key={s.k}
          className={clsx("ia-g-seg", focus && focus !== s.k && "dim")}
          style={{ ["--fc" as string]: factorVar(s.k) } as CSSProperties}
          onMouseEnter={onFocus ? () => onFocus(s.k) : undefined}
          onMouseLeave={onFocus ? () => onFocus(null) : undefined}
        >
          <path d={arc(c, c, r, s.a0, s.a1)} className="ia-g-track" strokeWidth={stroke} />
          {s.fill != null ? <path d={arc(c, c, r, s.a0, s.fill)} className="ia-g-fill" strokeWidth={stroke} pathLength={1} /> : null}
        </g>
      ))}
      <text x={c} y={c + size * 0.07} textAnchor="middle" className="ia-g-num" style={{ fontSize: size * 0.3 }}>
        {Math.round(score)}
      </text>
      <text x={c} y={c + size * 0.24} textAnchor="middle" className="ia-g-unit" style={{ fontSize: Math.max(7.5, size * 0.085) }}>
        /100
      </text>
    </svg>
  );
}

/** Sparkline with hover readout. `mark` = index to highlight (the spike); `labels` for the readout. */
export function Spark({
  values,
  labels,
  mark,
  height = 34,
  tone = "var(--ink-2)",
  fill = true,
  ariaLabel,
  fmtValue = (n) => String(n),
  className,
}: {
  values: (number | null)[];
  labels?: string[];
  mark?: number | null;
  height?: number;
  tone?: string;
  fill?: boolean;
  ariaLabel: string;
  fmtValue?: (n: number) => string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 200;
  const H = height;
  const n = values.length;
  const nums = values.map((v) => (v == null ? 0 : v));
  const max = Math.max(1, ...nums);
  const x = (i: number) => (n <= 1 ? W / 2 : 2 + (i / (n - 1)) * (W - 4));
  const y = (v: number) => H - 3 - (v / max) * (H - 8);
  const line = nums.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`;
  const hi = hover ?? null;
  return (
    <div className={clsx("ia-spark", className)} style={{ ["--sc" as string]: tone } as CSSProperties}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - b.left) / b.width) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--sc)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--sc)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {n > 1 ? (
          <>
            {fill ? <path d={area} fill={`url(#g${id})`} /> : null}
            <path d={line} className="ia-sp-line" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
        {mark != null && mark >= 0 && n > 1 ? <line x1={x(mark)} x2={x(mark)} y1={0} y2={H} className="ia-sp-mark" vectorEffect="non-scaling-stroke" /> : null}
        {hi != null ? <line x1={x(hi)} x2={x(hi)} y1={0} y2={H} className="ia-sp-hair" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {mark != null && mark >= 0 && n > 1 ? <i className="ia-sp-dot spike" style={{ left: `${(x(mark) / W) * 100}%`, top: `${(y(nums[mark]) / H) * 100}%` }} /> : null}
      {hi != null ? (
        <>
          <i className="ia-sp-dot" style={{ left: `${(x(hi) / W) * 100}%`, top: `${(y(nums[hi]) / H) * 100}%` }} />
          <span className="ia-sp-tip" style={{ left: `${(x(hi) / W) * 100}%` }} data-edge={hi > n * 0.6 ? "r" : hi < n * 0.4 ? "l" : "c"}>
            {labels?.[hi] ? <small>{labels[hi]}</small> : null}
            <b>{values[hi] == null ? "—" : fmtValue(values[hi] as number)}</b>
          </span>
        </>
      ) : null}
    </div>
  );
}

/** index of the max value (spike), or null when everything is 0 */
export function argmax(xs: number[]): number | null {
  let bi = -1;
  let bv = 0;
  xs.forEach((v, i) => {
    if (v > bv) {
      bv = v;
      bi = i;
    }
  });
  return bi < 0 ? null : bi;
}
