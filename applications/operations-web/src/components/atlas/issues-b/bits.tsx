"use client";
/**
 * Market Brief — small shared pieces: figure captions, footnote refs, severity / class / status tags,
 * delta chips, hover tooltip, sparkline, horizontal bar list.
 */
import clsx from "clsx";
import { CheckCircle2, CircleDot, Eye, Gauge, MinusCircle, Scale, ShieldAlert, Shuffle, Ticket, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import type { IssueSeverity, IssueStatus, SeverityClass } from "@/lib/types";
import type { IssueFormat } from "../issues-shared";

/* ───────────── footnotes ───────────── */
export interface Note {
  n: number;
  key: string;
  label: string;
  href: string;
}
export interface NoteBook {
  list: Note[];
  of: (key: string) => Note | undefined;
}
export const NotesCtx = createContext<NoteBook>({ list: [], of: () => undefined });

/** Superscript evidence reference `[n]` → the note's /results link. */
export function FootRef({ k }: { k: string }) {
  const nb = useContext(NotesCtx);
  const n = nb.of(k);
  if (!n) return null;
  return (
    <Link className="issb-fn" href={n.href} title={n.label} aria-label={`${n.n}: ${n.label}`}>
      {n.n}
    </Link>
  );
}

/* ───────────── figures ───────────── */
export function Figure({ n, title, src, children, className, aside }: { n: string; title: ReactNode; src?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  const t = useT("issuesB");
  return (
    <figure className={clsx("issb-fig", className)}>
      <figcaption>
        <span className="issb-fig-no">{t("fig", { n })}</span>
        <span className="issb-fig-t">{title}</span>
        {aside ? <span className="issb-fig-aside">{aside}</span> : null}
      </figcaption>
      <div className="issb-fig-body">{children}</div>
      {src ? <div className="issb-fig-src">{t("source", { src })}</div> : null}
    </figure>
  );
}

/* ───────────── tags ───────────── */
export function Sev({ s }: { s: IssueSeverity }) {
  return (
    <span className="iss-sev" data-sev={s}>
      {s}
    </span>
  );
}

const CLS_ICON: Record<SeverityClass, LucideIcon> = { safety: ShieldAlert, policy: Scale, wrong_action: Shuffle, quality: Gauge };
export function ClsTag({ c, fx }: { c: SeverityClass; fx: IssueFormat }) {
  const I = CLS_ICON[c];
  return (
    <span className="issb-cls" data-cls={c} title={fx.clsHelp(c)}>
      <I aria-hidden />
      {fx.cls(c)}
    </span>
  );
}

const ST_ICON: Record<IssueStatus, LucideIcon> = { NEW: CircleDot, TRIAGED: Eye, TICKETED: Ticket, RESOLVED: CheckCircle2, IGNORED: MinusCircle };
export function StatusTag({ s, fx, extra }: { s: IssueStatus; fx: IssueFormat; extra?: ReactNode }) {
  const I = ST_ICON[s];
  return (
    <span className="issb-st" data-st={s} title={fx.statusHelp(s)}>
      <I aria-hidden />
      {fx.status(s)}
      {extra ? <span className="issb-st-x">{extra}</span> : null}
    </span>
  );
}

/** Diverging delta (pp): up = worse (warm), down = better (cool), |d| < 2 = neutral. */
export const deltaDir = (d: number | null | undefined) => (d == null ? "none" : d >= 2 ? "up" : d <= -2 ? "down" : "flat");
export function Delta({ d, fx, className }: { d: number | null | undefined; fx: IssueFormat; className?: string }) {
  return (
    <span className={clsx("issb-delta", className)} data-dir={deltaDir(d)}>
      {d == null ? "—" : fx.pp(d)}
    </span>
  );
}

/* ───────────── tooltip ───────────── */
interface TipState {
  x: number;
  y: number;
  flip: boolean;
  node: ReactNode;
}
/** Hover tooltip for SVG / HTML charts: spread `wrap` on a position:relative element, call `on(node)` per mark. */
export function useTip() {
  const [host, attach] = useState<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const move = useCallback((e: MouseEvent | React.FocusEvent, node: ReactNode) => {
    if (!host) return;
    const r = host.getBoundingClientRect();
    let x: number;
    let y: number;
    if ("clientX" in e) {
      x = e.clientX - r.left;
      y = e.clientY - r.top;
    } else {
      const b = (e.target as Element).getBoundingClientRect();
      x = b.left + b.width / 2 - r.left;
      y = b.top - r.top;
    }
    setTip({ x, y, flip: x > r.width - 200, node });
  }, [host]);
  const on = useCallback(
    (node: ReactNode) => ({
      onMouseMove: (e: MouseEvent) => move(e, node),
      onMouseEnter: (e: MouseEvent) => move(e, node),
      onFocus: (e: React.FocusEvent) => move(e, node),
      onMouseLeave: () => setTip(null),
      onBlur: () => setTip(null),
    }),
    [move],
  );
  const el = tip ? (
    <div className="issb-tip" role="tooltip" style={{ left: tip.x, top: tip.y, ["--flip" as string]: tip.flip ? "-100%" : "0%" } as CSSProperties}>
      {tip.node}
    </div>
  ) : null;
  return { attach, on, el };
}

/* ───────────── sparkline (SVG) ───────────── */
export function Spark({ values, w = 120, h = 30, base, className, label }: { values: (number | null)[]; w?: number; h?: number; base?: number | null; className?: string; label?: string }) {
  const vs = values.map((v) => (v == null ? null : v));
  const nums = vs.filter((v): v is number => v != null);
  if (!nums.length) return <svg className={clsx("issb-spark", className)} width={w} height={h} aria-hidden />;
  const max = Math.max(...nums, base ?? 0) || 1;
  const min = 0;
  const x = (i: number) => (vs.length <= 1 ? w / 2 : (i / (vs.length - 1)) * (w - 4) + 2);
  const y = (v: number) => h - 3 - ((v - min) / (max - min)) * (h - 6);
  let d = "";
  vs.forEach((v, i) => {
    if (v == null) return;
    d += (d && vs[i - 1] != null ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
  });
  const last = [...vs.keys()].reverse().find((i) => vs[i] != null) ?? 0;
  const area = d ? `${d}L${x(last).toFixed(1)},${h - 3}L${x(vs.findIndex((v) => v != null)).toFixed(1)},${h - 3}Z` : "";
  return (
    <svg className={clsx("issb-spark", className)} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      {base != null ? <line className="issb-spark-base" x1={0} x2={w} y1={y(base)} y2={y(base)} /> : null}
      <path className="issb-spark-area" d={area} />
      <path className="issb-spark-line" d={d} />
      <circle className="issb-spark-dot" cx={x(last)} cy={y(vs[last] ?? 0)} r={2.6} />
    </svg>
  );
}

/* ───────────── horizontal bar list (HTML) ───────────── */
export interface HBarRow {
  key: string;
  label: ReactNode;
  value: number | null;
  base?: number | null;
  delta?: number | null;
  sub?: ReactNode;
  tip?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}
/** Rate bars (0–max %) coloured by delta direction, with a baseline tick. */
export function HBars({ rows, max, fx, tipOn }: { rows: HBarRow[]; max?: number; fx: IssueFormat; tipOn?: ReturnType<typeof useTip>["on"] }) {
  const m = max ?? Math.max(1, ...rows.map((r) => Math.max(r.value ?? 0, r.base ?? 0)));
  return (
    <ul className="issb-hbars">
      {rows.map((r) => {
        const Tag = r.onClick ? "button" : "div";
        return (
          <li key={r.key}>
            <Tag className={clsx("issb-hbar", r.active && "on")} {...(r.onClick ? { type: "button" as const, onClick: r.onClick, "aria-pressed": !!r.active } : {})} {...(tipOn && r.tip ? tipOn(r.tip) : {})}>
              <span className="issb-hbar-l">{r.label}</span>
              <span className="issb-hbar-track">
                <i data-dir={deltaDir(r.delta)} style={{ width: `${((r.value ?? 0) / m) * 100}%` }} />
                {r.base != null ? <b style={{ left: `${(r.base / m) * 100}%` }} aria-hidden /> : null}
              </span>
              <span className="issb-hbar-v">
                {fx.pct(r.value)}
                {r.delta !== undefined ? <Delta d={r.delta} fx={fx} /> : null}
              </span>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

export function DeltaLegend() {
  const t = useT("issuesB");
  return (
    <span className="issb-legend" role="list">
      <span role="listitem">
        <i data-dir="up" /> {t("markets.worse")}
      </span>
      <span role="listitem">
        <i data-dir="flat" /> {t("markets.flat")}
      </span>
      <span role="listitem">
        <i data-dir="down" /> {t("markets.better")}
      </span>
      <span role="listitem">
        <i data-dir="none" /> {t("regression.noBaseline")}
      </span>
      <span role="listitem">
        <i data-tick /> {t("markets.baselineTick")}
      </span>
    </span>
  );
}

/** ISO-8601 week number of a KST timestamp. */
export function isoWeek(ts: number): { year: number; week: number } {
  const d = new Date(ts + 9 * 3600_000);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}
