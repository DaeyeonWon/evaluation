"use client";
/**
 * Issue detail — triage panel: status lifecycle stepper, transitions, owner, ticket, note and the history
 * timeline. issues:write only (Viewer: disabled with the reason); a server 403 shows inline + as a toast.
 */
import clsx from "clsx";
import { Check, ClipboardList, History, KeyRound } from "lucide-react";
import { useRef, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import { ApiClientError } from "@/lib/client";
import { OPERATORS } from "@/lib/catalog";
import type { IssueDetail, IssuePatch, IssueStatus } from "@/lib/types";
import { useIssueActions, useIssuePermission, type IssueFormat } from "../../issues-shared";
import { Plate, opName, useToast } from "../../ui";

const FLOW: IssueStatus[] = ["NEW", "TRIAGED", "TICKETED", "RESOLVED"];
const TICKET_RE = /^[A-Z][A-Z0-9]+-\d+$/;

export function TriagePanel({ d, fx }: { d: IssueDetail; fx: IssueFormat }) {
  const t = useT("issuesDetail");
  const s = useT("issues");
  const fm = useFmt();
  const perm = useIssuePermission();
  const { patch, pending } = useIssueActions();
  const toast = useToast();
  const st = d.state;
  const [owner, setOwner] = useState(st.owner ?? "");
  const [ticket, setTicket] = useState(st.ticket_id ?? "");
  const [note, setNote] = useState(st.note ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<{ msg: string; forbidden?: boolean } | null>(null);
  const [synced, setSynced] = useState(`${d.id}:${st.updated_at}`);
  if (synced !== `${d.id}:${st.updated_at}`) {
    setSynced(`${d.id}:${st.updated_at}`);
    setOwner(st.owner ?? "");
    setTicket(st.ticket_id ?? "");
    setNote(st.note ?? "");
  }
  const ticketRef = useRef<HTMLInputElement>(null);
  const busy = pending === d.id;
  const dis = !perm.canWrite || busy;
  const title = fx.text(d.title);

  const send = async (body: IssuePatch) => {
    setErr(null);
    try {
      const r = await patch(d.id, body);
      toast.ok(body.status ? s("actions.updated", { id: title, status: fx.status(r.state.status) }) : s("actions.saved"));
      return r;
    } catch (e) {
      const forbidden = e instanceof ApiClientError && e.status === 403;
      setErr({ msg: forbidden ? t("triage.forbidden") : e instanceof Error ? e.message : String(e), forbidden });
      toast.err(e);
      return null;
    }
  };

  const nexts: IssueStatus[] = st.status === "NEW" ? ["TRIAGED", "TICKETED", "IGNORED"] : perm.next(st.status);
  const move = async (to: IssueStatus) => {
    if (to === "TICKETED" && !TICKET_RE.test(ticket.trim())) {
      setErr({ msg: s("triage.ticketRequired") });
      ticketRef.current?.focus();
      return;
    }
    const extra: IssuePatch = { ...(reason ? { reason } : {}), ...(to === "TICKETED" ? { ticket_id: ticket.trim() } : {}) };
    // NEW → TICKETED is not a server transition: triage first, then ticket
    if (to === "TICKETED" && st.status === "NEW") {
      const r = await send({ status: "TRIAGED", ...(reason ? { reason } : {}) });
      if (!r) return;
    }
    const r = await send({ ...extra, status: to });
    if (r) setReason("");
  };
  const dirty = (owner || null) !== st.owner || (note || null) !== st.note || ((ticket || null) !== st.ticket_id && st.status === "TICKETED");
  const save = () => {
    const body: IssuePatch = {};
    if ((owner || null) !== st.owner) body.owner = owner || null;
    if ((note || null) !== st.note) body.note = note || null;
    if ((ticket || null) !== st.ticket_id && st.status === "TICKETED") body.ticket_id = ticket || null;
    if (Object.keys(body).length) void send(body);
  };
  const curIdx = FLOW.indexOf(st.status);
  return (
    <Plate title={<><ClipboardList aria-hidden /> {t("triage.title")}</>} refText={st.updated_at ? t("triage.updated", { at: fm.dateTimeLabel(st.updated_at), by: opName(st.updated_by) }) : t("triage.never")} className="idt-tri">
      {!perm.canWrite ? (
        <div className="note warn idt-ro">
          <KeyRound aria-hidden /> {perm.reason}
        </div>
      ) : null}
      <ol className="idt-step" aria-label={t("triage.lifecycle")}>
        {FLOW.map((x, n) => {
          const state = st.status === "IGNORED" ? "off" : n < curIdx ? "done" : n === curIdx ? "cur" : "todo";
          return (
            <li key={x} data-state={state} data-st={x} aria-current={state === "cur" ? "step" : undefined} title={fx.statusHelp(x)}>
              <span className="idt-step-dot" aria-hidden>
                {state === "done" ? <Check /> : n + 1}
              </span>
              <span className="idt-step-l">{fx.status(x)}</span>
            </li>
          );
        })}
        {st.status === "IGNORED" ? (
          <li data-state="cur" data-st="IGNORED" aria-current="step" className="idt-step-ign">
            <span className="idt-step-dot" aria-hidden>
              ×
            </span>
            <span className="idt-step-l">{fx.status("IGNORED")}</span>
          </li>
        ) : null}
      </ol>
      <p className="muted idt-step-help">{fx.statusHelp(st.status)}</p>
      <div className="idt-tr-moves" role="group" aria-label={t("triage.moves")}>
        {nexts.map((x) => (
          <button key={x} type="button" className={clsx("btn sm", (x === "TRIAGED" || x === "TICKETED" || x === "RESOLVED") && "primary")} disabled={dis} title={perm.reason ?? fx.statusHelp(x)} onClick={() => void move(x)}>
            → {fx.status(x)}
          </button>
        ))}
      </div>
      <div className="idt-tr-grid">
        <label className="field">
          <span>{s("field.ticket")}</span>
          <input ref={ticketRef} className="in mono" value={ticket} onChange={(e) => setTicket(e.target.value.toUpperCase())} placeholder={s("triage.ticketPlaceholder")} disabled={!perm.canWrite} />
        </label>
        <label className="field">
          <span>{t("triage.reason")}</span>
          <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={s("triage.reasonPlaceholder")} disabled={!perm.canWrite} />
        </label>
        <label className="field">
          <span>{s("field.owner")}</span>
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
          <span>{s("field.note")}</span>
          <textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} placeholder={s("triage.notePlaceholder")} disabled={!perm.canWrite} rows={3} />
        </label>
      </div>
      {err ? (
        <div className={clsx("note", err.forbidden ? "bad" : "warn")} role="alert">
          {err.forbidden ? <KeyRound aria-hidden /> : null} {err.msg}
        </div>
      ) : null}
      <div className="idt-tr-save">
        <button type="button" className="btn sm primary" onClick={save} disabled={dis || !dirty} title={perm.reason ?? undefined}>
          {t("triage.save")}
        </button>
      </div>
      <h3 className="idt-h3">
        <History aria-hidden /> {t("triage.history")}
        <small className="mono muted">{st.history.length}</small>
      </h3>
      {st.history.length ? (
        <ol className="idt-hist">
          {[...st.history].reverse().map((h, n) => (
            <li key={n} data-field={h.field} data-to={h.field === "status" ? (h.to ?? undefined) : undefined}>
              <span className="idt-hist-dot" aria-hidden />
              <span className="mono muted idt-hist-at">{fm.dateTimeLabel(h.at)}</span>
              <span className="idt-hist-line">
                <b>{h.by_name}</b>{" "}
                {t("triage.historyLine", {
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
        <p className="muted">{t("triage.noHistory")}</p>
      )}
    </Plate>
  );
}
