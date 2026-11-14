"use client";
/** Triage Deck — the issue card (gauge · severity · trend · reach · examples · quick actions). */
import clsx from "clsx";
import { CheckCircle2, CircleDot, CircleSlash, ClipboardCheck, EyeOff, GitCompareArrows, ListChecks, MessageSquareWarning, PanelRightOpen, Scale, ShieldAlert, Shuffle, Sparkles, Ticket, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { Issue, IssueFactor, IssueFactorKey, IssueStatus, SeverityClass } from "@/lib/types";
import { useIssueViewLinks, type IssueFormat } from "../../issues-shared";
import { MarketChip } from "./hero";
import { TypeBadge, type TriageState } from "./lens";
import { Tpl, isTemplate } from "./stream";
import { FACTOR_ORDER, Gauge, Spark, argmax, factorVar } from "./viz";

export const CLS_ICON: Record<SeverityClass, ReactNode> = {
  safety: <ShieldAlert aria-hidden />,
  policy: <Scale aria-hidden />,
  wrong_action: <Shuffle aria-hidden />,
  quality: <MessageSquareWarning aria-hidden />,
};
export const STATUS_ICON: Record<IssueStatus, ReactNode> = {
  NEW: <CircleDot aria-hidden />,
  TRIAGED: <ClipboardCheck aria-hidden />,
  TICKETED: <Ticket aria-hidden />,
  RESOLVED: <CheckCircle2 aria-hidden />,
  IGNORED: <EyeOff aria-hidden />,
};

export function StatusTag({ s, fx }: { s: IssueStatus; fx: IssueFormat }) {
  return (
    <span className="ia-st" data-st={s} title={fx.statusHelp(s)}>
      {STATUS_ICON[s]}
      {fx.status(s)}
    </span>
  );
}
export function ClsTag({ c, fx }: { c: SeverityClass; fx: IssueFormat }) {
  return (
    <span className="ia-cls" data-cls={c} title={fx.clsHelp(c)}>
      {CLS_ICON[c]}
      {fx.cls(c)}
    </span>
  );
}

export interface CardActions {
  canWrite: boolean;
  readOnly: string | null;
  pending: string | null;
  me: string | null;
  triage: (i: Issue) => void;
  assignMe: (i: Issue) => void;
  ticket: (i: Issue) => void;
}

export function useGaugeLabel(fx: IssueFormat) {
  const t = useT("issuesTriage");
  return (i: Pick<Issue, "score" | "factors">) =>
    t("card.gaugeAria", {
      score: fx.score(i.score),
      parts: FACTOR_ORDER.map((k) => i.factors.find((f) => f.key === k))
        .filter(Boolean)
        .map((f) => t("card.factorPart", { factor: fx.factor(f!.key), points: f!.contribution.toFixed(1) }))
        .join(", "),
    });
}

/**
 * Plain-language line for a factor's raw detail. Regression always says what was compared and, at 0 points,
 * why it did not count, so a visibly worse rc next to "0/15" is never a contradiction.
 */
export function useFactorNote(fx: IssueFormat) {
  const t = useT("issuesTriage");
  return (f: IssueFactor): string | null => {
    if (f.key !== "regression") return null;
    const d = f.detail;
    const axis = (d.axis ?? d.candidate_axis) as string | null | undefined;
    if (!axis || d.current == null) return t("factorNote.regressionNone");
    const vars = {
      axis: fx.column(axis as never),
      current: String(d.current),
      previous: String(d.previous),
      cur: fx.pct(Number(d.current_rate)),
      prev: fx.pct(Number(d.previous_rate)),
      z: d.z == null ? "" : String(d.z),
    };
    if (d.axis) return t("factorNote.regression", vars);
    return t(`factorNote.regressionMiss.${(d.why as "insufficient_sample" | "not_significant" | "no_increase") ?? "not_significant"}`, vars);
  };
}

export function IssueCard({ issue: i, labels, fx, onOpen, act, compact, ts }: { issue: Issue; labels: string[]; fx: IssueFormat; onOpen: (id: string) => void; act: CardActions; compact?: boolean; ts: Pick<TriageState, "lens" | "typeDim"> }) {
  const t = useT("issuesTriage");
  const V = useIssueViewLinks();
  const dev = ts.lens === "dev";
  const typeValue = dev ? i.dev_miss_type : i.user_impact_type;
  const typeReason = dev ? i.type_reason?.dev_miss : i.type_reason?.user_impact;
  const br = i.bixby_regression;
  const fm = useFmt();
  const gl = useGaugeLabel(fx);
  const factorNote = useFactorNote(fx);
  const [focus, setFocus] = useState<IssueFactorKey | null>(null);
  const spike = argmax(i.spark);
  const st = i.state.status;
  const novelPat = i.patterns.find((p) => p.novel);
  // one real utterance (with what Bixby did) + the dominant other pattern; a slotted template is a pattern, not a quote
  const other = i.patterns.find((p) => p.template !== i.sample.utterance_text);
  const examples: { text: string; lang: string; actual: string | null; tpl: boolean }[] = [
    { text: i.sample.utterance_text, lang: i.sample.language, actual: i.sample.actual_response, tpl: false },
    ...(other ? [{ text: other.template, lang: other.language, actual: null, tpl: isTemplate(other.template) }] : []),
  ];
  const top = FACTOR_ORDER.map((k) => i.factors.find((f) => f.key === k)!).filter(Boolean);
  const focused = focus ? i.factors.find((f) => f.key === focus) : null;
  const busy = act.pending === i.id;
  const dis = !act.canWrite || busy;
  return (
    <article className={clsx("ia-card", compact && "compact")} data-sev={i.severity} data-st={st} data-lens={ts.lens} data-oos={(dev && !i.must_handle) || undefined} aria-labelledby={`ia-t-${i.id}`}>
      <div className="ia-c-top">
        <span className="ia-rank mono">{t("card.rank", { n: String(i.rank).padStart(2, "0") })}</span>
        <span className="iss-sev" data-sev={i.severity} title={fx.severityHelp(i.severity)}>
          {i.severity}
        </span>
        {typeValue ? <TypeBadge dim={ts.typeDim} value={typeValue} fx={fx} /> : null}
        {i.novelty === "new" ? <span className="ia-new">{fx.value("novelty", "new")}</span> : null}
        <StatusTag s={st} fx={fx} />
      </div>
      <div className="ia-c-main">
        <button type="button" className="ia-c-gauge" onClick={() => onOpen(i.id)} title={t("card.open")}>
          <Gauge score={i.score} factors={i.factors} size={compact ? 60 : 96} stroke={compact ? 6 : 9} label={gl(i)} sev={i.severity} focus={focus} onFocus={compact ? undefined : setFocus} />
        </button>
        <div className="ia-c-head">
          <h3 id={`ia-t-${i.id}`}>
            <Link className="ia-c-open" href={V.issueHref(i.id)} title={t("card.openFull")}>
              {fx.text(i.title)}
            </Link>
          </h3>
          <div className="ia-sig mono">
            <span>{fx.fn(i.signature.agent_function)}</span>
            <span className="sep">·</span>
            <span>{i.signature.intent_expected}</span>
            {i.signature.intent_predicted !== i.signature.intent_expected ? (
              <>
                <span className="ia-arrow">→</span>
                <span className="bad">{i.signature.intent_predicted}</span>
              </>
            ) : null}
            <span className="sep">·</span>
            <span>{fx.reason(i.signature.failure_reason)}</span>
          </div>
          {!compact ? (
            <ul className="ia-c-fx" aria-hidden>
              {top.map((f) => (
                <li key={f.key} className={clsx(focus === f.key && "on", f.contribution < 0.05 && "zero")} style={{ ["--fc" as string]: factorVar(f.key) } as CSSProperties} onMouseEnter={() => setFocus(f.key)} onMouseLeave={() => setFocus(null)}>
                  <i />
                  {fx.factor(f.key)}
                  <b className="mono">{f.contribution.toFixed(0)}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {!compact ? (
        <p className="ia-why">
          <span className="ia-why-k">{focused ? fx.factor(focused.key) : t("card.why")}</span>
          {focused ? `${factorNote(focused) ?? fx.factorHelp(focused.key)} — ${focused.contribution.toFixed(1)} / ${focused.weight}` : fx.text(i.reasons[0])}
        </p>
      ) : null}
      {!compact && typeReason ? (
        <div className="ia-tyr" style={{ ["--tyc" as string]: `var(--${dev ? "dm" : "ut"}-${typeValue})` } as CSSProperties}>
          <p>
            <span className="ia-why-k">{t(dev ? "card.devReason" : "card.userReason")}</span>
            {fx.text(typeReason)}
          </p>
          {dev ? (
            <p className="ia-mh" data-mh={String(i.must_handle)}>
              <span className="ia-mh-tag">
                {i.must_handle ? <ListChecks aria-hidden /> : <CircleSlash aria-hidden />}
                {fx.t.dynamic(`mustHandleValue.${i.must_handle}`, undefined, String(i.must_handle))}
              </span>
              {fx.text(i.must_handle_reason)}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="ia-c-metrics">
        <div className="ia-c-num">
          <b className="mono">{fm.number(i.count)}</b>
          <small>FAIL · {t("card.ofScope", { rate: fx.pct(i.fail_rate) })}</small>
          <small className={clsx("mono", (i.delta ?? 0) > 0 && "bad")}>{i.delta == null ? t("card.noBaseline") : t("card.delta", { pp: fx.pp(i.delta) })}</small>
        </div>
        <Spark
          className="ia-c-spark"
          values={i.spark}
          labels={labels}
          mark={spike}
          tone={`var(--sev-${i.severity.toLowerCase()})`}
          height={compact ? 24 : 38}
          ariaLabel={t("card.trendAria", { max: spike != null ? i.spark[spike] : 0 })}
        />
      </div>
      <div className="ia-c-reach">
        <span className="ia-mkts">
          {i.markets.map((m) => (
            <MarketChip key={m} m={m} label={fx.value("market", m)} />
          ))}
        </span>
        {!compact ? (
          <span className="ia-dims">
            {(i.divisions ?? []).slice(0, 2).map((d) => (
              <span key={d} className="ia-dchip" data-k="division" title={`${fx.column("division")} · ${fx.value("division", d)}`}>
                {fx.value("division", d)}
              </span>
            ))}
            {(i.divisions ?? []).length > 2 ? <span className="ia-dchip more">+{i.divisions.length - 2}</span> : null}
            {(i.regions ?? []).slice(0, 3).map((r) => (
              <span key={r} className="ia-dchip" data-k="region" title={`${fx.column("region")} · ${fx.value("region", r)}`}>
                {r}
              </span>
            ))}
            {(i.bixby_versions ?? []).slice(0, 2).map((b) => (
              <span key={b} className="ia-dchip mono" data-k="bixby" title={`${fx.column("bixby_version")} ${b}`}>
                B{b}
              </span>
            ))}
          </span>
        ) : null}
        <span className="ia-devs">{i.devices.slice(0, compact ? 1 : 3).join(" · ")}{i.devices.length > (compact ? 1 : 3) ? ` ${t("card.more", { n: i.devices.length - (compact ? 1 : 3) })}` : ""}</span>
        {i.regression ? (
          <span className="ia-reg" title={`${fx.column(i.regression.axis)} · ${i.regression.previous} ${fx.pct(i.regression.previousRate)} → ${i.regression.current} ${fx.pct(i.regression.currentRate)}`}>
            <GitCompareArrows aria-hidden />
            {i.regression.current}
          </span>
        ) : null}
        {br ? (
          <span className="ia-reg bixby" title={t("card.bixbyRegTitle", { division: fx.value("division", br.division), current: br.current, previous: br.previous, cur: fx.pct(br.currentRate), prev: fx.pct(br.previousRate) })}>
            <GitCompareArrows aria-hidden />
            {t("card.bixbyReg", { previous: br.previous, current: br.current, division: fx.value("division", br.division) })}
          </span>
        ) : null}
        {novelPat && !compact ? (
          <span className="ia-novel">
            <Sparkles aria-hidden />
            {t("card.novel")}
          </span>
        ) : null}
      </div>
      {!compact ? (
        <ul className="ia-ex">
          {examples.map((e, n) => (
            <li key={n} style={{ ["--lc" as string]: `var(--lang-${e.lang})` } as CSSProperties}>
              {e.tpl ? (
                <span className="ia-ex-tpl">
                  <small>{t("patterns.pattern")}</small>
                  <Tpl text={e.text} />
                </span>
              ) : (
                <q>{e.text}</q>
              )}
              {e.actual ? (
                <span className="ia-ex-a" title={t("card.actual")}>
                  ↳ {e.actual}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ia-c-acts">
        {i.state.owner_name ? <span className="ia-owner">{t("card.owner", { name: i.state.owner_name })}</span> : null}
        {i.state.ticket_id ? <span className="ia-ticket mono">{i.state.ticket_id}</span> : null}
        <span className="ia-c-btns">
          {st === "NEW" ? (
            <button type="button" className="btn sm" disabled={dis} title={act.readOnly ?? undefined} onClick={() => act.triage(i)}>
              <ClipboardCheck aria-hidden />
              {t("card.triage")}
            </button>
          ) : null}
          {!compact && i.state.owner !== act.me && st !== "RESOLVED" && st !== "IGNORED" ? (
            <button type="button" className="btn sm" disabled={dis} title={act.readOnly ?? undefined} onClick={() => act.assignMe(i)}>
              <UserPlus aria-hidden />
              {t("card.assignMe")}
            </button>
          ) : null}
          {st === "TRIAGED" || (st === "NEW" && !compact) ? (
            <button type="button" className="btn sm" disabled={dis} title={act.readOnly ?? undefined} onClick={() => act.ticket(i)}>
              <Ticket aria-hidden />
              {t("card.ticket")}
            </button>
          ) : null}
          <button type="button" className="btn sm ghost icon ia-c-more" onClick={() => onOpen(i.id)} title={t("card.open")} aria-label={t("card.open")}>
            <PanelRightOpen aria-hidden />
          </button>
        </span>
      </div>
    </article>
  );
}
