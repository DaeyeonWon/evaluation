"use client";
/** Triage Deck — full-height side sheet: score anatomy, trend, breakdown, utterances, triage + history. */
import { SEVERITY_BANDS } from "@/lib/severity";
import clsx from "clsx";
import { ArrowUpRight, ChevronLeft, ChevronRight, CircleSlash, ExternalLink, GitCompareArrows, History, ListChecks, Maximize2, Workflow, X } from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EChart, LangBadge } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import { OPERATORS } from "@/lib/catalog";
import type { IssueDetail, IssueStatus } from "@/lib/types";
import { ModuleBadges, useIssue, useIssueLinks, useIssuePermission, useIssueTriage, useIssueViewLinks, type IssueFiltersApi, type IssueFormat } from "../../issues-shared";
import { axisX, axisY, baseOpt, opt } from "../../chart";
import { ErrorNote, Skeleton, opName, useReducedMotionSafe } from "../../ui";
import { ClsTag, StatusTag, useFactorNote, useGaugeLabel } from "./card";
import { MarketChip } from "./hero";
import { TypeBadge, type TriageState } from "./lens";
import { FACTOR_ORDER, Gauge, factorVar } from "./viz";

const BREAK_KEYS = ["division", "region", "bixby_version", "market", "language", "device", "model_version", "pipeline_version", "one_ui_version", "os_version"] as const;

/** both lens types side by side (the active lens first), with their reasons + must-handle */
function Types({ d, fx, ts }: { d: IssueDetail; fx: IssueFormat; ts: Pick<TriageState, "lens"> }) {
  const t = useT("issuesTriage");
  const user = (
    <li key="u" data-on={ts.lens === "user" || undefined}>
      <span className="ia-ty-k">{t("lens.user.title")}</span>
      <TypeBadge dim="user_impact" value={d.user_impact_type} fx={fx} />
      <p>{fx.text(d.type_reason?.user_impact)}</p>
    </li>
  );
  const dev = (
    <li key="d" data-on={ts.lens === "dev" || undefined}>
      <span className="ia-ty-k">{t("lens.dev.title")}</span>
      <TypeBadge dim="dev_miss" value={d.dev_miss_type} fx={fx} />
      <p>{fx.text(d.type_reason?.dev_miss)}</p>
      <p className="ia-mh" data-mh={String(d.must_handle)}>
        <span className="ia-mh-tag">
          {d.must_handle ? <ListChecks aria-hidden /> : <CircleSlash aria-hidden />}
          {fx.t.dynamic(`mustHandleValue.${d.must_handle}`, undefined, String(d.must_handle))}
        </span>
        {fx.text(d.must_handle_reason)}
      </p>
    </li>
  );
  return (
    <section className="ia-sec">
      <h4>
        {t("sheet.types")}{" "}
        <span className="mono muted">
          {fx.column("category")} · {fx.value("category", d.category)}
        </span>
      </h4>
      <ul className="ia-types">{ts.lens === "dev" ? [dev, user] : [user, dev]}</ul>
      {d.category_reason ? <p className="muted ia-cat-r">{fx.text(d.category_reason)}</p> : null}
    </section>
  );
}

function Anatomy({ d, fx }: { d: IssueDetail; fx: IssueFormat }) {
  const t = useT("issuesTriage");
  const note = useFactorNote(fx);
  const rows = FACTOR_ORDER.map((k) => d.factors.find((f) => f.key === k)).filter((f): f is NonNullable<typeof f> => !!f);
  return (
    <section className="ia-sec">
      <h4>
        {t("sheet.anatomy")} <span className="mono muted">{t("sheet.anatomySub", { score: fx.score(d.score) })}</span>
      </h4>
      <div className="ia-anat-bar" role="img" aria-label={rows.map((f) => `${fx.factor(f.key)} ${f.contribution}`).join(", ")}>
        {rows.map((f) => (
          <i key={f.key} style={{ width: `${f.contribution}%`, ["--fc" as string]: factorVar(f.key) } as CSSProperties} title={`${fx.factor(f.key)} ${f.contribution}`} />
        ))}
        {SEVERITY_BANDS.map((b) => (
          <b key={b.at} style={{ left: `${b.at}%` }} data-l={b.sev} />
        ))}
      </div>
      <ul className="ia-anat">
        {rows.map((f) => (
          <li key={f.key} style={{ ["--fc" as string]: factorVar(f.key) } as CSSProperties}>
            <span className="ia-an-k">
              <i />
              <b>{fx.factor(f.key)}</b>
              <small className="mono">{t("sheet.weight", { w: f.weight })}</small>
            </span>
            <span className="ia-an-bar" aria-hidden>
              <span style={{ width: `${f.value * 100}%` }} />
            </span>
            <span className="ia-an-pts mono">
              {f.contribution.toFixed(1)}
              <small>/{f.weight}</small>
            </span>
            <span className="ia-an-help">{fx.factorHelp(f.key)}</span>
            {note(f) ? <span className="ia-an-note" data-miss={f.key === "regression" && f.contribution === 0 ? "" : undefined}>{note(f)}</span> : null}
            <span className="ia-an-raw mono">
              {Object.entries(f.detail)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Breakdown({ d, fx }: { d: IssueDetail; fx: IssueFormat }) {
  const t = useT("issuesTriage");
  const fm = useFmt();
  const [k, setK] = useState<(typeof BREAK_KEYS)[number]>("division");
  const keys = BREAK_KEYS.filter((b) => Array.isArray(d.breakdown[b]));
  const rows = d.breakdown[k] ?? [];
  const max = Math.max(1, ...rows.map((r) => r.fails));
  return (
    <section className="ia-sec">
      <h4>{t("sheet.breakdown")}</h4>
      <div className="att-tabs" role="group" aria-label={t("sheet.breakdown")}>
        {keys.map((b) => (
          <button key={b} type="button" aria-pressed={k === b} onClick={() => setK(b)}>
            {fx.column(b)}
          </button>
        ))}
      </div>
      <ul className="ia-brk">
        {rows.map((r) => (
          <li key={r.value}>
            <span className="ia-brk-l">{k === "market" ? <MarketChip m={r.value} /> : k === "language" ? <LangBadge lang={r.value as never} /> : null}{fx.value(k, r.value)}</span>
            <span className="ia-brk-bar" aria-hidden>
              <span style={{ width: `${(r.fails / max) * 100}%` }} />
            </span>
            <span className="mono">{fm.number(r.fails)}</span>
            <span className="mono">{fx.pct(r.fail_rate)}</span>
            <span className="mono ia-dv" data-dir={r.delta == null ? "flat" : r.delta > 0.5 ? "up" : r.delta < -0.5 ? "down" : "flat"}>
              {r.delta == null ? "—" : fx.pp(r.delta)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Triage({ d, fx, focusTicket }: { d: IssueDetail; fx: IssueFormat; focusTicket: boolean }) {
  const t = useT("issuesTriage");
  const s = useT("issues");
  const fm = useFmt();
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const st = d.state;
  const [owner, setOwner] = useState(st.owner ?? "");
  const [ticket, setTicket] = useState(st.ticket_id ?? "");
  const [note, setNote] = useState(st.note ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [synced, setSynced] = useState(st.updated_at);
  if (synced !== st.updated_at) {
    setSynced(st.updated_at);
    setOwner(st.owner ?? "");
    setTicket(st.ticket_id ?? "");
    setNote(st.note ?? "");
  }
  const ticketRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusTicket) return;
    boxRef.current?.scrollIntoView({ block: "center" });
    ticketRef.current?.focus();
  }, [focusTicket, d.id]);
  const dis = !perm.canWrite || tri.pending === d.id;
  const nexts: IssueStatus[] = st.status === "NEW" ? ["TRIAGED", "TICKETED", "IGNORED"] : perm.next(st.status);
  const move = async (to: IssueStatus) => {
    setErr(null);
    if (to === "TICKETED" && !/^[A-Z][A-Z0-9]+-\d+$/.test(ticket.trim())) {
      setErr(s("triage.ticketRequired"));
      ticketRef.current?.focus();
      return;
    }
    const extra = { ...(reason ? { reason } : {}), ...(to === "TICKETED" ? { ticket_id: ticket.trim() } : {}) };
    // NEW → TICKETED is not a server transition: triage first, then ticket
    if (to === "TICKETED" && st.status === "NEW") {
      const r = await tri.setStatus(d, "TRIAGED", reason ? { reason } : {});
      if (!r) return;
    }
    const r = await tri.setStatus(d, to, extra);
    if (r) setReason("");
  };
  const save = () => {
    const body: { owner?: string | null; note?: string | null; ticket_id?: string | null } = {};
    if ((owner || null) !== st.owner) body.owner = owner || null;
    if ((note || null) !== st.note) body.note = note || null;
    if ((ticket || null) !== st.ticket_id && st.status === "TICKETED") body.ticket_id = ticket || null;
    if (Object.keys(body).length) void tri.update(d.id, body);
  };
  return (
    <section className="ia-sec ia-triage" ref={boxRef}>
      <h4>{t("sheet.triage")}</h4>
      {!perm.canWrite ? <div className="note warn">{perm.reason}</div> : null}
      <div className="ia-flow" aria-label={t("sheet.transition")}>
        {(["NEW", "TRIAGED", "TICKETED", "RESOLVED"] as IssueStatus[]).map((x, n) => (
          <span key={x} className={clsx("ia-flow-s", x === st.status && "cur")} data-st={x}>
            {n ? <i aria-hidden /> : null}
            {fx.status(x)}
          </span>
        ))}
        {st.status === "IGNORED" ? (
          <span className="ia-flow-s cur" data-st="IGNORED">
            {fx.status("IGNORED")}
          </span>
        ) : null}
      </div>
      <div className="ia-tr-grid">
        <label className="field">
          <span>{t("sheet.ticketLabel")}</span>
          <input ref={ticketRef} className="in mono" value={ticket} onChange={(e) => setTicket(e.target.value.toUpperCase())} placeholder={s("triage.ticketPlaceholder")} disabled={!perm.canWrite} />
        </label>
        <label className="field">
          <span>{t("sheet.reasonLabel")}</span>
          <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={s("triage.reasonPlaceholder")} disabled={!perm.canWrite} />
        </label>
      </div>
      <div className="ia-tr-moves">
        <span className="ia-tr-h">{t("sheet.transition")}</span>
        {nexts.map((x) => (
          <button key={x} type="button" className={clsx("btn sm", x === "TICKETED" || x === "TRIAGED" ? "primary" : x === "IGNORED" ? "" : "")} disabled={dis} title={perm.reason ?? fx.statusHelp(x)} onClick={() => void move(x)}>
            → {fx.status(x)}
          </button>
        ))}
      </div>
      {err ? <div className="note bad">{err}</div> : null}
      <div className="ia-tr-grid">
        <label className="field">
          <span>{t("sheet.ownerLabel")}</span>
          <select className="in" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!perm.canWrite}>
            <option value="">{s("triage.noOwner")}</option>
            {OPERATORS.filter((o) => o.role !== "Viewer").map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </label>
        <label className="field span2">
          <span>{t("sheet.noteLabel")}</span>
          <textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} placeholder={s("triage.notePlaceholder")} disabled={!perm.canWrite} rows={2} />
        </label>
      </div>
      <div className="ia-tr-save">
        <button type="button" className="btn sm primary" onClick={save} disabled={dis} title={perm.reason ?? undefined}>
          {t("sheet.save")}
        </button>
      </div>
      <h4>
        <History aria-hidden /> {t("sheet.history")}
      </h4>
      {st.history.length ? (
        <ol className="ia-hist">
          {[...st.history].reverse().map((h, n) => (
            <li key={n} data-field={h.field}>
              <span className="mono muted">{fm.dateTimeLabel(h.at)}</span>
              <span>
                <b>{h.by_name}</b>{" "}
                {t("sheet.historyLine", {
                  field: s.dynamic(`field.${h.field === "ticket_id" ? "ticket" : h.field}`, undefined, h.field),
                  from: h.field === "status" && h.from ? fx.status(h.from as IssueStatus) : h.field === "owner" ? opName(h.from) : (h.from ?? "—"),
                  to: h.field === "status" && h.to ? fx.status(h.to as IssueStatus) : h.field === "owner" ? opName(h.to) : (h.to ?? "—"),
                })}
                {h.reason ? <em> — {h.reason}</em> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{t("sheet.noHistory")}</p>
      )}
    </section>
  );
}

export function IssueSheet({ id, f, fx, ids, focusTicket, onClose, ts }: { id: string; f: IssueFiltersApi; fx: IssueFormat; ids: string[]; focusTicket: boolean; onClose: () => void; ts: Pick<TriageState, "lens"> }) {
  const t = useT("issuesTriage");
  const V = useIssueViewLinks();
  const s = useT("issues");
  const fm = useFmt();
  const L = useIssueLinks();
  const reduced = useReducedMotionSafe();
  const gl = useGaugeLabel(fx);
  const [page, setPage] = useState(1);
  const [pid, setPid] = useState(id);
  if (pid !== id) {
    setPid(id);
    setPage(1);
  }
  const q = useIssue(id, f, { page, pageSize: 10 });
  const d = q.data && q.data.id === id ? q.data : undefined;
  const at = ids.indexOf(id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const pages = d ? Math.max(1, Math.ceil(d.utterances.total / d.utterances.pageSize)) : 1;
  const bucket = d ? s(`bucket.${d.trend.bucket}`) : "";
  const lbl = (ts: number) => (d?.trend.bucket === "hour" ? fm.hm(ts) : fm.dateLabel(ts));
  return (
    <>
      <motion.div className="scrim" style={{ padding: 0 }} onClick={onClose} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer ia-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("sheet.aria")}
        initial={reduced ? false : { x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { x: 60, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        data-sev={d?.severity}
      >
        <div className="dlg-head">
          <div style={{ minWidth: 0 }}>
            <div className="mono muted ia-eyebrow">
              ISSUE · {id}
              {d ? ` · #${d.rank}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <Link className="btn sm primary ia-full" href={V.issueHref(id)}>
              <Maximize2 aria-hidden /> {t("sheet.full")}
            </Link>
            <button type="button" className="btn icon" disabled={at <= 0} onClick={() => f.select(ids[at - 1])} aria-label={t("sheet.prev")}>
              <ChevronLeft aria-hidden />
            </button>
            <button type="button" className="btn icon" disabled={at < 0 || at >= ids.length - 1} onClick={() => f.select(ids[at + 1])} aria-label={t("sheet.next")}>
              <ChevronRight aria-hidden />
            </button>
            <button type="button" className="btn icon" onClick={onClose} aria-label={t("sheet.close")}>
              <X aria-hidden />
            </button>
          </div>
        </div>
        <div className="dlg-body ia-sheet-body">
          {!d ? (
            q.error ? (
              <ErrorNote error={q.error} />
            ) : (
              <Skeleton rows={10} />
            )
          ) : (
            <>
              <header className="ia-sh-hero">
                <Gauge score={d.score} factors={d.factors} size={148} stroke={13} label={gl(d)} sev={d.severity} />
                <div className="ia-sh-h">
                  <div className="ia-c-top">
                    <span className="iss-sev" data-sev={d.severity} title={fx.severityHelp(d.severity)}>
                      {d.severity}
                    </span>
                    <ClsTag c={d.severity_class} fx={fx} />
                    {d.novelty === "new" ? <span className="ia-new">{fx.value("novelty", "new")}</span> : null}
                    <StatusTag s={d.state.status} fx={fx} />
                    <ModuleBadges feature="triage.quicklook" />
                  </div>
                  <h2>{fx.text(d.title)}</h2>
                  <div className="ia-sig mono">
                    <span>{fx.fn(d.signature.agent_function)}</span>
                    <span className="sep">·</span>
                    <span>{d.signature.intent_expected}</span>
                    {d.signature.intent_predicted !== d.signature.intent_expected ? (
                      <>
                        <span className="ia-arrow">→</span>
                        <span className="bad">{d.signature.intent_predicted}</span>
                      </>
                    ) : null}
                    <span className="sep">·</span>
                    <span>{fx.reason(d.signature.failure_reason)}</span>
                  </div>
                  <dl className="ia-sh-kv">
                    <div>
                      <dt>{s("field.count")}</dt>
                      <dd className="mono">{fm.number(d.count)}</dd>
                    </div>
                    <div>
                      <dt>{s("field.failRate")}</dt>
                      <dd className="mono">{fx.pct(d.fail_rate)}</dd>
                    </div>
                    <div>
                      <dt>{s("field.delta")}</dt>
                      <dd className={clsx("mono", (d.delta ?? 0) > 0 && "bad")}>{fx.pp(d.delta)}</dd>
                    </div>
                    <div>
                      <dt>{s("field.share")}</dt>
                      <dd className="mono">{fx.pct(d.share)}</dd>
                    </div>
                  </dl>
                  <div className="mono muted ia-span">{t("sheet.span", { first: fm.dateTimeLabel(d.first_seen), last: fm.dateTimeLabel(d.last_seen) })}</div>
                  <div className="ia-sh-links">
                    <Link className="btn sm" href={L.results(d)}>
                      {s("actions.openResults")} <ArrowUpRight aria-hidden />
                    </Link>
                  </div>
                </div>
              </header>
              {d.bixby_regression ? (
                <div className="note warn ia-regnote">
                  <GitCompareArrows aria-hidden />{" "}
                  {fx.t("reasons.bixbyRegression", {
                    current: d.bixby_regression.current,
                    previous: d.bixby_regression.previous,
                    curRate: d.bixby_regression.currentRate,
                    prevRate: d.bixby_regression.previousRate,
                    division: fx.value("division", d.bixby_regression.division),
                  })}
                </div>
              ) : null}
              {d.regression ? (
                <div className="note warn ia-regnote">
                  <GitCompareArrows aria-hidden />{" "}
                  {t("sheet.regression", {
                    axis: fx.column(d.regression.axis),
                    current: d.regression.current,
                    curRate: fx.pct(d.regression.currentRate),
                    previous: d.regression.previous,
                    prevRate: fx.pct(d.regression.previousRate),
                  })}
                </div>
              ) : null}
              <Types d={d} fx={fx} ts={ts} />
              <section className="ia-sec">
                <h4>{t("sheet.reasons")}</h4>
                <ol className="ia-reasons">
                  {d.reasons.map((r, n) => (
                    <li key={n}>{fx.text(r)}</li>
                  ))}
                </ol>
              </section>
              <Anatomy d={d} fx={fx} />
              <section className="ia-sec">
                <h4>{t("sheet.trend", { bucket })}</h4>
                <EChart
                  className="ia-sh-chart"
                  ariaLabel={t("sheet.trend", { bucket })}
                  option={(tk) =>
                    opt(
                      baseOpt(tk, reduced, {
                        grid: { left: 34, right: 10, top: 12, bottom: 24 },
                        legend: { show: false },
                        tooltip: {
                          trigger: "axis",
                          backgroundColor: tk.tooltipBg,
                          borderColor: tk.read("--rule"),
                          textStyle: { color: tk.text, fontSize: 12, fontFamily: tk.font },
                          formatter: (ps: { dataIndex: number }[]) => {
                            const p = d.trend.points[ps[0]?.dataIndex ?? 0];
                            return p ? `${lbl(p.t)}<br/>FAIL <b>${p.fails}</b> / ${p.total}<br/>${t("sheet.rateLabel")} ${fx.pct(p.fail_rate)}` : "";
                          },
                        },
                        xAxis: axisX(tk, d.trend.points.map((p) => lbl(p.t)), { boundaryGap: true }),
                        yAxis: axisY(tk, { minInterval: 1 }),
                        series: [
                          {
                            type: "bar",
                            name: t("sheet.failsSeries"),
                            barMaxWidth: 18,
                            itemStyle: { color: tk.read(`--sev-${d.severity.toLowerCase()}`), borderRadius: [3, 3, 0, 0] },
                            data: d.trend.points.map((p) => p.fails),
                          },
                        ],
                      }),
                    )
                  }
                />
              </section>
              <Breakdown d={d} fx={fx} />
              <section className="ia-sec">
                <h4>
                  {t("sheet.utterances", { n: fm.number(d.utterances.total) })}
                  <Link href={L.results(d)} className="ia-h-lnk">
                    {s("actions.openResults")} <ExternalLink aria-hidden />
                  </Link>
                </h4>
                <ul className="ia-utts">
                  {d.utterances.items.map((u) => (
                    <li key={u.utterance_id} style={{ ["--lc" as string]: `var(--lang-${u.language})` } as CSSProperties}>
                      <div className="ia-u-top">
                        <LangBadge lang={u.language} />
                        <MarketChip m={u.market} />
                        <span className="mono muted">{u.device_type}</span>
                        <span className="mono muted">· {u.model_version}</span>
                        <Link href={L.utterance(u.utterance_id)} className="ia-u-id mono">
                          {u.utterance_id.slice(-12)} <ArrowUpRight aria-hidden />
                        </Link>
                      </div>
                      <q className="ia-u-text">{u.utterance_text}</q>
                      {u.asr_text !== u.utterance_text ? (
                        <div className="ia-u-asr">
                          <span className="mono">ASR</span> {u.asr_text}
                        </div>
                      ) : null}
                      <div className="ia-u-int mono">
                        {u.intent_expected}
                        {u.intent_predicted !== u.intent_expected ? (
                          <>
                            {" "}
                            <span className="ia-arrow">→</span> <span className="bad">{u.intent_predicted}</span>
                          </>
                        ) : null}
                        <span className="muted"> · judge {u.judge_score.toFixed(2)}</span>
                      </div>
                      <div className="ia-u-judge">{u.judge_reason}</div>
                    </li>
                  ))}
                </ul>
                {pages > 1 ? (
                  <div className="ia-pager">
                    <button type="button" className="btn sm icon" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("deck.prev")}>
                      <ChevronLeft aria-hidden />
                    </button>
                    <span className="mono">{t("sheet.page", { page, pages })}</span>
                    <button type="button" className="btn sm icon" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={t("deck.next")}>
                      <ChevronRight aria-hidden />
                    </button>
                  </div>
                ) : null}
              </section>
              <Triage d={d} fx={fx} focusTicket={focusTicket} />
              <section className="ia-sec">
                <h4>
                  <Workflow aria-hidden /> {t("sheet.workflows")}
                </h4>
                {d.workflows.length ? (
                  <ul className="ia-wfs">
                    {d.workflows.map((w) => (
                      <li key={w.workflow_id}>
                        <Link href={L.workflow(w.workflow_id, w.created_at, w.completed_at)} className="mono">
                          {w.workflow_id}
                        </Link>
                        <LangBadge lang={w.language} />
                        <span className="mono muted">
                          {w.pipeline_version} · {w.model_version}
                        </span>
                        <span className="mono bad">{t("sheet.fails", { n: w.fails })}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{t("sheet.noWorkflows")}</p>
                )}
              </section>
              {d.similar.length ? (
                <section className="ia-sec">
                  <h4>{t("sheet.similar")}</h4>
                  <ul className="ia-sim">
                    {d.similar.map((x) => (
                      <li key={x.id}>
                        <button type="button" onClick={() => f.select(x.id)}>
                          <span className="iss-sev" data-sev={x.severity}>
                            {x.severity}
                          </span>
                          <span className="ia-sim-t">{fx.text(x.title)}</span>
                          <span className="mono muted">{s.dynamic(`relation.${x.relation}`, undefined, x.relation)}</span>
                          <b className="mono">{fx.score(x.score)}</b>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </motion.aside>
    </>
  );
}
