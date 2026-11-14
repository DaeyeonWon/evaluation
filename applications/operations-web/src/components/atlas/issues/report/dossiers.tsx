"use client";
/**
 * Market Brief — §2 Critical issues: numbered dossiers. Each one has a narrative paragraph built from the
 * issue's numbers, the criticality breakdown (six factors), the ranked "why flagged" reasons, an evidence
 * chart (FAILs per bucket) and the newest FAIL utterance as a pull-quote. Quick triage inline; the full
 * dossier (utterances, breakdowns, workflows, history) opens in the drawer.
 */
import clsx from "clsx";
import { ArrowUpRight, PanelRightOpen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { InsightList, Issue, IssueFactorKey, IssueListResponse, IssueStatus, IssueSummary } from "@/lib/types";
import { LangBadge } from "@/components/shared";
import { useIssuePermission, useIssueTriage, type IssueFiltersApi, type IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { ClsTag, Delta, Figure, FootRef, ImpactTag, StatusTag, TypeTag, useTip } from "./bits";
import type { BriefLinks } from "./links";
import { SecHead } from "./sec";

export const FACTORS: IssueFactorKey[] = ["volume", "severity", "trend", "regression", "reach", "novelty"];

/** Stacked bar of factor contributions on a 0–100 track + legend with points. */
export function FactorBar({ parts, fx, total, compact }: { parts: Partial<Record<IssueFactorKey, number>>; fx: IssueFormat; total?: number; compact?: boolean }) {
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const sum = total ?? FACTORS.reduce((a, k) => a + (parts[k] ?? 0), 0);
  return (
    <div className={clsx("issb-fbar", compact && "compact")} ref={tipAttach}>
      <div className="issb-fbar-track" role="img" aria-label={FACTORS.map((k) => `${fx.factor(k)} ${(parts[k] ?? 0).toFixed(1)}`).join(", ")}>
        {FACTORS.map((k) =>
          (parts[k] ?? 0) > 0 ? (
            <i
              key={k}
              data-f={k}
              tabIndex={0}
              style={{ width: `${parts[k]}%` }}
              {...tipOn(
                <>
                  <b>
                    {fx.factor(k)} · {(parts[k] ?? 0).toFixed(1)}
                  </b>
                  <div>{fx.factorHelp(k)}</div>
                </>,
              )}
            />
          ) : null,
        )}
        <span className="issb-fbar-total">{fx.score(sum)}</span>
      </div>
      {!compact ? (
        <ul className="issb-fbar-legend">
          {FACTORS.map((k) => (
            <li key={k} data-zero={(parts[k] ?? 0) <= 0 || undefined} title={fx.factorHelp(k)}>
              <i data-f={k} />
              <span>{fx.factor(k)}</span>
              <b>{(parts[k] ?? 0).toFixed(1)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {tipEl}
    </div>
  );
}

/** FAILs per trend bucket (HTML columns, responsive). */
export function EvidenceBars({ values, ts, bucket, label, expected }: { values: number[]; ts: number[]; bucket: "hour" | "day"; label: string; expected?: number | null }) {
  const t = useT("issuesReport");
  const fmt = useFmt();
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const exp = expected != null && expected > 0 ? expected : null;
  const max = Math.max(1, ...values, exp ?? 0);
  const lab = (x: number) => {
    if (bucket === "hour") return fmt.hm(x);
    const d = new Date(x + 9 * 3600_000); // KST calendar day
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  // a tick label under every bar when they fit (≤ 8 days), otherwise every 6th hour / every few days
  const every = values.length <= 8 ? 1 : bucket === "hour" ? 6 : Math.ceil(values.length / 6);
  return (
    <div className="issb-ebars" ref={tipAttach} role="img" aria-label={label}>
      <div className="issb-ebars-plot">
        {exp != null ? (
          <div className="issb-ebars-exp" aria-hidden style={{ bottom: `${(exp / max) * 100}%` }}>
            <em>{t("dossier.expectedLine", { n: exp < 10 ? exp.toFixed(1) : Math.round(exp) })}</em>
          </div>
        ) : null}
        {values.map((v, i) => (
          <span
            key={i}
            tabIndex={0}
            {...tipOn(
              <>
                <b>{ts[i] ? (bucket === "hour" ? fmt.dateTimeLabel(ts[i]) : fmt.dateLabel(ts[i])) : i + 1}</b>
                <div>FAIL {v}</div>
                {exp != null && v > exp ? <div>{t("dossier.aboveExpected")}</div> : null}
              </>,
            )}
          >
            <i style={{ height: `${(v / max) * 100}%` }} data-last={i === values.length - 1 || undefined} data-over={(exp != null && v > exp * 1.5) || undefined} />
          </span>
        ))}
      </div>
      <div className="issb-ebars-ticks" aria-hidden>
        {values.map((_, i) => (
          <span key={i}>{ts[i] && (i % every === 0 || i === values.length - 1) ? lab(ts[i]) : ""}</span>
        ))}
      </div>
      {tipEl}
    </div>
  );
}

/** Inline status transitions (TICKETED needs a ticket id → opens the drawer). */
export function QuickTriage({ issue, fx, onOpen }: { issue: Issue; fx: IssueFormat; onOpen: () => void }) {
  const s = useT("issues");
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const st = issue.state;
  const label: Partial<Record<IssueStatus, string>> = {
    TRIAGED: s("actions.triage"),
    RESOLVED: s("actions.resolve"),
    IGNORED: s("actions.ignore"),
    NEW: st.status === "TRIAGED" ? s("actions.untriage") : s("actions.reopen"),
    TICKETED: s("actions.ticket"),
  };
  return (
    <div className="issb-qt">
      <StatusTag s={st.status} fx={fx} extra={st.ticket_id ?? undefined} />
      <span className="issb-qt-owner">
        {s("field.owner")} <b>{st.owner_name ?? s("triage.noOwner")}</b>
      </span>
      <span className="issb-qt-acts" title={perm.reason ?? undefined}>
        {perm.next(st.status).map((n) => (
          <button
            key={n}
            type="button"
            className="btn sm"
            data-to={n}
            disabled={!perm.canWrite || tri.pending === issue.id}
            onClick={() => (n === "TICKETED" ? onOpen() : void tri.setStatus(issue, n))}
          >
            {label[n] ?? fx.status(n)}
          </button>
        ))}
      </span>
    </div>
  );
}

export function Narrative({ issue, fx }: { issue: Issue; fx: IssueFormat }) {
  const t = useT("issuesReport");
  const i = issue;
  return (
    <p className="issb-narr">
      {t("dossier.narrative.lead", { fn: fx.fn(i.signature.agent_function), title: fx.text(i.title), count: i.count })}{" "}
      {i.delta != null && i.baseline_rate != null
        ? t("dossier.narrative.rate", { rate: fx.pct(i.fail_rate), base: fx.pct(i.baseline_rate), delta: fx.pp(i.delta) })
        : t("dossier.narrative.rateNew", { rate: fx.pct(i.fail_rate) })}{" "}
      {t("dossier.narrative.reach", { markets: i.markets.map((m) => fx.value("market", m)).join(", "), devices: i.devices.join(", ") })}
      {i.regression ? (
        <>
          {" "}
          {t("dossier.narrative.regression", {
            axis: fx.column(i.regression.axis),
            current: i.regression.current,
            curRate: fx.pct(i.regression.currentRate),
            previous: i.regression.previous,
            prevRate: fx.pct(i.regression.previousRate),
          })}
        </>
      ) : null}
      <FootRef k={`iss:${i.id}`} />
    </p>
  );
}

export function PullQuote({ issue }: { issue: Issue }) {
  const t = useT("issuesReport");
  const x = issue.sample;
  return (
    <blockquote className="issb-quote">
      <span className="issb-quote-k">{t("dossier.quote")}</span>
      <p className="issb-quote-u">{x.utterance_text}</p>
      {x.asr_text && x.asr_text !== x.utterance_text ? (
        <p className="issb-quote-asr">
          <span>{t("dossier.heard")}</span> {x.asr_text}
        </p>
      ) : null}
      <p className="issb-quote-r">
        <span>{t("dossier.replied")}</span> {x.actual_response}
      </p>
      {x.expected_response ? (
        <p className="issb-quote-r exp">
          <span>{t("dossier.expectedReply")}</span> {x.expected_response}
        </p>
      ) : null}
      <footer>
        <span className="issb-quote-judge">
          — {t("dossier.judge")}: {x.judge_reason}
        </span>
        <span className="issb-quote-meta">
          <LangBadge lang={x.language} /> {x.market} · {x.device_type}
        </span>
      </footer>
    </blockquote>
  );
}

function Dossier({ issue, n, no, sum, f, fx, B }: { issue: Issue; n: number; no: number; sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat; B: BriefLinks }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const i = issue;
  const parts = Object.fromEntries(i.factors.map((x) => [x.key, x.contribution])) as Record<IssueFactorKey, number>;
  const bucket = sum?.trend.bucket ?? "day";
  const ts = (sum?.trend.points ?? []).map((p) => p.t);
  const open = () => f.select(i.id);
  const sparkTotal = i.spark.reduce((a, v) => a + v, 0);
  const peak = Math.max(0, ...i.spark);
  const peakAt = ts[i.spark.indexOf(peak)];
  // baseline-implied FAILs per bucket (trend factor: expected count over the compare window = the whole range in
  // "preceding" mode); hidden for an intra-range baseline, where the compare window is only part of the chart
  const trendDetail = i.factors.find((x) => x.key === "trend")?.detail;
  const expTotal = typeof trendDetail?.expected === "number" ? trendDetail.expected : null;
  const expPer = sum?.baseline.mode === "preceding" && sum.baseline.sufficient && expTotal != null && i.spark.length ? expTotal / i.spark.length : null;
  return (
    <article className="issb-dos" data-sev={i.severity} aria-labelledby={`issb-dos-${i.id}`}>
      <header className="issb-dos-head">
        <span className="issb-dos-n" aria-hidden>
          {String(n).padStart(2, "0")}
        </span>
        <div className="issb-dos-tags">
          <ImpactTag s={i.severity} />
          <TypeTag kind="category" v={i.category} fx={fx} />
          <ClsTag c={i.severity_class} fx={fx} />
          {i.novelty === "new" ? <span className="issb-new">{s("novelty.new")}</span> : null}
          <span className="issb-dos-id mono">
            {t("dossier.no", { n })} · {i.id}
          </span>
        </div>
        <h3 id={`issb-dos-${i.id}`}>
          <span className="issb-dos-kick">
            {t("dossier.kicker", { level: s.dynamic(`impactLevel.${i.severity}`, undefined, i.severity), category: fx.value("category", i.category) })}
          </span>
          <Link href={B.issueHref(i.id)}>{fx.text(i.title)}</Link>
        </h3>
        <div className="issb-dos-score" title={s("field.score")}>
          <b>{fx.score(i.score)}</b>
          <span>{t("dossier.scoreOf")}</span>
        </div>
      </header>

      <div className="issb-dos-grid">
        <div className="issb-dos-main">
          <Narrative issue={i} fx={fx} />
          <dl className="issb-dos-facts">
            <div>
              <dt>{s("field.count")}</dt>
              <dd>
                {fmt.number(i.count)} <small>{fx.pct(i.share)}</small>
              </dd>
            </div>
            <div>
              <dt>{s("field.failRate")}</dt>
              <dd>
                {fx.pct(i.fail_rate)} {i.delta != null ? <Delta d={i.delta} fx={fx} /> : <small className="issb-newtxt">{t("dossier.newCluster")}</small>}
              </dd>
            </div>
            <div>
              <dt>
                {s("column.division")} · {s("column.region")}
              </dt>
              <dd>
                {i.divisions.slice(0, 3).map((d) => fx.value("division", d)).join(" · ")}
                <small>{i.regions.join(" · ")}</small>
              </dd>
            </div>
            <div>
              <dt>{s("field.firstSeen")}</dt>
              <dd>{fmt.dateTimeLabel(i.first_seen)}</dd>
            </div>
          </dl>
          <div className="issb-dos-block">
            <h4>{t("dossier.breakdown")}</h4>
            <FactorBar parts={parts} fx={fx} total={i.score} />
          </div>
          <dl className="issb-dos-types">
            <div>
              <dt>{t("dossier.userImpact")}</dt>
              <dd>
                <TypeTag kind="user_impact" v={i.user_impact_type} fx={fx} /> <span>{fx.text(i.type_reason.user_impact)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("dossier.devMiss")}</dt>
              <dd>
                <TypeTag kind="dev_miss" v={i.dev_miss_type} fx={fx} /> <span>{fx.text(i.type_reason.dev_miss)}</span>
              </dd>
            </div>
          </dl>
          <div className="issb-dos-block">
            <h4>{t("dossier.why")}</h4>
            <ol className="issb-why">
              {i.reasons.map((r, k) => (
                <li key={k}>{fx.text(r)}</li>
              ))}
            </ol>
          </div>
        </div>
        <aside className="issb-dos-side">
          <PullQuote issue={i} />
          <Figure n={`${no}.${n}`} title={t("dossier.figEvidence", { bucket: s(`bucket.${bucket}`) })} src={t("sources.issues")}>
            <p className="issb-ebars-cap mono">
              {t("dossier.figCaption", { total: fmt.number(sparkTotal), peak: fmt.number(peak), at: peakAt ? (bucket === "hour" ? fmt.dateTimeLabel(peakAt) : fmt.dateLabel(peakAt)) : "—" })}
            </p>
            <EvidenceBars values={i.spark} ts={ts} bucket={bucket} expected={expPer} label={t("dossier.figEvidence", { bucket: s(`bucket.${bucket}`) })} />
          </Figure>
        </aside>
      </div>

      <footer className="issb-dos-foot">
        <QuickTriage issue={i} fx={fx} onOpen={open} />
        <span className="issb-dos-links">
          <Link className="issb-link" href={B.results(i)}>
            {t("dossier.results")} <ArrowUpRight aria-hidden />
          </Link>
          <button type="button" className="btn sm ghost" onClick={open}>
            <PanelRightOpen aria-hidden />
            {t("dossier.quick")}
          </button>
          <Link className="btn sm primary" href={B.issueHref(i.id)}>
            {t("dossier.analysis")}
            <ArrowUpRight aria-hidden />
          </Link>
        </span>
      </footer>
    </article>
  );
}

export function Dossiers({
  id,
  no,
  list,
  sum,
  f,
  fx,
  B,
}: {
  id: string;
  no: number;
  list: IssueListResponse | undefined;
  sum: IssueSummary | undefined;
  insights: InsightList | undefined;
  f: IssueFiltersApi;
  fx: IssueFormat;
  B: BriefLinks;
}) {
  const t = useT("issuesReport");
  const [all, setAll] = useState(false);
  const items = list?.items ?? [];
  const crit = items.filter((i) => i.severity === "P0" || i.severity === "P1");
  const base = (crit.length >= 3 ? crit : items).slice(0, Math.max(3, Math.min(crit.length, 6)));
  const extra = items.filter((i) => !base.includes(i)).slice(0, 6);
  const shown = all ? [...base, ...extra] : base;
  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.critical.title")} lead={t("section.critical.lead")} />
      {!list ? (
        <Skeleton rows={6} />
      ) : !items.length ? (
        <p className="issb-empty">{t("section.critical.empty")}</p>
      ) : (
        <div className="issb-dossiers">
          {shown.map((i, n) => (
            <Dossier key={i.id} issue={i} n={n + 1} no={no} sum={sum} f={f} fx={fx} B={B} />
          ))}
        </div>
      )}
      {extra.length ? (
        <button type="button" className="btn sm issb-more" onClick={() => setAll((a) => !a)}>
          {all ? t("section.critical.less") : t("section.critical.more", { n: extra.length, count: extra.length })}
        </button>
      ) : null}
    </section>
  );
}
