"use client";
/**
 * Signal Lab — split detail pane for ?issue=<id> (R1 anatomy, R6 drill-down, R7 triage).
 * Score anatomy waterfall · why flagged · trend vs baseline · breakdown with baseline notches ·
 * utterances with expected↔predicted / text↔ASR diff · workflows · similar · triage lifecycle.
 */
import clsx from "clsx";
import { ArrowUpRight, ChevronLeft, ChevronRight, ExternalLink, History, Lock, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { EChart, LangBadge, type ChartTokens } from "@/components/shared";
import { deviceLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { OPERATORS } from "@/lib/catalog";
import { SEVERITY_BANDS } from "@/lib/severity";
import type { IssueDetail, IssueFactor, IssueStatus, ResultRow } from "@/lib/types";
import { axisX, axisY, opt, tooltip } from "../../chart";
import { ModuleBadges, useDimLabel, useIssue, useIssueFormat, useIssueLinks, useIssueViewLinks, useIssuePermission, useIssueTriage, type IssueFiltersApi } from "../../issues-shared";
import { ErrorNote, Skeleton, useReducedMotionSafe } from "../../ui";
import { FACTOR_KEYS, deltaDir, intentDiff, wordDiff } from "./lab";
import { StatusPill } from "./table";

/* ───────── score anatomy waterfall ───────── */
const TIERS = SEVERITY_BANDS;

function detailText(fct: IssueFactor): string {
  return Object.entries(fct.detail)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
}

function Waterfall({ d }: { d: IssueDetail }) {
  const t = useT("issuesAnalysis");
  const fx = useIssueFormat();
  const order = FACTOR_KEYS.map((k) => d.factors.find((x) => x.key === k)).filter(Boolean) as IssueFactor[];
  const starts = order.map((_, i) => order.slice(0, i).reduce((a, x) => a + x.contribution, 0));
  return (
    <div className="lab-wf" role="table" aria-label={t("detail.anatomy")}>
      <div className="lab-wf-axis" aria-hidden>
        {TIERS.map((x) => (
          <span key={x.at} className="lab-wf-tier" style={{ left: `${x.at}%` }} data-sev={x.sev}>
            {x.sev} ≥{x.at}
          </span>
        ))}
      </div>
      {order.map((fct, i) => {
        const start = starts[i];
        return (
          <div key={fct.key} className="lab-wf-row" role="row" style={{ ["--i" as string]: i }} title={`${fx.factorHelp(fct.key)}\n${detailText(fct)}`}>
            <span className="lab-wf-k" role="rowheader">
              {fx.factor(fct.key)}
              <small className="mono">×{fct.weight}</small>
            </span>
            <span className="lab-wf-track" role="cell">
              {TIERS.map((x) => (
                <i key={x.at} className="lab-wf-gl" style={{ left: `${x.at}%` }} />
              ))}
              <i className="lab-wf-ghost" style={{ left: `${start}%`, width: `${fct.weight}%` }} />
              <i className={clsx("lab-wf-bar", fct.contribution === 0 && "zero")} data-k={fct.key} data-cls={fct.key === "severity" ? d.severity_class : undefined} style={{ left: `${start}%`, width: `${Math.max(fct.contribution, 0.4)}%` }} />
            </span>
            <span className="lab-wf-v mono" role="cell">
              +{fct.contribution.toFixed(1)}
            </span>
          </div>
        );
      })}
      <div className="lab-wf-row total" role="row">
        <span className="lab-wf-k" role="rowheader">
          {t("detail.score")}
        </span>
        <span className="lab-wf-track" role="cell">
          {TIERS.map((x) => (
            <i key={x.at} className="lab-wf-gl" style={{ left: `${x.at}%` }} />
          ))}
          <i className="lab-wf-bar sum" data-sev={d.severity} style={{ left: 0, width: `${d.score}%` }} />
        </span>
        <span className="lab-wf-v mono" role="cell">
          <b>{fx.score(d.score)}</b>
        </span>
      </div>
      <p className="lab-cap">{t("detail.anatomyCap")}</p>
    </div>
  );
}

/* ───────── trend ───────── */
function Trend({ d }: { d: IssueDetail }) {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const fm = useFmt();
  const reduced = useReducedMotionSafe();
  const hourly = d.trend.bucket === "hour";
  const option = useCallback(
    (tk: ChartTokens) => {
      const pts = d.trend.points;
      const labels = pts.map((p) => (hourly ? fm.hm(p.t) : fm.dateLabel(p.t)));
      const sev = tk.read(`--sev-${d.severity.toLowerCase()}`);
      return opt({
        animationDuration: reduced ? 0 : 600,
        textStyle: { fontFamily: tk.font, color: tk.muted },
        grid: { left: 36, right: 12, top: 18, bottom: 22 },
        tooltip: tooltip(tk, {
          formatter: (ps: { dataIndex: number }[]) => {
            const p = pts[ps[0]?.dataIndex ?? 0];
            return p ? `${labels[ps[0].dataIndex]}<br/>${s("field.failRate")} <b>${p.fail_rate == null ? "—" : p.fail_rate + "%"}</b><br/><span style="font-family:${tk.mono};font-size:11px">FAIL ${p.fails} / ${p.total}</span>` : "";
          },
        }),
        xAxis: axisX(tk, labels, { axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, hideOverlap: true } }),
        yAxis: axisY(tk, { axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, formatter: "{value}%" } }),
        series: [
          {
            type: "line",
            name: s("field.failRate"),
            data: pts.map((p) => p.fail_rate),
            connectNulls: false,
            color: sev,
            lineStyle: { width: 2 },
            symbol: "circle",
            symbolSize: 6,
            areaStyle: { color: sev, opacity: 0.1 },
            markLine:
              d.baseline_rate != null
                ? { silent: true, symbol: "none", lineStyle: { type: "dashed", color: tk.muted }, label: { formatter: t("detail.baselineLine", { rate: d.baseline_rate }), color: tk.muted, fontSize: 10, position: "insideEndTop" }, data: [{ yAxis: d.baseline_rate }] }
                : undefined,
          },
        ],
      });
    },
    [d, hourly, fm, reduced, s, t],
  );
  return <EChart className="lab-dtrend" option={option} ariaLabel={t("detail.trend")} />;
}

/* ───────── breakdown ───────── */
type BK = keyof IssueDetail["breakdown"];
const BKEYS: BK[] = ["division", "region", "bixby_version", "market", "language", "device", "model_version", "pipeline_version"];

function Breakdown({ d }: { d: IssueDetail }) {
  const fx = useIssueFormat();
  const dl = useDimLabel();
  const [k, setK] = useState<BK>("division");
  const keys = BKEYS.filter((x) => Array.isArray(d.breakdown[x]));
  const rows = d.breakdown[k] ?? [];
  const max = Math.max(10, ...rows.map((r) => Math.max(r.fail_rate, r.baseline_fail_rate ?? 0)));
  const lab = (v: string) => dl.value(k, v);
  return (
    <div className="lab-bd">
      <div className="lab-tabs" role="tablist">
        {keys.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={k === x} onClick={() => setK(x)}>
            {dl.dim(x)}
          </button>
        ))}
      </div>
      <ul className="lab-bd-list">
        {rows.map((r) => (
          <li key={r.value}>
            <span className="lab-bd-v">{lab(r.value)}</span>
            <span className="lab-bd-track" title={`${fx.pct(r.fail_rate)} · baseline ${fx.pct(r.baseline_fail_rate)}`}>
              <i className="lab-bd-fill" style={{ width: `${(r.fail_rate / max) * 100}%` }} />
              {r.baseline_fail_rate != null ? <i className="lab-bd-notch" style={{ left: `${(r.baseline_fail_rate / max) * 100}%` }} /> : null}
            </span>
            <span className="mono lab-bd-r">{fx.pct(r.fail_rate)}</span>
            <span className="mono lab-bd-d lab-delta" data-dir={deltaDir(r.delta)}>
              {r.delta == null ? "—" : fx.pp(r.delta)}
            </span>
            <span className="mono muted lab-bd-n">
              {r.fails}/{r.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── utterances ───────── */
function Diff({ a, b }: { a: string; b: string }) {
  const toks = wordDiff(a, b);
  return (
    <span className="lab-diff">
      {toks.map((x, i) =>
        x.op === "same" ? (
          <span key={i}>{x.t} </span>
        ) : x.op === "del" ? (
          <del key={i}>{x.t}</del>
        ) : (
          <ins key={i}>{x.t}</ins>
        ),
      )}
    </span>
  );
}

function Utterance({ r }: { r: ResultRow }) {
  const s = useT("issues");
  const t = useT("issuesAnalysis");
  const fx = useIssueFormat();
  const L = useIssueLinks();
  const locale = useLocale();
  const id = intentDiff(r.intent_expected, r.intent_predicted);
  const asrDiffers = r.asr_text !== r.utterance_text;
  return (
    <li className={clsx("lab-utt", r.result === "FAIL" && "fail")}>
      <div className="lab-utt-h">
        <span className={clsx("lab-res", r.result === "FAIL" && "fail")}>{r.result}</span>
        <LangBadge lang={r.language} />
        <span className="mono muted">
          {r.market} · {deviceLabel(r.device_type, locale)} · {r.model_version.replace("bixby-nlu-", "")} · {r.pipeline_version}
        </span>
        <Link className="lab-utt-open" href={L.utterance(r.utterance_id)} aria-label={t("detail.openUtterance", { id: r.utterance_id })}>
          <ExternalLink aria-hidden />
        </Link>
      </div>
      <p className="lab-utt-t">“{r.utterance_text}”</p>
      {asrDiffers ? (
        <p className="lab-utt-asr">
          <span className="lab-utt-k">ASR</span> <Diff a={r.utterance_text} b={r.asr_text} />
        </p>
      ) : null}
      <p className="lab-utt-int mono">
        <span className="lab-utt-k">{s("field.expected")}</span> {id.common}
        <span className="lab-exp">{id.exp}</span>
        {id.pred ? (
          <>
            {"  →  "}
            <span className="lab-utt-k">{s("field.predicted")}</span> {id.common}
            <span className="lab-pred">{id.pred}</span>
          </>
        ) : (
          <span className="muted"> = {s("field.predicted")}</span>
        )}
      </p>
      {r.result === "FAIL" ? (
        <>
          <p className="lab-utt-resp">
            <span className="lab-utt-k">{s("field.actualResponse")}</span> {r.actual_response || "—"}
          </p>
          <p className="lab-utt-judge">
            <span className="lab-utt-k">{s("field.judgeReason")}</span> {r.judge_reason} <span className="mono muted">({r.judge_score.toFixed(2)} · {r.failure_reason ? fx.reason(r.failure_reason) : ""})</span>
          </p>
        </>
      ) : null}
    </li>
  );
}

/* ───────── triage ───────── */
const LIFECYCLE: IssueStatus[] = ["NEW", "TRIAGED", "TICKETED", "RESOLVED"];

function Triage({ d }: { d: IssueDetail }) {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const st = d.state;
  const [ticket, setTicket] = useState(st.ticket_id ?? "");
  const [note, setNote] = useState(st.note ?? "");
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState(st.owner ?? "");
  const busy = tri.pending === d.id;
  const ro = !perm.canWrite;
  const ticketOk = /^[A-Z][A-Z0-9]+-\d+$/.test(ticket.trim());
  const next = perm.next(st.status);
  const idx = LIFECYCLE.indexOf(st.status);

  const go = async (to: IssueStatus) => {
    const extra: { reason?: string; ticket_id?: string } = {};
    if (reason.trim()) extra.reason = reason.trim();
    if (to === "TICKETED") extra.ticket_id = ticket.trim();
    const r = await tri.setStatus(d, to, extra);
    if (r) setReason("");
  };
  const label = (to: IssueStatus) =>
    to === "TRIAGED" ? (st.status === "NEW" ? s("actions.triage") : fx.status("TRIAGED")) : to === "TICKETED" ? s("actions.ticket") : to === "RESOLVED" ? s("actions.resolve") : to === "IGNORED" ? s("actions.ignore") : st.status === "TRIAGED" ? s("actions.untriage") : s("actions.reopen");

  return (
    <div className="lab-tri">
      <ol className="lab-life" aria-label={t("detail.lifecycle")}>
        {LIFECYCLE.map((x, i) => (
          <li key={x} data-state={st.status === "IGNORED" ? "off" : i < idx ? "done" : i === idx ? "cur" : "todo"}>
            <i aria-hidden />
            <span>{fx.status(x)}</span>
          </li>
        ))}
        <li className="lab-life-ign" data-state={st.status === "IGNORED" ? "cur" : "todo"}>
          <i aria-hidden />
          <span>{fx.status("IGNORED")}</span>
        </li>
      </ol>
      {ro ? (
        <div className="note warn">
          <Lock aria-hidden /> {perm.reason}
        </div>
      ) : null}
      <div className="lab-tri-grid">
        <label className="field">
          <span>{s("field.owner")}</span>
          <select className="in" value={owner} disabled={ro || busy} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{s("triage.noOwner")}</option>
            {OPERATORS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </label>
        <div className="lab-tri-save">
          <button type="button" className="btn sm" disabled={ro || busy || owner === (st.owner ?? "")} onClick={() => tri.update(d.id, { owner: owner || null })}>
            {owner ? s("actions.assign") : s("actions.unassign")}
          </button>
        </div>
        <label className="field">
          <span>{s("field.ticket")}</span>
          <input className="in mono" value={ticket} disabled={ro || busy} placeholder={s("triage.ticketPlaceholder")} onChange={(e) => setTicket(e.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span>{t("detail.reason")}</span>
          <input className="in" value={reason} disabled={ro || busy} placeholder={s("triage.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="lab-tri-acts">
        {next.map((to) => {
          const needTicket = to === "TICKETED" && !ticketOk;
          return (
            <button
              key={to}
              type="button"
              className={clsx("btn sm", to === "TRIAGED" || to === "TICKETED" || to === "RESOLVED" ? "primary" : "")}
              disabled={ro || busy || needTicket}
              title={needTicket ? s("triage.ticketRequired") : fx.statusHelp(to)}
              onClick={() => go(to)}
            >
              {label(to)} <span className="mono lab-arrow">→ {fx.status(to)}</span>
            </button>
          );
        })}
      </div>
      {next.includes("TICKETED") && !ticketOk ? <p className="lab-cap">{s("triage.ticketRequired")}</p> : null}
      <label className="field">
        <span>{s("field.note")}</span>
        <textarea className="in" value={note} disabled={ro || busy} placeholder={s("triage.notePlaceholder")} onChange={(e) => setNote(e.target.value)} rows={2} />
      </label>
      <div>
        <button type="button" className="btn sm" disabled={ro || busy || note === (st.note ?? "")} onClick={() => tri.update(d.id, { note: note || null })}>
          {s("actions.saveNote")}
        </button>
      </div>
      {st.history.length ? (
        <div className="lab-hist">
          <div className="lab-sub">
            <History aria-hidden /> {s("field.history")}
          </div>
          <ol>
            {[...st.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="mono muted">{fm.dateTimeLabel(h.at)}</span>
                <b>{h.by_name}</b>
                <span>
                  {s(`field.${h.field === "ticket_id" ? "ticket" : h.field}`)}: <span className="mono">{h.field === "status" && h.from ? fx.status(h.from as IssueStatus) : (h.from ?? "—")}</span> →{" "}
                  <span className="mono">{h.field === "status" && h.to ? fx.status(h.to as IssueStatus) : (h.to ?? "—")}</span>
                </span>
                {h.reason ? <span className="muted">“{h.reason}”</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/* ───────── the pane ───────── */
export function DetailPane({ f, onClose, siblings }: { f: IssueFiltersApi; onClose: () => void; siblings: string[] }) {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const L = useIssueLinks();
  const V = useIssueViewLinks();
  const dl = useDimLabel();
  const [page, setPage] = useState(1);
  const [prevSel, setPrevSel] = useState(f.selected);
  if (prevSel !== f.selected) {
    setPrevSel(f.selected);
    setPage(1);
  }
  const det = useIssue(f.selected, f, { page, pageSize: 8 });
  const d = det.data && det.data.id === f.selected ? det.data : null;
  const at = f.selected ? siblings.indexOf(f.selected) : -1;
  const utt = d?.utterances;
  const pages = utt ? Math.max(1, Math.ceil(utt.total / utt.pageSize)) : 1;

  return (
    <aside className="lab-detail" aria-label={t("detail.aria")}>
      <div className="lab-d-head">
        <div className="lab-d-nav">
          <span className="mono muted">{f.selected}</span>
          {f.selected ? (
            <Link className="btn sm lab-d-full" href={V.issueHref(f.selected)}>
              {t("detail.openFull")} <ArrowUpRight aria-hidden />
            </Link>
          ) : null}
          <button type="button" className="btn icon sm ghost" disabled={at <= 0} onClick={() => f.select(siblings[at - 1])} aria-label={t("detail.prev")}>
            <ChevronLeft aria-hidden />
          </button>
          <button type="button" className="btn icon sm ghost" disabled={at < 0 || at >= siblings.length - 1} onClick={() => f.select(siblings[at + 1])} aria-label={t("detail.next")}>
            <ChevronRight aria-hidden />
          </button>
          <button type="button" className="btn icon sm" onClick={onClose} aria-label={t("detail.close")}>
            <X aria-hidden />
          </button>
        </div>
        {d ? (
          <>
            <div className="lab-d-badges">
              <span className="mono lab-d-rank">#{d.rank}</span>
              <span className="iss-sev" data-sev={d.severity} title={fx.severityHelp(d.severity)}>
                {d.severity}
              </span>
              <span className="lab-cls" data-cls={d.severity_class} title={fx.clsHelp(d.severity_class)}>
                {fx.cls(d.severity_class)}
              </span>
              <StatusPill status={d.state.status} />
              {d.novelty === "new" ? <span className="lab-newtag">{t("tag.novel")}</span> : null}
              {d.state.ticket_id ? <span className="chip">{d.state.ticket_id}</span> : null}
              <ModuleBadges feature="analysis.detailPane" />
            </div>
            <h2 className="lab-d-title">{fx.text(d.title)}</h2>
            <p className="lab-d-sig mono">
              {fx.fn(d.signature.agent_function)} · {d.signature.intent_expected}
              {d.signature.intent_predicted !== d.signature.intent_expected ? (
                <>
                  {" "}
                  → <span className="lab-pred">{d.signature.intent_predicted}</span>
                </>
              ) : null}{" "}
              · {fx.reason(d.signature.failure_reason)}
            </p>
            <dl className="lab-d-types">
              <div title={fx.text(d.category_reason)}>
                <dt>{dl.dim("category")}</dt>
                <dd>{dl.value("category", d.category)}</dd>
              </div>
              <div title={fx.text(d.type_reason?.user_impact)}>
                <dt>{dl.dim("user_impact")}</dt>
                <dd>{dl.value("user_impact", d.user_impact_type)}</dd>
              </div>
              <div title={fx.text(d.type_reason?.dev_miss)}>
                <dt>{dl.dim("dev_miss")}</dt>
                <dd>
                  {dl.value("dev_miss", d.dev_miss_type)}
                  {d.must_handle ? <span className="lab-mh">{dl.value("must_handle", "true")}</span> : null}
                </dd>
              </div>
              <div>
                <dt>{dl.dim("division")}</dt>
                <dd>{(d.divisions ?? []).map((x) => dl.value("division", x)).join(" · ") || "—"}</dd>
              </div>
            </dl>
            <dl className="lab-d-kpis">
              <div>
                <dt>{s("field.score")}</dt>
                <dd className="mono">{fx.score(d.score)}</dd>
              </div>
              <div>
                <dt>FAIL</dt>
                <dd className="mono">
                  {d.count}
                  <small>/{d.scope_total}</small>
                </dd>
              </div>
              <div>
                <dt>{s("field.failRate")}</dt>
                <dd className="mono">{fx.pct(d.fail_rate)}</dd>
              </div>
              <div>
                <dt>{s("field.delta")}</dt>
                <dd className="mono lab-delta" data-dir={deltaDir(d.delta)}>
                  {d.delta == null ? fx.value("novelty", "new") : fx.pp(d.delta)}
                </dd>
              </div>
            </dl>
            <div className="lab-d-links">
              <Link className="btn sm primary" href={L.results(d)}>
                {s("actions.openResults")} <ArrowUpRight aria-hidden />
              </Link>
              <span className="mono muted">
                {s("field.firstSeen")} {fm.dateTimeLabel(d.first_seen)} · {s("field.lastSeen")} {fm.dateTimeLabel(d.last_seen)}
              </span>
            </div>
          </>
        ) : null}
      </div>
      <div className="lab-d-body">
        {det.error && !d ? <ErrorNote error={det.error} /> : null}
        {!d && !det.error ? <Skeleton rows={10} /> : null}
        {d ? (
          <>
            <section className="lab-d-sec">
              <h3>{t("detail.anatomy")}</h3>
              <Waterfall d={d} />
            </section>
            <section className="lab-d-sec">
              <h3>{s("field.reasons")}</h3>
              <ol className="lab-why">
                {d.reasons.map((r, i) => (
                  <li key={i}>{fx.text(r)}</li>
                ))}
              </ol>
              {d.regression ? (
                <div className="lab-reg">
                  <span className="lab-sub">{fx.factor("regression")} · {fx.column(d.regression.axis)}</span>
                  <div className="lab-reg-bars">
                    <span className="mono">{d.regression.previous}</span>
                    <span className="lab-reg-track">
                      <i style={{ width: `${Math.min(100, d.regression.previousRate)}%` }} />
                    </span>
                    <b className="mono">{fx.pct(d.regression.previousRate)}</b>
                    <span className="mono">{d.regression.current}</span>
                    <span className="lab-reg-track cur">
                      <i style={{ width: `${Math.min(100, d.regression.currentRate)}%` }} />
                    </span>
                    <b className="mono">{fx.pct(d.regression.currentRate)}</b>
                  </div>
                </div>
              ) : null}
            </section>
            <section className="lab-d-sec">
              <h3>
                {t("detail.trend")} <span className="muted mono">· {s(`bucket.${d.trend.bucket}`)}</span>
              </h3>
              <Trend d={d} />
            </section>
            <section className="lab-d-sec">
              <h3>{t("detail.breakdown")}</h3>
              <Breakdown d={d} />
            </section>
            <section className="lab-d-sec">
              <h3>{t("detail.triage")}</h3>
              <Triage key={d.id + ":" + (d.state.updated_at ?? 0)} d={d} />
            </section>
            <section className="lab-d-sec">
              <h3>
                {t("detail.utterances")} <span className="muted mono">· {utt?.total ?? 0}</span>
              </h3>
              <ul className="lab-utts">{utt?.items.map((r) => <Utterance key={r.utterance_id} r={r} />)}</ul>
              {pages > 1 ? (
                <div className="lab-pager">
                  <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    ←
                  </button>
                  <span className="mono">
                    {page} / {pages}
                  </span>
                  <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    →
                  </button>
                </div>
              ) : null}
            </section>
            {d.workflows.length ? (
              <section className="lab-d-sec">
                <h3>{s("field.workflows")}</h3>
                <ul className="lab-wfl">
                  {d.workflows.map((w) => (
                    <li key={w.workflow_id}>
                      <Link className="mono" href={L.workflow(w.workflow_id, w.created_at, w.completed_at)}>
                        {w.workflow_id}
                      </Link>
                      <LangBadge lang={w.language} />
                      <span className="mono muted">
                        {w.pipeline_id} {w.pipeline_version} · {fm.dateTimeLabel(w.created_at)}
                      </span>
                      <b className="mono">FAIL {w.fails}</b>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {d.similar.length ? (
              <section className="lab-d-sec">
                <h3>{s("field.similar")}</h3>
                <ul className="lab-sim">
                  {d.similar.map((x) => (
                    <li key={x.id}>
                      <button type="button" onClick={() => f.select(x.id)}>
                        <span className="iss-sev" data-sev={x.severity}>
                          {x.severity}
                        </span>
                        <span className="lab-sim-t">{fx.text(x.title)}</span>
                        <span className="muted">{s(`relation.${x.relation}`)}</span>
                        <span className="mono">{fx.score(x.score)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}

