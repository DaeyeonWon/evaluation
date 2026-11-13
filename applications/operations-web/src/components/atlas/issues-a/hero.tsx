"use client";
/** Triage Deck — hero KPI tiles (animated counters + sparklines) and the distribution ribbon. */
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, GitCompareArrows, Globe2, ShieldAlert, Siren, Sparkles, TrendingUp } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTween } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { IssueFactorKey, IssueSeverity, IssueStatus, IssueSummary, Market } from "@/lib/types";
import { ISSUE_STATUS_ORDER, type IssueFiltersApi, type IssueFormat } from "../issues-shared";
import { FACTOR_ORDER, Spark, argmax, factorVar } from "./viz";

export const MARKET_LANG: Record<Market, string> = { KR: "ko", US: "en", GB: "en", JP: "ja", ES: "es", MX: "es" };
const SEVS: IssueSeverity[] = ["P0", "P1", "P2", "P3"];

export function MarketChip({ m, label, dim }: { m: string; label?: string; dim?: boolean }) {
  return (
    <span className={clsx("ia-mkt", dim && "dim")} style={{ ["--lc" as string]: `var(--lang-${MARKET_LANG[m as Market] ?? "ko"})` } as CSSProperties} title={label}>
      {m}
    </span>
  );
}

function Count({ v, dec = 0 }: { v: number | null | undefined; dec?: number }) {
  const tv = useTween(v ?? 0, { duration: 900, fromZero: true, decimals: dec });
  return <>{v == null ? "—" : dec ? tv.toFixed(dec) : Math.round(tv).toLocaleString()}</>;
}

function Tile({
  icon,
  label,
  value,
  unit,
  sub,
  tone,
  spark,
  onClick,
  title,
  active,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: string;
  spark?: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  const body = (
    <>
      <span className="ia-t-k">
        {icon}
        <span>{label}</span>
      </span>
      <span className="ia-t-v">
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
      {sub ? <span className="ia-t-s">{sub}</span> : null}
      {spark ? <span className="ia-t-sp">{spark}</span> : null}
    </>
  );
  const style = tone ? ({ ["--tc" as string]: tone } as CSSProperties) : undefined;
  return onClick ? (
    <button type="button" className={clsx("ia-tile", active && "on")} data-tone={tone ? "" : undefined} style={style} onClick={onClick} title={title} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className="ia-tile" data-tone={tone ? "" : undefined} style={style}>
      {body}
    </div>
  );
}

type MiniBar = { key: string; label: string; v: number; tone: string; title: string; text: string; group?: string; strong?: boolean };
/** tiny labelled bar strip (tile footer); consecutive items sharing `group` get a caption underneath */
function MiniBars({ items, max, unit }: { items: MiniBar[]; max?: number; unit?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.v));
  const groups: { label: string; n: number }[] = [];
  for (const i of items) {
    const g = groups[groups.length - 1];
    if (i.group && g?.label === i.group) g.n++;
    else if (i.group) groups.push({ label: i.group, n: 1 });
  }
  return (
    <span className="ia-mbwrap">
      <span className="ia-minibars" role="list" aria-label={unit}>
        {items.map((i, n) => (
          <span
            key={i.key}
            role="listitem"
            className={clsx("ia-mb", i.strong && "strong", n > 0 && i.group && items[n - 1].group !== i.group && "gap")}
            title={i.title}
            aria-label={i.title}
            style={{ ["--tc" as string]: i.tone } as CSSProperties}
          >
            <span className="ia-mb-v mono">{i.text}</span>
            <span className="ia-mb-bar">
              <i style={{ height: `${Math.max(4, (i.v / m) * 100)}%` }} />
            </span>
            <span className="ia-mb-l mono">{i.label}</span>
          </span>
        ))}
      </span>
      {groups.length ? (
        <span className="ia-mb-groups mono" aria-hidden>
          {groups.map((g) => (
            <span key={g.label} style={{ flexGrow: g.n }}>
              {g.label}
            </span>
          ))}
        </span>
      ) : unit ? (
        <span className="ia-mb-groups mono" aria-hidden>
          <span>{unit}</span>
        </span>
      ) : null}
    </span>
  );
}

export function Hero({ sum, f, fx, labels, compact }: { sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat; labels: string[]; compact?: boolean }) {
  const t = useT("issuesA");
  const s = useT("issues");
  const k = sum?.kpis;
  const pts = sum?.trend.points ?? [];
  const bucket = sum ? s(`bucket.${sum.trend.bucket}`) : "";
  const trendAria = (name: string) => `${name} · ${t("hero.trend", { bucket })}`;
  const crit = pts.map((p) => p.critical_fails);
  const v = f.values;
  const critOn = v.severity.join() === "P0,P1";
  const safeOn = v.severity_class.join() === "safety";
  const newOn = v.novelty.join() === "new";
  const markets = sum?.columns.market ?? [];
  const up = (k?.fail_rate_delta ?? 0) > 0;
  const verOf = (col: "model_version" | "pipeline_version") => {
    const xs = [...(sum?.columns[col] ?? [])].sort((a, b) => a.value.localeCompare(b.value));
    // "bixby-nlu-2026.11-rc" → "11-rc", "v1.2-rc" → "1.2-rc" — the group caption carries the axis and year
    return xs.map((x, n) => ({ ...x, col, newest: n === xs.length - 1, short: col === "model_version" ? x.value.replace(/^bixby-nlu-\d{4}\./, "") : x.value.replace(/^v/, "") }));
  };
  const vers = [...verOf("model_version"), ...verOf("pipeline_version")];
  const classes = sum?.class_distribution ?? [];
  return (
    <section className={clsx("ia-hero", compact && "compact")} aria-label={t("hero.aria")}>
      <Tile
        icon={<Siren aria-hidden />}
        label={t("hero.critical")}
        tone="var(--sev-p0)"
        value={<Count v={k?.critical_open} />}
        sub={t("hero.criticalSub", { p0: k?.by_severity.P0 ?? 0, p1: k?.by_severity.P1 ?? 0 })}
        spark={<Spark values={crit} labels={labels} mark={argmax(crit)} tone="var(--sev-p0)" ariaLabel={trendAria(t("hero.critical"))} />}
        onClick={() => f.set({ severity: critOn ? [] : ["P0", "P1"] })}
        active={critOn}
        title={t("hero.apply")}
      />
      <Tile
        icon={<TrendingUp aria-hidden />}
        label={t("hero.failRate")}
        value={<Count v={k?.fail_rate} dec={1} />}
        unit="%"
        sub={
          <>
            <span className="ia-delta" data-dir={up ? "up" : "down"}>
              {up ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />}
              {fx.pp(k?.fail_rate_delta)}
            </span>{" "}
            {t("hero.failRateSub", { base: fx.pct(k?.baseline_fail_rate) })}
          </>
        }
        spark={<Spark values={pts.map((p) => p.fail_rate)} labels={labels} fmtValue={(n) => fx.pct(n)} tone="var(--accent)" ariaLabel={trendAria(t("hero.failRate"))} />}
      />
      <Tile
        icon={<Sparkles aria-hidden />}
        label={t("hero.newPatterns")}
        tone="var(--iss-new)"
        value={<Count v={k?.new_patterns} />}
        sub={t("hero.newPatternsSub", { n: k?.new_issues ?? 0 })}
        spark={<Spark values={pts.map((p) => p.new_pattern_rows)} labels={labels} tone="var(--iss-new)" ariaLabel={trendAria(t("hero.newPatterns"))} />}
        onClick={() => f.set({ novelty: newOn ? [] : ["new"] })}
        active={newOn}
        title={t("hero.apply")}
      />
      <Tile
        icon={<Globe2 aria-hidden />}
        label={t("hero.markets")}
        value={<Count v={k?.markets_affected} />}
        unit={`/${Math.max(markets.length, 6)}`}
        sub={t("hero.marketsSub", { n: markets.length || 6 })}
        spark={
          <MiniBars
            unit={t("hero.marketsUnit")}
            items={markets.map((m) => ({
              key: m.value,
              label: m.value,
              v: m.fail_rate,
              text: `${m.fail_rate.toFixed(0)}%`,
              tone: (m.delta ?? 0) > 0.5 ? "var(--ia-up)" : "var(--ink-3)",
              title: `${fx.value("market", m.value)} · FAIL ${fx.pct(m.fail_rate)} (${fx.pp(m.delta)})`,
            }))}
          />
        }
      />
      <Tile
        icon={<GitCompareArrows aria-hidden />}
        label={t("hero.regressions")}
        tone="var(--sev-p1)"
        value={<Count v={k?.regressions} />}
        sub={t("hero.regressionsSub")}
        spark={
          <MiniBars
            max={Math.max(1, ...vers.map((x) => x.fail_rate))}
            items={vers.map((x) => ({
              key: x.col + x.value,
              label: x.short,
              v: x.fail_rate,
              text: x.fail_rate.toFixed(1),
              tone: x.newest ? "var(--sev-p1)" : "var(--ink-3)",
              strong: x.newest,
              group: t(x.col === "model_version" ? "hero.groupModel" : "hero.groupPipeline"),
              title: `${fx.column(x.col)} ${x.value} · FAIL ${fx.pct(x.fail_rate)}`,
            }))}
          />
        }
      />
      <Tile
        icon={<ShieldAlert aria-hidden />}
        label={t("hero.safety")}
        tone="var(--cls-safety)"
        value={<Count v={k?.safety_issues} />}
        sub={t("hero.safetySub", { score: fx.score(k?.max_score) })}
        spark={
          <span className="ia-clsbar" role="img" aria-label={classes.map((c) => `${fx.cls(c.cls)} ${c.issues}`).join(", ")}>
            <span className="ia-clsbar-bar">
              {classes.map((c) => (c.issues ? <i key={c.cls} data-cls={c.cls} style={{ flexGrow: Math.sqrt(c.issues) }} /> : null))}
            </span>
            <span className="ia-clsbar-l">
              {classes.map((c) => (
                <span key={c.cls} data-cls={c.cls}>
                  <i />
                  {fx.cls(c.cls)} <b className="mono">{c.issues}</b>
                </span>
              ))}
            </span>
          </span>
        }
        onClick={() => f.set({ severity_class: safeOn ? [] : ["safety"] })}
        active={safeOn}
        title={t("hero.apply")}
      />
    </section>
  );
}

/** Severity ribbon (issues per P-level, FAIL share, status split) · factor profile · top movers (worsening first). */
export function Ribbon({ sum, f, fx }: { sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesA");
  const fm = useFmt();
  if (!sum) return <div className="ia-ribbon skel-box" aria-hidden />;
  const dist = SEVS.map((sv) => sum.severity_distribution.find((d) => d.severity === sv) ?? { severity: sv, issues: 0, fails: 0, by_status: {} as Record<IssueStatus, number> });
  const total = dist.reduce((a, d) => a + d.issues, 0) || 1;
  const failTotal = dist.reduce((a, d) => a + d.fails, 0) || 1;
  const prof = FACTOR_ORDER.map((k) => ({ k, v: sum.factor_profile[k] ?? 0 }));
  const profTotal = prof.reduce((a, p) => a + p.v, 0) || 1;
  // an issue report leads with what got worse; improvements only fill what is left (at most 2)
  const ups = sum.top_movers.filter((m) => m.direction === "up");
  const downs = sum.top_movers.filter((m) => m.direction !== "up");
  const movers = [...ups.slice(0, 6), ...downs.slice(0, Math.min(2, Math.max(0, 6 - ups.length)))];
  const st = sum.status_distribution;
  const stTotal = ISSUE_STATUS_ORDER.reduce((a, k) => a + (st[k] ?? 0), 0) || 1;
  return (
    <section className="ia-ribbon">
      <div className="ia-rb-block">
        <header>
          <b>{t("dist.severity")}</b>
          <span className="mono muted">{t("dist.severitySub", { n: fm.number(sum.kpis.issues) })}</span>
        </header>
        <div className="ia-sevbar" role="list">
          {dist.map((d) => (
            <button
              type="button"
              role="listitem"
              key={d.severity}
              className={clsx("ia-sevseg", f.values.severity.includes(d.severity) && "on", !d.issues && "zero")}
              data-sev={d.severity}
              disabled={!d.issues}
              onClick={() => f.toggle("severity", d.severity)}
              title={`${d.severity} · ${fx.severityHelp(d.severity)} · ${t("dist.fails", { n: d.fails })}\n${ISSUE_STATUS_ORDER.filter((s2) => d.by_status[s2]).map((s2) => `${fx.status(s2)} ${d.by_status[s2]}`).join(" · ")}`}
            >
              <span className="ia-sev-top">
                <span className="iss-sev" data-sev={d.severity}>
                  {d.severity}
                </span>
                <small className="mono">{t("dist.share", { pct: Math.round((d.issues / total) * 100) })}</small>
              </span>
              <b>{fm.number(d.issues)}</b>
              <small className="ia-sev-f mono">{t("dist.fails", { n: fm.number(d.fails) })}</small>
              <span className="ia-sevst" aria-hidden>
                {ISSUE_STATUS_ORDER.map((s2) => (d.by_status[s2] ? <i key={s2} data-st={s2} style={{ flexGrow: d.by_status[s2] }} /> : null))}
              </span>
            </button>
          ))}
        </div>
        <div className="ia-sevfail">
          <span className="ia-sevfail-k mono">{t("dist.failShare")}</span>
          <span className="ia-sevfail-bar" role="img" aria-label={dist.map((d) => `${d.severity} ${Math.round((d.fails / failTotal) * 100)}%`).join(", ")}>
            {dist.map((d) => (d.fails ? <i key={d.severity} data-sev={d.severity} style={{ flexGrow: d.fails }} title={`${d.severity} · ${t("dist.fails", { n: d.fails })}`} /> : null))}
          </span>
        </div>
        <ul className="ia-stleg" aria-label={t("dist.status")}>
          {ISSUE_STATUS_ORDER.map((k) => (
            <li key={k} data-st={k}>
              <i />
              {fx.status(k)} <b className="mono">{st[k] ?? 0}</b>
              <small className="mono">{Math.round(((st[k] ?? 0) / stTotal) * 100)}%</small>
            </li>
          ))}
        </ul>
      </div>
      <div className="ia-rb-block">
        <header>
          <b>{t("dist.profile")}</b>
          <span className="mono muted">Σ {profTotal.toFixed(1)}</span>
        </header>
        <div className="ia-prof" role="img" aria-label={prof.map((p) => `${fx.factor(p.k)} ${p.v.toFixed(1)}`).join(", ")}>
          {prof.map((p) => (
            <i key={p.k} style={{ flexGrow: p.v, ["--fc" as string]: factorVar(p.k) } as CSSProperties} title={`${fx.factor(p.k)} ${p.v.toFixed(1)} — ${fx.factorHelp(p.k)}`} />
          ))}
        </div>
        <ul className="ia-legend">
          {prof.map((p) => (
            <li key={p.k} title={fx.factorHelp(p.k)}>
              <i style={{ ["--fc" as string]: factorVar(p.k as IssueFactorKey) } as CSSProperties} />
              {fx.factor(p.k)} <span className="mono">{p.v.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="ia-rb-block">
        <header>
          <b>{t("dist.movers")}</b>
          <span className="mono muted">{t("dist.moversSub", { up: ups.length })}</span>
        </header>
        {movers.length ? (
          <ul className="ia-movers">
            {movers.map((m) => (
              <li key={m.column + m.value} data-dir={m.direction}>
                <button type="button" onClick={() => f.toggle(m.column, m.value)} aria-pressed={f.values[m.column]?.includes(m.value)} title={`${fx.column(m.column)} · ${fx.pct(m.baseline_fail_rate)} → ${fx.pct(m.fail_rate)}`}>
                  <span className="ia-mv-dir" data-dir={m.direction} aria-hidden>
                    {m.direction === "up" ? <ArrowUpRight /> : <ArrowDownRight />}
                  </span>
                  <span className="ia-mv-l">
                    <small>
                      {fx.column(m.column)}
                      {m.direction !== "up" ? ` · ${t("dist.improved")}` : ""}
                    </small>
                    {fx.value(m.column, m.value)}
                  </span>
                  <span className="mono ia-mv-d">{fx.pp(m.delta)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted ia-mv-none">{t("dist.noMovers")}</p>
        )}
      </div>
    </section>
  );
}
