"use client";
/** Triage Deck — insights ticker and the "new patterns" carousel row. */
import clsx from "clsx";
import { ArrowRight, ChevronLeft, ChevronRight, Filter, Pause, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type CSSProperties } from "react";
import { LangBadge } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { InsightList, NewPattern, PatternList } from "@/lib/types";
import type { IssueFilterValues, IssueFiltersApi, IssueFormat, useIssueLinks } from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";
import { MarketChip } from "./hero";
import { Spark } from "./viz";

type Links = ReturnType<typeof useIssueLinks>;

/** apply an insight's /issues filter params to the URL state */
function applyFilter(f: IssueFiltersApi, filter: Record<string, string>) {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === "range" || k === "from" || k === "to") continue;
    if (k === "min_score") patch[k] = Number(v);
    else if (k === "q") patch[k] = v;
    else patch[k] = v.split(",");
  }
  f.set(patch as Partial<IssueFilterValues>);
}

export function Ticker({ ins, f, fx, L }: { ins: InsightList | undefined; f: IssueFiltersApi; fx: IssueFormat; L: Links }) {
  const t = useT("issuesTriage");
  const s = useT("issues");
  const rm = useReducedMotionSafe();
  // `held` = pointer / focus is on the ticker (temporary), `paused` = the user pressed pause (sticky)
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const items = ins?.items ?? [];
  if (!items.length) return null;
  // the marquee keeps running in place while held (animation-play-state), so nothing jumps under the pointer
  const marquee = !rm;
  const row = (dup: boolean) =>
    items.map((i) => (
      <li key={(dup ? "d" : "") + i.id} aria-hidden={dup || undefined} className="ia-tk-item" data-sev={i.severity}>
        <span className="iss-sev" data-sev={i.severity}>
          {i.severity}
        </span>
        <span className="ia-tk-kind">{s.dynamic(`insightKind.${i.kind}`, undefined, i.kind)}</span>
        <span className="ia-tk-text">{fx.insight(i)}</span>
        <Link className="ia-tk-lnk" href={L.evidence(i)} tabIndex={dup ? -1 : undefined}>
          {t("ticker.evidence")} <ArrowRight aria-hidden />
        </Link>
        {Object.keys(i.evidence.filter).length ? (
          <button type="button" className="ia-tk-lnk ia-tk-apply" onClick={() => applyFilter(f, i.evidence.filter)} tabIndex={dup ? -1 : undefined} title={t("ticker.apply")}>
            <Filter aria-hidden />
            {t("ticker.applyShort")}
          </button>
        ) : null}
      </li>
    ));
  return (
    <section
      className={clsx("ia-ticker", marquee && "run", marquee && (paused || held) && "hold")}
      aria-label={t("ticker.title")}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onPointerDown={() => setHeld(true)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="ia-tk-head">
        <span className="ia-tk-pulse" aria-hidden />
        <b>{t("ticker.title")}</b>
        <span className="mono muted">{t("ticker.count", { n: items.length })}</span>
        {marquee ? (
          <button type="button" className="btn icon sm ia-tk-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={paused ? t("ticker.play") : t("ticker.pause")}>
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          </button>
        ) : null}
      </div>
      <div className="ia-tk-view">
        <ul className="ia-tk-track" style={{ ["--n" as string]: items.length } as CSSProperties}>
          {row(false)}
          {marquee ? row(true) : null}
        </ul>
      </div>
    </section>
  );
}

/** a pattern template with its `{slot}` placeholders shown as slot chips (never quoted like an utterance) */
export function Tpl({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <span className="ia-tpl mono">
      {parts.map((x, n) => (/^\{[^}]+\}$/.test(x) ? <var key={n}>{x.slice(1, -1)}</var> : <span key={n}>{x}</span>))}
    </span>
  );
}
export const isTemplate = (s: string) => /\{[^}]+\}/.test(s);

function PatternCard({ p, fx, L, now, onIssue }: { p: NewPattern; fx: IssueFormat; L: Links; now: number; onIssue: (id: string) => void }) {
  const t = useT("issuesTriage");
  const fm = useFmt();
  const top = p.intents_predicted[0];
  const wrong = top && top.intent !== p.intent_expected;
  const hot = p.fail_rate >= 40;
  // the most recent FAIL example (examples are FAIL-first, newest first)
  const head = p.examples[0];
  return (
    <article className={clsx("ia-pat", hot && "hot")} style={{ ["--fr" as string]: `${Math.min(100, p.fail_rate)}%` } as CSSProperties}>
      <header>
        <span className="ia-pat-kind" title={fx.kindHelp(p.kind)}>
          <Sparkles aria-hidden /> {fx.kind(p.kind)}
        </span>
        <LangBadge lang={p.language} />
      </header>
      {/* headline = a real utterance; a slotted template is shown separately as a pattern, never as a quote */}
      <q className="ia-pat-tpl">{head?.utterance_text ?? p.template}</q>
      {isTemplate(p.template) ? (
        <span className="ia-pat-pattern">
          <small>{t("patterns.pattern")}</small>
          <Tpl text={p.template} />
        </span>
      ) : null}
      <div className="ia-pat-terms">
        {p.terms.slice(0, 3).map((x) => (
          <mark key={x}>{x}</mark>
        ))}
      </div>
      {head ? (
        <div className="ia-pat-ex">
          <span className="ia-pat-ex-k mono">ASR</span>
          <q>{head.asr_text || head.utterance_text}</q>
          {head.result === "FAIL" ? (
            <span className="ia-ex-a">
              ↳ <span className="mono">{head.intent_predicted}</span> · {head.actual_response}
            </span>
          ) : (
            <span className="ia-ex-a ok">↳ PASS · {head.actual_response}</span>
          )}
        </div>
      ) : null}
      <div className="ia-pat-stats">
        <span>
          <b className="mono">{fm.number(p.count)}</b>
          <small>{t("patterns.rowsLabel")}</small>
        </span>
        <span className={clsx(hot && "bad")}>
          <b className="mono">{fx.pct(p.fail_rate)}</b>
          <small>FAIL</small>
        </span>
        <span>
          <b className="mono">{p.growth == null ? "NEW" : `×${p.growth}`}</b>
          <small>{p.growth == null ? t("patterns.growthNew") : fx.t("field.growth")}</small>
        </span>
      </div>
      <div className="ia-pat-fail" aria-hidden>
        <i />
      </div>
      <Spark values={p.daily} labels={p.daily_t.map((x) => fm.dateLabel(x))} height={26} tone="var(--iss-new)" ariaLabel={`${p.template} · ${fx.t("field.growth")}`} />
      <dl className="ia-pat-map">
        <dt>{fx.fn(p.agent_function)}</dt>
        <dd className="mono">
          {p.intent_expected}
          {wrong ? (
            <>
              {" "}
              <span className="ia-arrow">→</span> <span className="bad">{top.intent}</span>
            </>
          ) : null}
        </dd>
      </dl>
      <div className="ia-pat-foot">
        <span className="ia-mkts">
          {p.markets.map((m) => (
            <MarketChip key={m} m={m} label={fx.value("market", m)} />
          ))}
        </span>
        <span className="mono muted">{t("patterns.firstSeen", { when: fm.relative(p.first_seen, now) })}</span>
      </div>
      <div className="ia-pat-acts">
        <Link className="btn sm" href={L.resultsFor({ utterance_pattern: p.id })}>
          {t("patterns.results")}
        </Link>
        {p.issue_ids[0] ? (
          <button type="button" className="btn sm ghost" onClick={() => onIssue(p.issue_ids[0])}>
            {t("patterns.issue")} <ArrowRight aria-hidden />
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function PatternRow({ pats, fx, L, now, onIssue }: { pats: PatternList | undefined; fx: IssueFormat; L: Links; now: number; onIssue: (id: string) => void }) {
  const t = useT("issuesTriage");
  const s = useT("issues");
  const ref = useRef<HTMLDivElement>(null);
  const rm = useReducedMotionSafe();
  const items = pats?.items ?? [];
  const scroll = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: rm ? "auto" : "smooth" });
  };
  return (
    <section className="ia-pats" aria-label={t("patterns.title")}>
      <header>
        <div>
          <h2>
            <Sparkles aria-hidden /> {t("patterns.title")}
          </h2>
          <p className="muted">{t("patterns.sub", { n: items.length })}</p>
        </div>
        <ul className="ia-terms">
          {(pats?.terms ?? []).slice(0, 6).map((x) => (
            <li key={x.term} title={x.languages.join(", ")}>
              <mark>{x.term}</mark>
              <span className="mono">{x.count}</span>
            </li>
          ))}
        </ul>
        <div className="ia-pats-nav">
          <button type="button" className="btn icon" onClick={() => scroll(-1)} aria-label={t("patterns.prev")}>
            <ChevronLeft aria-hidden />
          </button>
          <button type="button" className="btn icon" onClick={() => scroll(1)} aria-label={t("patterns.next")}>
            <ChevronRight aria-hidden />
          </button>
        </div>
      </header>
      {items.length ? (
        <div className="ia-pats-view" ref={ref} tabIndex={0} aria-label={t("patterns.title")}>
          {items.map((p) => (
            <PatternCard key={p.id} p={p} fx={fx} L={L} now={now} onIssue={onIssue} />
          ))}
        </div>
      ) : (
        <div className="empty">{s("empty.patterns")}</div>
      )}
    </section>
  );
}
