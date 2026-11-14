"use client";
/** Triage Deck — hero KPI tiles (animated counters + sparklines) and the distribution ribbon. */
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Ban, Cpu, GitCompareArrows, ListChecks, ShieldAlert, ShieldOff, Shuffle, Siren, Sparkles, TrendingUp, Users } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTween } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import { BIXBY_VERSIONS } from "@/lib/catalog";
import type { Issue, IssueFacets, IssueFactorKey, IssueSeverity, IssueStatus, IssueSummary, Market } from "@/lib/types";
import { ISSUE_STATUS_ORDER, ModuleBadges, type IssueFiltersApi, type IssueFormat, type TriageLens } from "../../issues-shared";
import { TypeBar } from "./lens";
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

type FacetMap = IssueFacets["facets"] | undefined;
const fv = (fc: FacetMap, dim: keyof IssueFacets["facets"], v: string) => fc?.[dim]?.find((x) => x.value === v);

/**
 * KPI band. The lens changes the emphasis:
 * - user: safety · privacy, wrong actions, blocked tasks, affected utterances / markets, open P0·P1, FAIL rate
 * - dev:  must-handle misses, regressions, guardrail misses, new-feature gaps, Bixby version, open P0·P1
 * Tiles with an issue-level value toggle that value as a filter (the frame's FilterBar shows it as a chip).
 */
export function Hero({
  sum,
  facets,
  regs,
  lens,
  f,
  fx,
  labels,
  compact,
}: {
  sum: IssueSummary | undefined;
  facets: IssueFacets | undefined;
  regs: Issue[];
  lens: TriageLens;
  f: IssueFiltersApi;
  fx: IssueFormat;
  labels: string[];
  compact?: boolean;
}) {
  const t = useT("issuesTriage");
  const s = useT("issues");
  const fm = useFmt();
  const k = sum?.kpis;
  const fc = facets?.facets;
  const pts = sum?.trend.points ?? [];
  const bucket = sum ? s(`bucket.${sum.trend.bucket}`) : "";
  const trendAria = (name: string) => `${name} · ${t("hero.trend", { bucket })}`;
  const crit = pts.map((p) => p.critical_fails);
  const v = f.values;
  const critOn = v.severity.join() === "P0,P1";
  const up = (k?.fail_rate_delta ?? 0) > 0;
  const on = (dim: "user_impact" | "dev_miss", x: string) => v[dim].length === 1 && v[dim][0] === x;
  const toggleOnly = (dim: "user_impact" | "dev_miss", x: string) => f.set({ [dim]: on(dim, x) ? [] : [x] });
  const typeTile = (dim: "user_impact" | "dev_miss", x: string, icon: ReactNode, sub?: ReactNode, spark?: ReactNode) => {
    const n = fv(fc, dim, x);
    return (
      <Tile
        key={x}
        icon={icon}
        label={t.dynamic(`hero.${dim === "user_impact" ? "ut" : "dm"}.${x}`, undefined, fx.value(dim, x))}
        tone={`var(--${dim === "user_impact" ? "ut" : "dm"}-${x})`}
        value={<Count v={fc ? (n?.count ?? 0) : null} />}
        sub={sub ?? t("hero.typeSub", { fails: fm.number(n?.fails ?? 0) })}
        spark={spark}
        onClick={() => toggleOnly(dim, x)}
        active={on(dim, x)}
        title={`${fx.t.dynamic(`${dim === "user_impact" ? "userImpactHelp" : "devMissHelp"}.${x}`, undefined, "")} — ${t("hero.apply")}`}
      />
    );
  };
  const critical = (
    <Tile
      key="crit"
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
  );

  if (lens === "user") {
    const regions = fc?.region ?? sum?.columns.region ?? [];
    const markets = sum?.columns.market ?? [];
    const ui = fc?.user_impact ?? [];
    const uiTotal = ui.reduce((a, x) => a + x.count, 0);
    return (
      <section className={clsx("ia-hero", compact && "compact")} data-lens="user" aria-label={t("hero.aria")}>
        {typeTile(
          "user_impact",
          "safety_privacy",
          <ShieldAlert aria-hidden />,
          t("hero.safetySub2", { fails: fm.number(fv(fc, "user_impact", "safety_privacy")?.fails ?? 0), score: fx.score(k?.max_score) }),
          <ShareBar n={fv(fc, "user_impact", "safety_privacy")?.count ?? 0} total={uiTotal} tone="var(--ut-safety_privacy)" label={t("hero.shareOf", { pct: uiTotal ? Math.round(((fv(fc, "user_impact", "safety_privacy")?.count ?? 0) / uiTotal) * 100) : 0 })} />,
        )}
        {typeTile("user_impact", "wrong_action", <Shuffle aria-hidden />, undefined, <ShareBar n={fv(fc, "user_impact", "wrong_action")?.count ?? 0} total={uiTotal} tone="var(--ut-wrong_action)" label={t("hero.shareOf", { pct: uiTotal ? Math.round(((fv(fc, "user_impact", "wrong_action")?.count ?? 0) / uiTotal) * 100) : 0 })} />)}
        {typeTile("user_impact", "task_blocked", <Ban aria-hidden />, undefined, <ShareBar n={fv(fc, "user_impact", "task_blocked")?.count ?? 0} total={uiTotal} tone="var(--ut-task_blocked)" label={t("hero.shareOf", { pct: uiTotal ? Math.round(((fv(fc, "user_impact", "task_blocked")?.count ?? 0) / uiTotal) * 100) : 0 })} />)}
        <Tile
          icon={<Users aria-hidden />}
          label={t("hero.affected")}
          value={<Count v={k?.fails} />}
          sub={t("hero.affectedSub", { m: k?.markets_affected ?? 0, n: Math.max(markets.length, 6) })}
          spark={
            <MiniBars
              unit={t("hero.regionsUnit")}
              items={regions.map((m) => ({
                key: m.value,
                label: m.value,
                v: m.fail_rate ?? 0,
                text: `${(m.fail_rate ?? 0).toFixed(0)}%`,
                tone: (m.delta ?? 0) > 0.5 ? "var(--ia-up)" : "var(--ink-3)",
                strong: (m.delta ?? 0) > 0.5,
                title: `${fx.value("region", m.value)} · FAIL ${fx.pct(m.fail_rate)} (${fx.pp(m.delta)})`,
              }))}
            />
          }
        />
        {critical}
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
      </section>
    );
  }

  // ── dev lens ──
  const must = fv(fc, "must_handle", "true");
  const oos = fv(fc, "must_handle", "false");
  const mustOn = v.must_handle === "true";
  const verOf = (col: "model_version" | "pipeline_version") => {
    const xs = [...(sum?.columns[col] ?? [])].sort((a, b) => a.value.localeCompare(b.value));
    return xs.map((x, n) => ({ ...x, col, newest: n === xs.length - 1, short: col === "model_version" ? x.value.replace(/^bixby-nlu-\d{4}\./, "") : x.value.replace(/^v/, "") }));
  };
  const vers = [...verOf("model_version"), ...verOf("pipeline_version")];
  const bixbyRegs = regs.filter((i) => i.bixby_regression);
  const regVer = new Set(bixbyRegs.map((i) => i.bixby_regression!.current));
  const bvStats = fc?.bixby_version ?? sum?.columns.bixby_version ?? [];
  const bvs = [...BIXBY_VERSIONS.filter((x) => bvStats.some((b) => b.value === x)), ...bvStats.map((b) => b.value).filter((x) => !BIXBY_VERSIONS.includes(x))].map((x) => bvStats.find((b) => b.value === x)!);
  const topReg = bixbyRegs[0]?.bixby_regression;
  const bvOn = !!topReg && v.bixby_version.join() === topReg.current && v.division.join() === topReg.division;
  const dmMust = (fc?.dev_miss ?? []).filter((x) => x.value !== "out_of_scope");
  const dmCounts = Object.fromEntries(dmMust.map((x) => [x.value, x.count]));
  return (
    <section className={clsx("ia-hero", compact && "compact")} data-lens="dev" aria-label={t("hero.aria")}>
      <Tile
        icon={<ListChecks aria-hidden />}
        label={t("hero.mustHandle")}
        tone="var(--accent)"
        value={<Count v={fc ? (must?.count ?? 0) : null} />}
        sub={t("hero.mustHandleSub", { fails: fm.number(must?.fails ?? 0), oos: fm.number(oos?.count ?? 0) })}
        spark={<TypeBar dim="dev_miss" counts={dmCounts} fx={fx} label={t("hero.mustHandle")} />}
        onClick={() => f.set({ must_handle: mustOn ? null : "true" })}
        active={mustOn}
        title={t("hero.apply")}
      />
      {typeTile(
        "dev_miss",
        "regression",
        <GitCompareArrows aria-hidden />,
        t("hero.regSub", { n: k?.regressions ?? 0, b: bixbyRegs.length }),
        <MiniBars
          max={Math.max(1, ...vers.map((x) => x.fail_rate))}
          items={vers.map((x) => ({
            key: x.col + x.value,
            label: x.short,
            v: x.fail_rate,
            text: x.fail_rate.toFixed(1),
            tone: x.newest ? "var(--dm-regression)" : "var(--ink-3)",
            strong: x.newest,
            group: t(x.col === "model_version" ? "hero.groupModel" : "hero.groupPipeline"),
            title: `${fx.column(x.col)} ${x.value} · FAIL ${fx.pct(x.fail_rate)}`,
          }))}
        />,
      )}
      {typeTile("dev_miss", "guardrail_miss", <ShieldOff aria-hidden />, t("hero.guardSub", { fails: fm.number(fv(fc, "dev_miss", "guardrail_miss")?.fails ?? 0) }), <ShareBar n={fv(fc, "dev_miss", "guardrail_miss")?.count ?? 0} total={must?.count ?? 0} tone="var(--dm-guardrail_miss)" label={t("hero.shareOfMust", { pct: must?.count ? Math.round(((fv(fc, "dev_miss", "guardrail_miss")?.count ?? 0) / must.count) * 100) : 0 })} />)}
      {typeTile("dev_miss", "new_feature_gap", <Sparkles aria-hidden />, t("hero.nfSub", { fails: fm.number(fv(fc, "dev_miss", "new_feature_gap")?.fails ?? 0), p: k?.new_patterns ?? 0 }), <ShareBar n={fv(fc, "dev_miss", "new_feature_gap")?.count ?? 0} total={must?.count ?? 0} tone="var(--dm-new_feature_gap)" label={t("hero.shareOfMust", { pct: must?.count ? Math.round(((fv(fc, "dev_miss", "new_feature_gap")?.count ?? 0) / must.count) * 100) : 0 })} />)}
      <Tile
        icon={<Cpu aria-hidden />}
        label={t("hero.bixby")}
        tone="var(--dm-regression)"
        value={<Count v={sum ? bixbyRegs.length : null} />}
        unit={t("hero.bixbyUnit")}
        sub={topReg ? t("hero.bixbySub", { current: topReg.current, previous: topReg.previous, division: fx.value("division", topReg.division), pp: fx.pp(topReg.currentRate - topReg.previousRate) }) : t("hero.bixbyNone")}
        spark={
          <MiniBars
            unit={t("hero.bixbyBars")}
            items={bvs.map((b) => ({
              key: b.value,
              label: b.value.replace(/-beta$/, "β"),
              v: b.fail_rate ?? 0,
              text: (b.fail_rate ?? 0).toFixed(1),
              tone: regVer.has(b.value) ? "var(--dm-regression)" : "var(--ink-3)",
              strong: regVer.has(b.value),
              title: `Bixby ${b.value} · FAIL ${fx.pct(b.fail_rate)} (${fx.pp(b.delta)})${regVer.has(b.value) ? ` · ${t("hero.bixbyFlag")}` : ""}`,
            }))}
          />
        }
        onClick={topReg ? () => f.set(bvOn ? { bixby_version: [], division: [] } : { bixby_version: [topReg.current], division: [topReg.division] }) : undefined}
        active={bvOn}
        title={topReg ? t("hero.apply") : undefined}
      />
      {critical}
    </section>
  );
}

/** one-value share bar (tile footer): n of total */
function ShareBar({ n, total, tone, label }: { n: number; total: number; tone: string; label: string }) {
  const pct = total ? Math.min(100, (n / total) * 100) : 0;
  return (
    <span className="ia-share" style={{ ["--tc" as string]: tone } as CSSProperties}>
      <span className="ia-share-bar" role="img" aria-label={label}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="ia-share-l mono">{label}</span>
    </span>
  );
}

/** Severity ribbon (issues per P-level, FAIL share, status split) · factor profile · top movers (worsening first). */
export function Ribbon({ sum, f, fx }: { sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesTriage");
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
          <ModuleBadges feature="triage.ribbon" />
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
                <span className="ia-sev-lv">{fx.t.dynamic(`impactLevel.${d.severity}`, undefined, d.severity)}</span>
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
