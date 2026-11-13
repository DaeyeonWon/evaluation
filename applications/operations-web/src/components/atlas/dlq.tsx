"use client";
/**
 * S-05 · DLQ operations. Group by failure category, filter (URL), log preview + history, single
 * replay with in-page confirmation (POST /dead-letters/{id}/replay → REPLAYING → new replay cycle in
 * the simulator), close, assign, and batch replay of the checked rows.
 *
 * The list, KPI facets, Replay table and Replay workflows follow the global period (useTimeRange).
 * Items that still need attention but were created outside the period are surfaced in a banner
 * (`outsideRange`) so pending DLQ entries never silently disappear.
 */
import "@/styles/atlas-data.css";
import clsx from "clsx";
import { Archive, CalendarRange, Check, KeyRound, Map as MapIcon, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CatalogIcon, LangBadge, StatusPill } from "@/components/shared";
import { DLQ_STATUS_META, FAILURE_CATEGORY_META, LANG_CODES, OPERATORS, PIPELINE_BY_ID, ROOT_PIPELINE_IDS } from "@/lib/catalog";
import { api, parseAsList, parseAsString, revalidateKey, useApi, useQueryStates, useSession, useSimNow } from "@/lib/client";
import type { DeadLetter, DlqStatus, FailureCategory, LangCode } from "@/lib/types";
import { failureCategoryLabel, failureCategoryPolicy, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { Empty, Plate, Sheet, SheetHead, Skeleton, useToast } from "./ui";
import { QueryError, RangeTag, useApiErrorHandler, useRangeInfo } from "./analytics/kit";
import { useRangeHref } from "./time-range";

const PARSERS = { sel: parseAsString, status: parseAsString, language: parseAsList, pipeline: parseAsString, q: parseAsString, category: parseAsString };
const PERM = "dlq:replay";
const replayable = (d: DeadLetter | undefined) => !!d && (d.status === "PENDING_REVIEW" || d.status === "APPROVED");
const opName = (id: string | null | undefined) => (id ? (OPERATORS.find((o) => o.id === id)?.name ?? id) : "—");

/** Versions the root pipeline of a DLQ item can run (DEPRECATED kept only if it is the original). */
function versionsFor(pipelineId: string | undefined) {
  return PIPELINE_BY_ID[pipelineId ?? ""]?.versions ?? [];
}

function PermLine() {
  const t = useT("dlq");
  const { can, user, roles } = useSession();
  const ok = can(PERM);
  return (
    <div className={clsx("note", !ok && "bad")}>
      <KeyRound aria-hidden />
      {t("perm.line", { perm: PERM, user: user?.name ?? "—", roles: roles.join(", ") || "—" })} {ok ? t("perm.ok") : <b>{t("perm.denied")}</b>}
    </div>
  );
}

function Detail({ id, mode, setMode }: { id: string; mode: null | "replay" | "close"; setMode: (m: null | "replay" | "close") => void }) {
  const rh = useRangeHref();
  const t = useT("dlq");
  const tc = useT("common");
  const locale = useLocale();
  const f = useFmt();
  const q = useApi(["dead-letters", "detail", id], () => api.deadLetter(id), { revalidateOn: ["dlq", "transition"] });
  const now = useSimNow();
  const toast = useToast();
  const onErr = useApiErrorHandler();
  const { can } = useSession();
  const [reason, setReason] = useState("");
  const [ver, setVer] = useState("");
  const [res, setRes] = useState("");
  const [busy, setBusy] = useState(false);
  const det = q.data?.deadLetter.dead_letter_id === id ? q.data : undefined;
  if (q.error && !det) return <QueryError error={q.error} />;
  if (!det) return <Skeleton rows={8} />;
  const d = det.deadLetter;
  const allowed = can(PERM);
  const versions = versionsFor(d.pipeline_id);
  const warn =
    d.failure_category === "INPUT_SCHEMA" ? t("warn.inputSchema") : d.failure_category === "AUTH_PERMISSION" ? t("warn.auth") : d.failure_category === "CODE_DEFECT" ? t("warn.codeDefect") : "";
  const replay = async () => {
    setBusy(true);
    try {
      const r = await api.replayDeadLetter(d.dead_letter_id, { reason, pipeline_version: ver || undefined });
      toast.ok(t("toast.replayed", { replay: r.replay.replay_id, workflow: r.workflow.workflow_id, cycle: r.workflow.replay_cycle, status: statusLabel("workflow", r.workflow.status, locale) }));
      setMode(null);
      setReason("");
      revalidateKey("dead-letters");
      revalidateKey("replays");
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    setBusy(true);
    try {
      await api.closeDeadLetter(d.dead_letter_id, { resolution: res });
      toast.ok(t("toast.closed", { id: d.dead_letter_id }));
      setMode(null);
      revalidateKey("dead-letters");
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  const wfCycle = det.workflow?.replay_cycle ?? 0;
  return (
    <div className="ad-dlq-detail" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b className="mono" style={{ fontSize: 16, fontWeight: 500 }}>
          {d.dead_letter_id}
        </b>
        <StatusPill kind="dlq" status={d.status} />
        <span className="chip">{failureCategoryLabel(d.failure_category, locale)}</span>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
          {failureCategoryPolicy(d.failure_category, locale)}
        </span>
      </div>
      <dl className="kv">
        <dt>Workflow</dt>
        <dd>
          <Link className="mono" href={rh(`/workflows/${d.workflow_id}`)}>
            {d.workflow_id}
          </Link>
        </dd>
        <dt>{t("detail.error")}</dt>
        <dd className="mono">
          {d.error_code} @ {d.failed_path ?? d.failed_node ?? "—"}
        </dd>
        <dt>{t("detail.cause")}</dt>
        <dd>{d.failure_reason}</dd>
        <dt>{t("detail.input")}</dt>
        <dd className="mono">
          {d.input_uri} · {t("detail.utterances", { count: d.utterance_count })}
        </dd>
        <dt>Pipeline</dt>
        <dd className="mono">
          {d.pipeline_id} · {d.pipeline_version} · {d.model_version}
        </dd>
        <dt>Attempts</dt>
        <dd className="mono">{t("detail.attempts", { count: d.attempts })}</dd>
        <dt>{t("detail.lastJob")}</dt>
        <dd className="mono">{d.failed_job_id ?? d.last_pipeline_job_id}</dd>
        <dt>{t("detail.created")}</dt>
        <dd className="mono">
          {f.dateTime(d.created_at)} ({f.relative(d.created_at, now)})
        </dd>
        <dt>{t("detail.assignee")}</dt>
        <dd>
          <select
            className="in"
            style={{ height: 27, maxWidth: 240 }}
            value={d.assigned_operator ?? ""}
            aria-label={t("detail.assignAria")}
            disabled={!allowed}
            onChange={async (e) => {
              try {
                await api.assignDeadLetter(d.dead_letter_id, { operator_id: e.target.value || null, reason: t("detail.assignReason") });
                toast.ok(t("toast.assigned", { id: d.dead_letter_id, name: e.target.value ? opName(e.target.value) : t("detail.unassigned") }));
                revalidateKey("dead-letters");
              } catch (err) {
                onErr(err);
              }
            }}
          >
            <option value="">{t("detail.unassigned")}</option>
            {OPERATORS.filter((o) => o.role !== "Viewer").map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </dd>
      </dl>
      {warn ? <div className="note warn">{warn}</div> : null}
      <div>
        <div className="grp-t" style={{ padding: "0 0 6px" }}>
          {t("detail.lastLog")}
        </div>
        <pre className="code wrap" style={{ maxHeight: 180 }}>
          {d.last_log_excerpt}
        </pre>
      </div>
      {d.last_stack_trace ? (
        <details>
          <summary className="mono" style={{ cursor: "pointer", fontSize: 11.5, color: "var(--st-failed)" }}>
            {t("detail.stackTrace")}
          </summary>
          <pre className="code" style={{ color: "var(--st-failed)", marginTop: 6 }}>
            {d.last_stack_trace}
          </pre>
        </details>
      ) : null}
      <div>
        <div className="grp-t" style={{ padding: "0 0 6px" }}>
          {t("detail.history")}
        </div>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>PipelineJob</th>
                <th>{t("col.status")}</th>
                <th>{t("col.error")}</th>
                <th>{t("col.started")}</th>
                <th>{t("col.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {d.attempt_history.map((a) => (
                <tr key={a.attempt}>
                  <td className="mono">{a.attempt}</td>
                  <td className="idc">{a.pipeline_job_id}</td>
                  <td>
                    <StatusPill kind="attempt" status={a.status} />
                  </td>
                  <td className="mono sev-ERROR">{a.error_code ?? "—"}</td>
                  <td className="mono muted">{f.time(a.started_at)}</td>
                  <td className="mono">{a.started_at && a.completed_at ? f.duration(a.completed_at - a.started_at, { style: "short" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {d.notes.length ? (
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            {t("detail.notes")}
          </div>
          {d.notes.map((n, i) => (
            <div className="obj" key={i}>
              <span>{n.text}</span>
              <span className="om">
                <span>{opName(n.by)}</span>
                <span>{f.dateTime(n.at)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {det.replays.length ? (
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            {t("replays.title")}
          </div>
          {det.replays.map((r) => {
            const rw = det.replayWorkflows.find((w) => w.workflow_id === r.replay_workflow_id);
            return (
              <div className="obj" key={r.replay_id}>
                <span className="on" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {r.replay_id} · {r.pipeline_version_from} → {r.pipeline_version_to} {rw ? <StatusPill status={rw.status} size="xs" /> : <span className="chip">{statusLabel("replay", r.status, locale)}</span>}
                </span>
                <span className="om">
                  <span>{rw ? <Link href={rh(`/workflows/${rw.workflow_id}`)}>{rw.workflow_id}</Link> : "—"}</span>
                  <span>{opName(r.approved_by)}</span>
                  <span>{f.dateTime(r.created_at)}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {d.resolution ? (
        <div className="note">
          <Check aria-hidden />
          {t("detail.resolution", { text: d.resolution })}
        </div>
      ) : null}
      {mode === "replay" ? (
        <div className="confirm" role="group" aria-label={t("replay.aria")}>
          <div className="steps">
            <span className="done">{t("replay.step1")}</span>
            <span className="on">{t("replay.step2")}</span>
            <span>{t("replay.step3")}</span>
          </div>
          <div style={{ fontSize: 13 }}>{t("replay.explain", { cycle: wfCycle + 1, language: d.language.toUpperCase(), file: d.input_uri.split("/").pop() ?? "" })}</div>
          <PermLine />
          <label className="field">
            <span>{t("replay.version")}</span>
            <select className="in" value={ver || d.pipeline_version} onChange={(e) => setVer(e.target.value)}>
              {versions.map((v) => (
                <option key={v.version} value={v.version} disabled={v.status === "DEPRECATED" && v.version !== d.pipeline_version}>
                  {v.version} · {statusLabel("version", v.status, locale)}
                  {v.version === d.pipeline_version ? ` (${t("replay.original")})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("replay.reason")}</span>
            <textarea className="in" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("replay.reasonPh")} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setMode(null)}>
              {tc("actions.cancel")}
            </button>
            <button className="btn primary" disabled={busy || reason.trim().length < 4 || !allowed} onClick={replay}>
              <Check />
              {t("replay.confirm")}
            </button>
          </div>
        </div>
      ) : mode === "close" ? (
        <div className="confirm" role="group" aria-label={t("close.aria")}>
          <div className="steps">
            <span className="done">{t("close.step1")}</span>
            <span className="on">{t("close.step2")}</span>
          </div>
          <label className="field">
            <span>{t("close.reason")}</span>
            <input className="in" autoFocus value={res} onChange={(e) => setRes(e.target.value)} placeholder={t("close.reasonPh")} />
          </label>
          <PermLine />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setMode(null)}>
              {tc("actions.cancel")}
            </button>
            <button className="btn danger" disabled={busy || res.trim().length < 4 || !allowed} onClick={close}>
              <Archive />
              {t("close.confirm")}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn primary" disabled={!replayable(d) || !allowed} onClick={() => setMode("replay")} title={!allowed ? t("perm.denied") : undefined}>
            <RefreshCw />
            {t("actions.replay")}
          </button>
          <button className="btn" disabled={d.status === "CLOSED" || d.status === "REPLAYING" || !allowed} onClick={() => setMode("close")} title={!allowed ? t("perm.denied") : undefined}>
            <Archive />
            {t("actions.close")}
          </button>
          {!allowed ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {t("perm.viewerHint", { perm: PERM })}
            </span>
          ) : !replayable(d) ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {d.status === "REPLAYING" ? t("actions.replayingBlocked") : t("actions.alreadyHandled")}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Pending work created before/after the selected period — never let it disappear silently. */
function OutsideRange({ out, onWiden, canWiden, label }: { out: { pendingReview: number; approved: number; replaying: number }; onWiden: () => void; canWiden: boolean; label: string }) {
  const t = useT("dlq");
  const n = out.pendingReview + out.approved + out.replaying;
  if (!n) return null;
  return (
    <div className="ad-outside" role="status">
      <CalendarRange aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <b>{out.pendingReview ? t("outside.title", { count: out.pendingReview }) : t("outside.titleActive")}</b>
        <span className="mono muted">
          {" "}
          · {t("outside.detail", { approved: out.approved, replaying: out.replaying, range: label })}
        </span>
      </div>
      {canWiden ? (
        <button className="btn sm" onClick={onWiden}>
          {t("outside.widen")}
        </button>
      ) : null}
    </div>
  );
}

export function DlqScreen() {
  const rh = useRangeHref();
  const t = useT("dlq");
  const tc = useT("common");
  const locale = useLocale();
  const fm = useFmt();
  const [f, setF] = useQueryStates(PARSERS);
  const now = useSimNow();
  const toast = useToast();
  const onErr = useApiErrorHandler();
  const { can } = useSession();
  const allowed = can(PERM);
  const tr0 = useRangeInfo();
  const rp = tr0.params;
  const query = useMemo(
    () => ({
      ...rp,
      status: f.status ?? undefined,
      language: f.language.length ? (f.language as LangCode[]) : undefined,
      category: f.category ?? undefined,
      pipeline_id: f.pipeline ?? undefined,
      q: f.q ?? undefined,
      pageSize: 200,
    }),
    [rp, f.status, f.language, f.category, f.pipeline, f.q],
  );
  const list = useApi(["dead-letters", "list", tr0.key, query], () => api.deadLetters(query), { revalidateOn: ["dlq"] });
  const base = useApi(["dead-letters", "base", tr0.key], () => api.deadLetters({ ...rp, pageSize: 1 }), { revalidateOn: ["dlq"] });
  const replays = useApi(["replays", "page", tr0.key], () => api.replaysPage({ ...rp }), { revalidateOn: ["dlq", "transition"] });
  const replayWfs = useApi(["workflows", "replays", tr0.key], () => api.workflows({ ...rp, replay: true, pageSize: 200 }), { revalidateOn: ["transition"] });
  const tr = useRangeInfo(base.data?.range ?? list.data?.range);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<null | "replay" | "close" | "batch">(null);
  const [bReason, setBReason] = useState("");
  const [bVer, setBVer] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const sel = f.sel ?? items.filter((d) => d.status === "PENDING_REVIEW").sort((a, b) => b.created_at - a.created_at)[0]?.dead_letter_id ?? null;
  const groups = useMemo(() => {
    const g: Record<string, DeadLetter[]> = {};
    items.forEach((d) => (g[d.failure_category] ??= []).push(d));
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length) as [FailureCategory, DeadLetter[]][];
  }, [items]);
  const byStatus = base.data?.facets.status ?? {};
  const chkItems = [...checked].map((id) => items.find((d) => d.dead_letter_id === id)).filter((d): d is DeadLetter => !!d && replayable(d));
  // versions every checked item's root pipeline can run
  const batchVersions = useMemo(() => {
    const sets = chkItems.map((d) => new Set(versionsFor(d.pipeline_id).filter((v) => v.status !== "DEPRECATED").map((v) => v.version)));
    const first = versionsFor(chkItems[0]?.pipeline_id).filter((v) => v.status !== "DEPRECATED");
    return first.filter((v) => sets.every((s) => s.has(v.version)));
  }, [chkItems]);

  const batch = async () => {
    setBusy(true);
    try {
      const r = await api.replayBatch({ ids: chkItems.map((d) => d.dead_letter_id), reason: bReason, pipeline_version: bVer || undefined });
      const okIds = r.results.filter((x) => x.ok).map((x) => fm.shortWorkflowId(x.workflow?.workflow_id));
      toast.ok(r.failed ? t("toast.batchPartial", { ok: r.succeeded, failed: r.failed, ids: okIds.join(", ") }) : t("toast.batch", { count: r.succeeded, ids: okIds.join(", ") }));
      r.results.filter((x) => !x.ok).forEach((x) => toast.err(`${x.id}: ${x.error}`));
      setChecked(new Set());
      setMode(null);
      setBReason("");
      revalidateKey("dead-letters");
      revalidateKey("replays");
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };

  const rws = new Map((replayWfs.data?.items ?? []).map((w) => [w.workflow_id, w]));
  const replayRows = replays.data?.items ?? [];
  const widest = tr.spec.kind === "preset" && tr.spec.preset === "30d";

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-05 · DLQ OPERATIONS"
        title="DLQ Operations"
        desc={t("desc")}
        acts={
          <Link className="btn" href={rh("/?stage=dlq")}>
            <MapIcon />
            {t("viewBranch")}
          </Link>
        }
      />
      {base.data ? <OutsideRange out={base.data.outsideRange} label={tr.label} canWiden={!widest} onWiden={() => tr.setSpec({ kind: "preset", preset: "30d" })} /> : null}
      <div className="kpis">
        <div className="kpi">
          <div className="k">
            <CatalogIcon name="archive-x" /> {t("kpi.inRange")}
          </div>
          <div className="v">{base.data ? fm.number(base.data.total) : "—"}</div>
          <div className="s">{tr.label}</div>
        </div>
        {(Object.keys(DLQ_STATUS_META) as DlqStatus[]).map((s) => {
          const m = DLQ_STATUS_META[s];
          return (
            <button
              key={s}
              className={clsx("kpi", f.status === s && "on")}
              data-tone
              style={{ ["--tc" as string]: `var(--st-${m.tone})` }}
              aria-pressed={f.status === s}
              onClick={() => setF({ status: f.status === s ? null : s })}
            >
              <div className="k">
                <CatalogIcon name={m.icon} /> {statusLabel("dlq", s, locale)}
              </div>
              <div className="v">{fm.number(byStatus[s] ?? 0)}</div>
              <div className="s">{s}</div>
            </button>
          );
        })}
      </div>
      <Plate>
        <div className="filters">
          <label className="field f-wide">
            <span>{tc("actions.search")}</span>
            <input className="in mono" value={f.q ?? ""} onChange={(e) => setF({ q: e.target.value || null })} placeholder={t("filters.searchPh")} />
          </label>
          <label className="field">
            <span>{tc("field.status")}</span>
            <select className="in" value={f.status ?? ""} onChange={(e) => setF({ status: e.target.value || null })}>
              <option value="">{tc("state.all")}</option>
              {(Object.keys(DLQ_STATUS_META) as DlqStatus[]).map((s) => (
                <option key={s} value={s}>
                  {statusLabel("dlq", s, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("filters.category")}</span>
            <select className="in" value={f.category ?? ""} onChange={(e) => setF({ category: e.target.value || null })}>
              <option value="">{tc("state.all")}</option>
              {(Object.keys(FAILURE_CATEGORY_META) as FailureCategory[]).map((c) => (
                <option key={c} value={c}>
                  {failureCategoryLabel(c, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pipeline</span>
            <select className="in mono" value={f.pipeline ?? ""} onChange={(e) => setF({ pipeline: e.target.value || null })}>
              <option value="">{tc("state.all")}</option>
              {ROOT_PIPELINE_IDS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="field f-wide">
            <span>{tc("field.language")}</span>
            <div className="chipset" role="group" aria-label={tc("field.language")}>
              {LANG_CODES.map((c) => (
                <button key={c} aria-pressed={f.language.includes(c)} onClick={() => setF({ language: f.language.includes(c) ? f.language.filter((x) => x !== c) : [...f.language, c] })}>
                  <LangBadge lang={c} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </Plate>
      <QueryError error={list.error} />
      <div className="split s-46">
        <Plate
          flush
          title={t("groups.title")}
          right={
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <RangeTag label={tr.label} />
              <span className="mono muted" style={{ fontSize: 11 }}>
                {checked.size ? t("groups.checked", { count: checked.size }) : tc("count.items", { count: items.length })}
              </span>
              <button
                className="btn sm primary"
                disabled={!allowed}
                title={!allowed ? t("perm.denied") : undefined}
                onClick={() => {
                  if (!chkItems.length) return toast.err(t("toast.batchNone"));
                  setMode("batch");
                }}
              >
                <RefreshCw />
                {t("groups.batch")}
              </button>
            </span>
          }
        >
          {mode === "batch" ? (
            <div className="confirm" style={{ margin: 12 }}>
              <div className="steps">
                <span className="done">{t("batch.step1", { count: chkItems.length })}</span>
                <span className="on">{t("replay.step2")}</span>
                <span>{t("batch.step3")}</span>
              </div>
              <div className="mono" style={{ fontSize: 11.5, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {chkItems.map((d) => (
                  <span className="chip" key={d.dead_letter_id}>
                    {d.dead_letter_id} · {d.language} · {d.error_code}
                  </span>
                ))}
              </div>
              {chkItems.some((d) => d.failure_category === "INPUT_SCHEMA" || d.failure_category === "AUTH_PERMISSION") ? <div className="note warn">{t("batch.warn")}</div> : null}
              <PermLine />
              <label className="field">
                <span>{t("replay.version")}</span>
                <select className="in" value={bVer} onChange={(e) => setBVer(e.target.value)}>
                  <option value="">{t("batch.keepVersion")}</option>
                  {batchVersions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version} · {statusLabel("version", v.status, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("batch.reason")}</span>
                <textarea className="in" value={bReason} onChange={(e) => setBReason(e.target.value)} placeholder={t("batch.reasonPh")} />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setMode(null)}>
                  {tc("actions.cancel")}
                </button>
                <button className="btn primary" disabled={busy || bReason.trim().length < 4 || !chkItems.length || !allowed} onClick={batch}>
                  <RefreshCw />
                  {t("batch.confirm", { count: chkItems.length })}
                </button>
              </div>
            </div>
          ) : null}
          <div style={{ maxHeight: 780, overflow: "auto" }}>
            {!list.data ? (
              <Skeleton rows={8} />
            ) : groups.length ? (
              groups.map(([cat, arr]) => {
                const m = FAILURE_CATEGORY_META[cat];
                return (
                  <details className="dlq-grp" open key={cat}>
                    <summary>
                      <CatalogIcon name={m?.icon ?? "alert-triangle"} />
                      <span>{failureCategoryLabel(cat, locale)}</span>
                      <span className="pol">
                        {cat} · {failureCategoryPolicy(cat, locale)}
                      </span>
                      <span className="n">{arr.length}</span>
                    </summary>
                    {arr.map((d) => (
                      <div
                        key={d.dead_letter_id}
                        className={clsx("dlq-row", sel === d.dead_letter_id && "sel")}
                        tabIndex={0}
                        role="button"
                        aria-pressed={sel === d.dead_letter_id}
                        onClick={(e) => {
                          if ((e.target as Element).closest("input")) return;
                          setF({ sel: d.dead_letter_id }, { history: "push" });
                          if (mode !== "batch") setMode(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && setF({ sel: d.dead_letter_id }, { history: "push" })}
                      >
                        <input
                          type="checkbox"
                          aria-label={t("groups.selectAria", { id: d.dead_letter_id })}
                          disabled={!replayable(d) || !allowed}
                          checked={checked.has(d.dead_letter_id)}
                          onChange={(e) =>
                            setChecked((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(d.dead_letter_id);
                              else n.delete(d.dead_letter_id);
                              return n;
                            })
                          }
                        />
                        <div style={{ minWidth: 0 }}>
                          <div className="t1">
                            <span className="idc">{d.dead_letter_id}</span>
                            <LangBadge lang={d.language} />
                            <span className="mono sev-ERROR" style={{ fontSize: 11 }}>
                              {d.error_code}
                            </span>
                            <span className="mono muted" style={{ fontSize: 10.5 }}>
                              {t("groups.attempts", { count: d.attempts })} · {d.failed_path ?? d.failed_node ?? "—"}
                            </span>
                          </div>
                          <div className="t2">
                            <span className="mono muted" style={{ fontSize: 10.5 }}>
                              {d.pipeline_id}
                            </span>{" "}
                            {d.failure_reason}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", display: "grid", gap: 3, justifyItems: "end" }}>
                          <StatusPill kind="dlq" status={d.status} size="xs" />
                          <span className="mono muted" style={{ fontSize: 10.5 }}>
                            {fm.relative(d.created_at, now)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </details>
                );
              })
            ) : (
              <Empty title={t("empty.title")}>{t("empty.body")}</Empty>
            )}
          </div>
        </Plate>
        <Plate title={t("detail.title")} refText="POST /api/v1/dead-letters/{id}/replay">
          {sel ? (
            <Detail key={sel} id={sel} mode={mode === "batch" ? null : mode} setMode={setMode} />
          ) : (
            <Empty title={t("detail.emptyTitle")}>{t("detail.emptyBody")}</Empty>
          )}
        </Plate>
      </div>
      <Plate flush title={t("replays.title")} right={<RangeTag label={`${tr.label} · ${tc("count.items", { count: replayRows.length })}`} />}>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Replay</th>
                <th>DLQ</th>
                <th>{t("replays.workflows")}</th>
                <th>Version</th>
                <th>{t("col.status")}</th>
                <th>{t("replays.requestedApproved")}</th>
                <th>{tc("field.reason")}</th>
                <th>{t("replays.time")}</th>
              </tr>
            </thead>
            <tbody>
              {replays.data && !replayRows.length ? (
                <tr>
                  <td colSpan={8}>
                    <Empty title={t("replays.empty")} />
                  </td>
                </tr>
              ) : null}
              {replayRows.map((r) => {
                const rw = r.replay_workflow_id ? rws.get(r.replay_workflow_id) : undefined;
                return (
                  <tr key={r.replay_id}>
                    <td className="idc">{r.replay_id}</td>
                    <td className="mono">
                      <button className="btn sm ghost" style={{ padding: 0, color: "var(--accent)" }} onClick={() => setF({ sel: r.dead_letter_id })}>
                        {r.dead_letter_id}
                      </button>
                    </td>
                    <td className="mono">
                      <Link href={rh(`/workflows/${r.original_workflow_id}`)}>{r.original_workflow_id}</Link> →{" "}
                      {r.replay_workflow_id ? <Link href={rh(`/workflows/${r.replay_workflow_id}`)}>{r.replay_workflow_id}</Link> : "—"}
                    </td>
                    <td className="mono">
                      {r.pipeline_version_from} → {r.pipeline_version_to}
                    </td>
                    <td>{rw ? <StatusPill status={rw.status} /> : <span className="chip" title={r.status}>{statusLabel("replay", r.status, locale)}</span>}</td>
                    <td>
                      {opName(r.requested_by)} / {opName(r.approved_by)}
                    </td>
                    <td className="wrap" style={{ fontSize: 12 }}>
                      {r.reason}
                    </td>
                    <td className="mono muted">{fm.dateTime(r.created_at).slice(5)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Plate>
    </Sheet>
  );
}
