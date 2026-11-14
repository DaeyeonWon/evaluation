"use client";
/** Issue detail — hero: impact level, status, criticality gauge, title, signature, taxonomy (category / user impact / dev miss / must-handle) with reasons, KPIs, prev/next. */
import clsx from "clsx";
import { ArrowUpRight, ChevronLeft, ChevronRight, ClipboardCopy, Download, ShieldAlert, ShieldCheck, Tag, UserRound, Wrench } from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { IssueDetail } from "@/lib/types";
import type { IssueFormat } from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";
import { SCORE_BANDS, sevKey } from "./lib";

/** Semicircular 0–100 criticality gauge with the P2/P1/P0 band ticks. */
export function ScoreGauge({ score, sev, label }: { score: number; sev: string; label: string }) {
  const rm = useReducedMotionSafe();
  const W = 168;
  const r = 62;
  const cx = W / 2;
  const cy = 78;
  const pt = (v: number, rr = r) => {
    const a = Math.PI * (1 - v / 100);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
  };
  const [x0, y0] = pt(0);
  const [x1, y1] = pt(100);
  const track = `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`;
  const v = Math.max(0, Math.min(100, score));
  return (
    <figure className="idt-gauge" role="img" aria-label={label} data-sev={sev}>
      <svg viewBox={`0 0 ${W} 96`} width={W} height={96} aria-hidden>
        <path d={track} className="idt-g-track" />
        {SCORE_BANDS.map((b, n) => {
          const next = SCORE_BANDS[n + 1]?.at ?? 100;
          const R = r + 10;
          const [a0, b0] = pt(b.at + 0.6, R);
          const [a1, b1] = pt(next - 0.6, R);
          return <path key={b.sev} d={`M${a0} ${b0} A${R} ${R} 0 0 1 ${a1} ${b1}`} className="idt-g-band" data-sev={b.sev} />;
        })}
        <motion.path
          d={track}
          className="idt-g-fill"
          initial={rm ? false : { pathLength: 0 }}
          animate={{ pathLength: v / 100 }}
          transition={{ duration: rm ? 0 : 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        />
        {SCORE_BANDS.map((b) => {
          const [c0, d0] = pt(b.at, r - 7);
          const [c1, d1] = pt(b.at, r + 13);
          return <line key={b.sev} x1={c0} y1={d0} x2={c1} y2={d1} className="idt-g-tick" />;
        })}
        <text x={cx} y={cy - 8} textAnchor="middle" className="idt-g-num">
          {Math.round(v)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="idt-g-cap">
          / 100
        </text>
        <text x={x0} y={cy + 14} textAnchor="middle" className="idt-g-tl">
          0
        </text>
        <text x={x1} y={cy + 14} textAnchor="middle" className="idt-g-tl">
          100
        </text>
      </svg>
    </figure>
  );
}

function Tax({ icon, label, value, help, reason, tone, href, title }: { icon: ReactNode; label: string; value: string; help?: string; reason: string; tone?: string; href?: string; title?: string }) {
  const body = (
    <>
      <span className="idt-tax-k">
        {icon}
        {label}
      </span>
      <b className="idt-tax-v">{value}</b>
      <span className="idt-tax-r">{reason}</span>
    </>
  );
  return href ? (
    <Link className="idt-tax" href={href} data-tone={tone} title={title ?? help}>
      {body}
    </Link>
  ) : (
    <div className="idt-tax" data-tone={tone} title={help}>
      {body}
    </div>
  );
}

export function Hero({
  d,
  fx,
  drill,
  nav,
  onCopy,
  csvUrl,
  resultsUrl,
}: {
  d: IssueDetail;
  fx: IssueFormat;
  drill: (dim: string, v: string) => string;
  nav: { prev: string | null; next: string | null; pos: number; total: number };
  onCopy: () => void;
  csvUrl: string;
  resultsUrl: string;
}) {
  const t = useT("issuesDetail");
  const s = useT("issues");
  const fm = useFmt();
  const s0 = d.signature;
  const lvl = s.dynamic(`impactLevel.${d.severity}`, undefined, d.severity);
  const drillTitle = (label: string) => t("hero.drill", { label });
  return (
    <header className="idt-hero" data-sev={d.severity}>
      <div className="idt-hero-top">
        <div className="idt-badges">
          <span className="idt-impact" data-sev={d.severity} title={fx.severityHelp(d.severity)}>
            <i aria-hidden />
            <span className="mono">{d.severity}</span>
            <b>{lvl}</b>
            <small>{s("impactLevel.label")}</small>
          </span>
          <span className="iss-status mono idt-status" data-status={d.state.status} title={fx.statusHelp(d.state.status)}>
            {fx.status(d.state.status)}
          </span>
          {d.novelty === "new" ? <span className="idt-new mono" title={t("hero.novelHelp")}>{t("hero.novel")}</span> : null}
          <span className="mono muted idt-id">
            {d.id} · #{d.rank}
          </span>
        </div>
        <nav className="idt-pn" aria-label={t("hero.pnAria")}>
          {nav.prev ? (
            <Link className="btn sm icon" href={nav.prev} aria-label={t("hero.prev")} title={t("hero.prev")} scroll>
              <ChevronLeft aria-hidden />
            </Link>
          ) : (
            <span className="btn sm icon" aria-disabled="true" aria-label={t("hero.prev")}>
              <ChevronLeft aria-hidden />
            </span>
          )}
          <span className="mono muted">{nav.pos > 0 ? t("hero.pos", { pos: nav.pos, total: nav.total }) : t("hero.notInList")}</span>
          {nav.next ? (
            <Link className="btn sm icon" href={nav.next} aria-label={t("hero.next")} title={t("hero.next")} scroll>
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span className="btn sm icon" aria-disabled="true" aria-label={t("hero.next")}>
              <ChevronRight aria-hidden />
            </span>
          )}
        </nav>
      </div>
      <div className="idt-hero-main">
        <ScoreGauge score={d.score} sev={d.severity} label={t("hero.gaugeAria", { score: fx.score(d.score), sev: d.severity, level: lvl })} />
        <div className="idt-hero-text">
          <span className="idt-eyebrow mono">Criticality {fx.score(d.score)} · {fx.cls(d.severity_class)}</span>
          <h2 className="idt-title">{fx.text(d.title)}</h2>
          <div className="idt-sig mono">
            <span>{fx.fn(s0.agent_function)}</span>
            <span className="sep">·</span>
            <span>{s0.intent_expected}</span>
            {s0.intent_predicted !== s0.intent_expected ? (
              <>
                <span className="idt-arrow" aria-label={t("hero.routedTo")}>
                  →
                </span>
                <span className="idt-bad">{s0.intent_predicted}</span>
              </>
            ) : null}
            <span className="sep">·</span>
            <span>{fx.reason(s0.failure_reason)}</span>
          </div>
          <dl className="idt-kv">
            <div>
              <dt>{s("field.count")}</dt>
              <dd className="mono">{fm.number(d.count)}</dd>
            </div>
            <div>
              <dt>{s("field.failRate")}</dt>
              <dd className="mono">
                {fx.pct(d.fail_rate)}
                <small>
                  {fm.number(d.count)}/{fm.number(d.scope_total)}
                </small>
              </dd>
            </div>
            <div>
              <dt>{t("hero.vsBaseline")}</dt>
              <dd className={clsx("mono", (d.delta ?? 0) > 0.5 && "idt-up")} data-dir={d.delta == null ? "flat" : d.delta > 0.5 ? "up" : d.delta < -0.5 ? "down" : "flat"}>
                {fx.pp(d.delta)}
                <small>Baseline {fx.pct(d.baseline_rate)}</small>
              </dd>
            </div>
            <div>
              <dt>{s("field.share")}</dt>
              <dd className="mono">{fx.pct(d.share)}</dd>
            </div>
            <div>
              <dt>{s("field.firstSeen")}</dt>
              <dd className="mono idt-dt">{fm.dateTimeLabel(d.first_seen)}</dd>
            </div>
            <div>
              <dt>{s("field.lastSeen")}</dt>
              <dd className="mono idt-dt">{fm.dateTimeLabel(d.last_seen)}</dd>
            </div>
          </dl>
          <div className="idt-acts">
            <Link className="btn sm primary" href={resultsUrl}>
              {s("actions.openResults")} <ArrowUpRight aria-hidden />
            </Link>
            <a className="btn sm" href={csvUrl} download>
              <Download aria-hidden /> {t("export.csv")}
            </a>
            <button type="button" className="btn sm" onClick={onCopy}>
              <ClipboardCopy aria-hidden /> {t("export.markdown")}
            </button>
          </div>
        </div>
      </div>
      <div className="idt-taxes">
        <Tax
          icon={<Tag aria-hidden />}
          label={s("column.category")}
          value={fx.value("category", d.category)}
          help={s.dynamic(`categoryHelp.${d.category}`, undefined, "")}
          reason={fx.text(d.category_reason)}
          href={drill("category", d.category)}
          title={drillTitle(fx.value("category", d.category))}
        />
        <Tax
          icon={<UserRound aria-hidden />}
          label={s("column.user_impact")}
          value={fx.value("user_impact", d.user_impact_type)}
          help={s.dynamic(`userImpactHelp.${d.user_impact_type}`, undefined, "")}
          reason={fx.text(d.type_reason.user_impact)}
          href={drill("user_impact", d.user_impact_type)}
          title={drillTitle(fx.value("user_impact", d.user_impact_type))}
        />
        <Tax
          icon={<Wrench aria-hidden />}
          label={s("column.dev_miss")}
          value={fx.value("dev_miss", d.dev_miss_type)}
          help={s.dynamic(`devMissHelp.${d.dev_miss_type}`, undefined, "")}
          reason={fx.text(d.type_reason.dev_miss)}
          href={drill("dev_miss", d.dev_miss_type)}
          title={drillTitle(fx.value("dev_miss", d.dev_miss_type))}
        />
        <Tax
          icon={d.must_handle ? <ShieldAlert aria-hidden /> : <ShieldCheck aria-hidden />}
          label="Must-handle"
          value={s.dynamic(`mustHandleValue.${d.must_handle}`, undefined, String(d.must_handle))}
          reason={fx.text(d.must_handle_reason)}
          tone={d.must_handle ? "must" : "oos"}
          href={drill("must_handle", String(d.must_handle))}
          title={drillTitle(s.dynamic(`mustHandleValue.${d.must_handle}`, undefined, String(d.must_handle)))}
        />
      </div>
      <span className="idt-hero-sevbar" aria-hidden style={{ background: `var(--sev-${sevKey(d.severity)})` }} />
    </header>
  );
}
