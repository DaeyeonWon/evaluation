"use client";
/** 분해 보기 marks: impact (severity) stacked bar, Δ-vs-baseline readout and the FAIL-rate sparkline. Pure SVG/HTML. */
import clsx from "clsx";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useId, useState, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import type { IssueSeverity } from "@/lib/types";
import { useIssueFormat } from "../../issues-shared";
import { SEVERITIES } from "./state";

/** |Δ| below this (pp) reads as flat */
export const FLAT_PP = 0.5;
export const deltaDir = (d: number | null | undefined) => (d == null ? "na" : d >= FLAT_PP ? "up" : d <= -FLAT_PP ? "down" : "flat");

/** issues per impact level P0–P3 as one stacked bar (2px gaps) + a P0…P3 count legend */
export function SevBar({ by, legend = true, className }: { by: Record<IssueSeverity, number>; legend?: boolean; className?: string }) {
  const s = useT("issues");
  const total = SEVERITIES.reduce((n, k) => n + (by[k] ?? 0), 0);
  const title = SEVERITIES.map((k) => `${k} ${s.dynamic(`impactLevel.${k}`, undefined, k)} ${by[k] ?? 0}`).join(" · ");
  return (
    <div className={clsx("cat-sev", className)}>
      <div className="cat-sev-bar" role="img" aria-label={title} title={title}>
        {total === 0 ? <i className="cat-sev-empty" /> : null}
        {SEVERITIES.map((k) => (by[k] ? <i key={k} data-sev={k} style={{ flexGrow: by[k] }} /> : null))}
      </div>
      {legend ? (
        <ul className="cat-sev-legend" aria-hidden="true">
          {SEVERITIES.map((k) => (
            <li key={k} data-sev={k} data-zero={!by[k] || undefined}>
              <i />
              <span>{k}</span>
              <b>{by[k] ?? 0}</b>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Δ vs baseline with arrow + sign; up (worse) = critical tone, down = success tone, flat = muted */
export function Delta({ value, className }: { value: number | null | undefined; className?: string }) {
  const fx = useIssueFormat();
  const dir = deltaDir(value);
  const Ico = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span className={clsx("cat-delta", className)} data-dir={dir}>
      {dir === "na" ? null : <Ico aria-hidden="true" />}
      {fx.pp(value)}
    </span>
  );
}

/** FAIL-rate sparkline with a hover readout (null buckets = gaps drawn at 0, read out as —) */
export function Spark({ values, labels, ariaLabel, fmt, height = 36 }: { values: (number | null)[]; labels: string[]; ariaLabel: string; fmt: (n: number | null) => string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const [hi, setHi] = useState<number | null>(null);
  const W = 200;
  const H = height;
  const n = values.length;
  const nums = values.map((v) => v ?? 0);
  const max = Math.max(1, ...nums);
  const x = (i: number) => (n <= 1 ? W / 2 : 2 + (i / (n - 1)) * (W - 4));
  const y = (v: number) => H - 3 - (v / max) * (H - 8);
  const line = nums.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`;
  const last = n - 1;
  return (
    <div className="cat-spark">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          setHi(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1)))));
        }}
        onMouseLeave={() => setHi(null)}
      >
        <defs>
          <linearGradient id={`cg${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {n > 1 ? (
          <>
            <path d={area} fill={`url(#cg${id})`} />
            <path d={line} className="cat-sp-line" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
        {hi != null ? <line x1={x(hi)} x2={x(hi)} y1={0} y2={H} className="cat-sp-hair" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {n > 1 ? <i className="cat-sp-dot end" style={{ left: `${(x(last) / W) * 100}%`, top: `${(y(nums[last]) / H) * 100}%` }} /> : null}
      {hi != null ? (
        <>
          <i className="cat-sp-dot" style={{ left: `${(x(hi) / W) * 100}%`, top: `${(y(nums[hi]) / H) * 100}%` }} />
          <span className="cat-sp-tip" style={{ left: `${(x(hi) / W) * 100}%` } as CSSProperties} data-edge={hi > n * 0.6 ? "r" : hi < n * 0.4 ? "l" : "c"}>
            <small>{labels[hi]}</small>
            <b>{fmt(values[hi])}</b>
          </span>
        </>
      ) : null}
    </div>
  );
}
