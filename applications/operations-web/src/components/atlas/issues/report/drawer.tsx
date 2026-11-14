"use client";
/**
 * Market Brief — full issue dossier (drawer on ?issue=<id>): score evidence per factor, reasons, trend,
 * breakdowns, utterances (paged, → /results drawer), Workflows (range widened to cover them), similar
 * issues, triage (status transitions, ticket, owner, note — issues:write) and history.
 */
import clsx from "clsx";
import { ArrowUpRight, ChevronLeft, ChevronRight, KeyRound, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import { OPERATORS } from "@/lib/catalog";
import type { IssueDetail, IssueStatus } from "@/lib/types";
import { LangBadge } from "@/components/shared";
import { useIssue, useIssueLinks, useIssuePermission, useIssueTriage, type IssueFiltersApi, type IssueFormat } from "../../issues-shared";
import { ErrorNote, Skeleton, useReducedMotionSafe } from "../../ui";
import { ClsTag, Delta, HBars, Sev, StatusTag } from "./bits";
import { EvidenceBars, FACTORS, Narrative, PullQuote } from "./dossiers";

const BREAKDOWN = ["market", "language", "device", "model_version", "pipeline_version", "os_version", "one_ui_version"] as const;

export function DossierDrawer({ id, f, fx, page, setPage }: { id: string; f: IssueFiltersApi; fx: IssueFormat; page: number; setPage: (p: number) => void }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const reduced = useReducedMotionSafe();
  const det = useIssue(id, f, { page, pageSize: 10 });
  const d = det.data?.id === id ? det.data : undefined;
  const L = useIssueLinks();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => f.select(null);

  useEffect(() => {
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") f.select(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <motion.div className="scrim" style={{ padding: 0 }} onClick={close} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer issb-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("drawer.aria")}
        initial={reduced ? false : { x: 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { x: 48, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="dlg-head">
          <div style={{ minWidth: 0 }}>
            <div className="mono muted issb-drawer-dwg">
              DOSSIER · {id}
              {d ? ` · #${d.rank}` : ""}
            </div>
            <h3>{d ? fx.text(d.title) : t("drawer.loading")}</h3>
          </div>
          <button ref={closeRef} type="button" className="btn icon" onClick={close} aria-label={t("drawer.close")}>
            <X />
          </button>
        </div>
        <div className="issb-drawer-body">
          {det.error ? <ErrorNote error={det.error} /> : null}
          {!d ? det.isLoading || !det.error ? <Skeleton rows={10} /> : <p className="issb-empty">{t("drawer.notFound")}</p> : <Body d={d} f={f} fx={fx} page={page} setPage={setPage} />}
        </div>
        {d ? (
          <div className="dlg-foot">
            <Link className="btn sm" href={L.results(d)}>
              {s("actions.openResults")} <ArrowUpRight aria-hidden />
            </Link>
            <button type="button" className="btn sm" onClick={close}>
              {t("drawer.close")}
            </button>
          </div>
        ) : null}
      </motion.aside>
    </>
  );
}

function Body({ d, f, fx, page, setPage }: { d: IssueDetail; f: IssueFiltersApi; fx: IssueFormat; page: number; setPage: (p: number) => void }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const L = useIssueLinks();
  const pages = Math.max(1, Math.ceil(d.utterances.total / d.utterances.pageSize));

  return (
    <>
      <section className="issb-dr-top">
        <div className="issb-dos-tags">
          <Sev s={d.severity} />
          <ClsTag c={d.severity_class} fx={fx} />
          <StatusTag s={d.state.status} fx={fx} extra={d.state.ticket_id ?? undefined} />
          {d.novelty === "new" ? <span className="issb-new">{s("novelty.new")}</span> : null}
        </div>
        <div className="issb-dr-score">
          <b>{fx.score(d.score)}</b>
          <span>{t("dossier.scoreOf")}</span>
        </div>
        <Narrative issue={d} fx={fx} />
        <dl className="issb-dos-facts">
          <div>
            <dt>{s("field.count")}</dt>
            <dd>
              {fmt.number(d.count)} <small>/ {fmt.number(d.scope_total)}</small>
            </dd>
          </div>
          <div>
            <dt>{s("field.failRate")}</dt>
            <dd>
              {fx.pct(d.fail_rate)} <Delta d={d.delta} fx={fx} />
            </dd>
          </div>
          <div>
            <dt>{s("field.expected")}</dt>
            <dd className="mono">{d.signature.intent_expected}</dd>
          </div>
          <div>
            <dt>{s("field.predicted")}</dt>
            <dd className="mono">{d.signature.intent_predicted}</dd>
          </div>
        </dl>
      </section>

      <section className="issb-dr-sec">
        <h4>{t("drawer.scoreDetail")}</h4>
        <ul className="issb-factors">
          {FACTORS.map((k) => {
            const x = d.factors.find((y) => y.key === k);
            if (!x) return null;
            return (
              <li key={k}>
                <span className="issb-factors-l">
                  <i data-f={k} aria-hidden />
                  <b>{fx.factor(k)}</b>
                  <small>{t("drawer.weight", { w: x.weight })}</small>
                </span>
                <span className="issb-factors-track">
                  <i data-f={k} style={{ width: `${x.value * 100}%` }} />
                </span>
                <span className="issb-factors-v mono">
                  +{x.contribution.toFixed(1)}
                </span>
                <small className="issb-factors-d mono">
                  {Object.entries(x.detail)
                    .filter(([, v]) => v != null && v !== "")
                    .map(([kk, v]) => `${kk}=${typeof v === "string" ? fx.value(kk === "cls" ? "severity_class" : kk, v) : v}`)
                    .join(" · ")}
                </small>
                <small className="issb-factors-h">{fx.factorHelp(k)}</small>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="issb-dr-sec">
        <h4>{s("field.reasons")}</h4>
        <ol className="issb-why">
          {d.reasons.map((r, i) => (
            <li key={i}>{fx.text(r)}</li>
          ))}
        </ol>
      </section>

      <section className="issb-dr-sec issb-dr-2">
        <div>
          <h4>{t("drawer.trend")}</h4>
          <EvidenceBars values={d.trend.points.map((p) => p.fails)} ts={d.trend.points.map((p) => p.t)} bucket={d.trend.bucket} label={t("drawer.trend")} />
        </div>
        <PullQuote issue={d} />
      </section>

      <section className="issb-dr-sec">
        <h4>{t("drawer.breakdown")}</h4>
        <div className="issb-dr-bd">
          {BREAKDOWN.map((c) =>
            d.breakdown[c]?.length ? (
              <div key={c}>
                <h5>{fx.column(c)}</h5>
                <HBars
                  fx={fx}
                  max={100}
                  rows={d.breakdown[c].slice(0, 6).map((r) => ({
                    key: r.value,
                    label: c === "language" ? <LangBadge lang={r.value as never} /> : fx.value(c, r.value),
                    value: r.fail_rate,
                    base: r.baseline_fail_rate,
                    delta: r.delta,
                  }))}
                />
              </div>
            ) : null,
          )}
        </div>
      </section>

      <section className="issb-dr-sec">
        <h4>{t("drawer.patterns")}</h4>
        <ul className="issb-dr-pats">
          {d.patterns.map((p) => (
            <li key={p.id}>
              <LangBadge lang={p.language} />
              <Link href={L.resultsFor({ utterance_pattern: p.id })}>“{p.template}”</Link>
              {p.novel ? <span className="issb-new">{t("drawer.novel")}</span> : null}
              <small className="mono">{t("drawer.fails", { n: p.count })}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="issb-dr-sec">
        <h4>
          {t("drawer.utterances")} <small className="mono muted">{t("drawer.utterancesCount", { n: fmt.number(d.utterances.total), count: d.utterances.total })}</small>
        </h4>
        <ul className="issb-utts">
          {d.utterances.items.map((r) => (
            <li key={r.utterance_id}>
              <div className="issb-utts-h">
                <LangBadge lang={r.language} />
                <span className="mono muted">
                  {r.market} · {r.device_type} · {r.model_version} · {r.pipeline_version}
                </span>
                <Link className="issb-link" href={L.utterance(r.utterance_id)}>
                  {t("drawer.openUtterance")} <ArrowUpRight aria-hidden />
                </Link>
              </div>
              <p className="issb-utts-u">“{r.utterance_text}”</p>
              {r.asr_text !== r.utterance_text ? (
                <p className="issb-utts-x">
                  <span>{s("field.asr")}</span> {r.asr_text}
                </p>
              ) : null}
              <p className="issb-utts-x mono">
                <span>{s("field.expected")}</span> {r.intent_expected} <span>→ {s("field.predicted")}</span> <b className={clsx(r.intent_predicted !== r.intent_expected && "bad")}>{r.intent_predicted}</b>
              </p>
              <p className="issb-utts-x">
                <span>{s("field.judgeReason")}</span> {r.judge_reason} <span className="mono">({r.judge_score})</span>
              </p>
            </li>
          ))}
        </ul>
        {pages > 1 ? (
          <div className="issb-pager">
            <button type="button" className="btn sm icon" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("drawer.prev")}>
              <ChevronLeft />
            </button>
            <span className="mono">{t("drawer.page", { page, pages })}</span>
            <button type="button" className="btn sm icon" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={t("drawer.next")}>
              <ChevronRight />
            </button>
          </div>
        ) : null}
      </section>

      <section className="issb-dr-sec issb-dr-2">
        <div>
          <h4>{t("drawer.workflows")}</h4>
          {d.workflows.length ? (
            <ul className="issb-wfs">
              {d.workflows.map((w) => (
                <li key={w.workflow_id}>
                  <Link href={L.workflow(w.workflow_id, w.created_at, w.completed_at)} className="mono">
                    {w.workflow_id}
                  </Link>
                  <small className="mono muted">
                    {w.pipeline_id} {w.pipeline_version} · {fmt.dateTimeLabel(w.created_at)} · FAIL {w.fails}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("drawer.noWorkflows")}</p>
          )}
        </div>
        <div>
          <h4>{t("drawer.similar")}</h4>
          {d.similar.length ? (
            <ul className="issb-sim">
              {d.similar.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => f.select(x.id)}>
                    <Sev s={x.severity} />
                    <span>{fx.text(x.title)}</span>
                    <small className="mono">
                      {s(`relation.${x.relation}`)} · {fx.score(x.score)}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("drawer.noSimilar")}</p>
          )}
        </div>
      </section>

      <TriagePanel d={d} fx={fx} />
    </>
  );
}

function TriagePanel({ d, fx }: { d: IssueDetail; fx: IssueFormat }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const st = d.state;
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState(st.ticket_id ?? "");
  const [owner, setOwner] = useState(st.owner ?? "");
  const [note, setNote] = useState(st.note ?? "");
  const [ticketErr, setTicketErr] = useState(false);
  // resync when the server state changes (another operator, SSE refetch)
  const stamp = `${d.id}:${st.updated_at ?? 0}`;
  const [seen, setSeen] = useState(stamp);
  if (seen !== stamp) {
    setSeen(stamp);
    setTicket(st.ticket_id ?? "");
    setOwner(st.owner ?? "");
    setNote(st.note ?? "");
  }
  const busy = tri.pending === d.id;
  const dis = !perm.canWrite || busy;
  const labels: Partial<Record<IssueStatus, string>> = { TRIAGED: s("actions.triage"), TICKETED: s("actions.ticket"), RESOLVED: s("actions.resolve"), IGNORED: s("actions.ignore"), NEW: st.status === "TRIAGED" ? s("actions.untriage") : s("actions.reopen") };

  const move = async (n: IssueStatus) => {
    if (n === "TICKETED" && !/^[A-Z][A-Z0-9]+-\d+$/.test(ticket.trim())) {
      setTicketErr(true);
      return;
    }
    setTicketErr(false);
    const r = await tri.setStatus(d, n, { ...(reason.trim() ? { reason: reason.trim() } : {}), ...(n === "TICKETED" ? { ticket_id: ticket.trim() } : {}) });
    if (r) setReason("");
  };
  const save = () => void tri.update(d.id, { owner: owner || null, note: note.trim() || null });

  return (
    <section className="issb-dr-sec issb-triage" aria-labelledby="issb-triage-h">
      <h4 id="issb-triage-h">{t("drawer.triage")}</h4>
      {!perm.canWrite ? (
        <p className="note warn issb-ro">
          <KeyRound aria-hidden /> {perm.reason}
        </p>
      ) : null}
      <div className="issb-tri-flow" aria-label={t("triage.current")}>
        {(["NEW", "TRIAGED", "TICKETED", "RESOLVED"] as IssueStatus[]).map((x, i) => (
          <span key={x} className="issb-tri-step" data-on={st.status === x || undefined} data-past={["NEW", "TRIAGED", "TICKETED", "RESOLVED"].indexOf(st.status) > i || undefined}>
            {fx.status(x)}
          </span>
        ))}
        <span className="issb-tri-step ign" data-on={st.status === "IGNORED" || undefined}>
          {fx.status("IGNORED")}
        </span>
      </div>
      <div className="issb-tri-grid">
        <label className="field">
          <span>{t("triage.reason")}</span>
          <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={s("triage.reasonPlaceholder")} disabled={dis} />
        </label>
        <label className="field">
          <span>{t("triage.ticket")}</span>
          <input
            className={clsx("in", ticketErr && "bad")}
            value={ticket}
            onChange={(e) => setTicket(e.target.value.toUpperCase())}
            placeholder={s("triage.ticketPlaceholder")}
            disabled={dis}
            aria-invalid={ticketErr || undefined}
            aria-describedby={ticketErr ? "issb-ticket-err" : undefined}
          />
          {ticketErr ? (
            <small id="issb-ticket-err" className="issb-err">
              {s("triage.ticketRequired")}
            </small>
          ) : null}
        </label>
      </div>
      <div className="issb-tri-acts" title={perm.reason ?? undefined}>
        <span className="issb-tri-k">{t("triage.moveTo")}</span>
        {perm.next(st.status).map((n) => (
          <button key={n} type="button" className={clsx("btn sm", n === "TRIAGED" || n === "TICKETED" || n === "RESOLVED" ? "primary" : "")} data-to={n} disabled={dis} onClick={() => void move(n)}>
            {labels[n] ?? fx.status(n)} <span className="mono">→ {fx.status(n)}</span>
          </button>
        ))}
      </div>
      <div className="issb-tri-grid">
        <label className="field">
          <span>{t("triage.owner")}</span>
          <select className="in" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={dis}>
            <option value="">{s("triage.noOwner")}</option>
            {OPERATORS.filter((o) => o.role !== "Viewer").map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </label>
        <label className="field span2">
          <span>{t("triage.note")}</span>
          <textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} placeholder={s("triage.notePlaceholder")} disabled={dis} rows={2} />
        </label>
      </div>
      <div className="issb-tri-acts">
        <button type="button" className="btn sm" disabled={dis || ((owner || "") === (st.owner ?? "") && (note.trim() || "") === (st.note ?? ""))} onClick={save}>
          {t("triage.save")}
        </button>
      </div>

      <h4>{t("drawer.history")}</h4>
      {st.history.length ? (
        <ol className="issb-hist">
          {[...st.history].reverse().map((h, i) => (
            <li key={i}>
              <span className="mono muted">{fmt.dateTimeLabel(h.at)}</span>
              <span>
                <b>{h.by_name}</b> ·{" "}
                {t("triage.change", {
                  field: s.dynamic(`field.${h.field === "ticket_id" ? "ticket" : h.field}`, undefined, h.field),
                  from: h.field === "status" && h.from ? fx.status(h.from as IssueStatus) : (h.from ?? "—"),
                  to: h.field === "status" && h.to ? fx.status(h.to as IssueStatus) : (h.to ?? "—"),
                })}
                {h.reason ? <small> — {h.reason}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{t("drawer.noHistory")}</p>
      )}
    </section>
  );
}
