"use client";
/**
 * S-03 · Workflow Explorer. Every filter is a URL query param (back/forward + reload keep context;
 * returning from S4 restores the list). Server-side filtering/paging via GET /api/v1/workflows.
 * The global period (?range= / ?from=&to=) applies too; `range_by` picks the timestamp: lifetime
 * overlap ("active during the period", default), created_at or updated_at.
 */
import clsx from "clsx";
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LangBadge, StatusPill } from "@/components/shared";
import { failureCategoryLabel, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { ACTIVE_STATES, FAILURE_CATEGORY_META, LANG_CODES, PIPELINE_VERSIONS, STATES, STATUS_META } from "@/lib/catalog";
import { api, qs, parseAsBool, parseAsInt, parseAsList, parseAsString, useApi, useQueryStates, useTimeRange, type WorkflowQuery } from "@/lib/client";
import type { FailureCategory, LangCode, WorkflowStatus } from "@/lib/types";
import { RangeEmpty, RangeTag, useRangeHref } from "./time-range";
import { ErrorNote, Plate, Sheet, SheetHead, Skeleton, EXPLORER_RETURN_KEY } from "./ui";

const PARSERS = {
  q: parseAsString,
  workflow_id: parseAsString,
  pipeline_job_id: parseAsString,
  status: parseAsList,
  language: parseAsList,
  version: parseAsString,
  batch_id: parseAsString,
  event_type: parseAsString,
  error_code: parseAsString,
  error_category: parseAsString,
  pipeline_id: parseAsString,
  model_version: parseAsString,
  range_by: parseAsString.withDefault("active"),
  has_retries: parseAsBool,
  replay: parseAsBool,
  sort: parseAsString.withDefault("created_desc"),
  page: parseAsInt.withDefault(1),
};
const PAGE = 50;
const SORTS = ["created_desc", "created_asc", "wait_desc", "run_desc", "updated_desc", "attempts_desc"] as const;
const RANGE_BY = ["active", "created", "updated"] as const;
const PRESETS: ["_active" | "_failed", WorkflowStatus[]][] = [
  ["_active", ACTIVE_STATES],
  ["_failed", ["RETRY_WAIT", "DEAD_LETTERED", "TIMED_OUT"]],
];
const TEXT_KEYS = ["q", "workflow_id", "pipeline_job_id", "batch_id"] as const;
type TextKey = (typeof TEXT_KEYS)[number];

export function ExplorerScreen() {
  const rh = useRangeHref();
  const router = useRouter();
  const t = useT("explorer");
  const c = useT("common");
  const f8 = useFmt();
  const locale = useLocale();
  const tr = useTimeRange();
  const [f, setF] = useQueryStates(PARSERS);
  const [draft, setDraft] = useState<Partial<Record<TextKey, string>>>({});
  useEffect(() => {
    const keys = Object.keys(draft) as TextKey[];
    if (!keys.length) return;
    const t = setTimeout(() => {
      setF({ ...Object.fromEntries(keys.map((k) => [k, draft[k] || null])), page: 1 });
      setDraft({});
    }, 320);
    return () => clearTimeout(t);
  }, [draft, setF]);
  const page = f.page ?? 1;
  const query = useMemo<WorkflowQuery>(
    () => ({
      q: f.q ?? undefined,
      workflow_id: f.workflow_id ?? undefined,
      pipeline_job_id: f.pipeline_job_id ?? undefined,
      status: f.status.length ? f.status : undefined,
      language: f.language.length ? (f.language as LangCode[]) : undefined,
      version: f.version ?? undefined,
      batch_id: f.batch_id ?? undefined,
      event_type: f.event_type ?? undefined,
      error_code: f.error_code ?? undefined,
      error_category: f.error_category ?? undefined,
      pipeline_id: f.pipeline_id ?? undefined,
      model_version: f.model_version ?? undefined,
      range_by: (RANGE_BY as readonly string[]).includes(f.range_by ?? "") && f.range_by !== "active" ? (f.range_by as WorkflowQuery["range_by"]) : undefined,
      ...tr.params,
      has_retries: f.has_retries || undefined,
      replay: f.replay || undefined,
      sort: (f.sort ?? "created_desc") as WorkflowQuery["sort"],
      page,
      pageSize: PAGE,
    }),
    [f, page, tr.params],
  );
  const list = useApi(["workflows", "explorer", tr.key, query], () => api.workflows(query), { revalidateOn: ["transition"], throttleMs: 2000 });
  const errs = useApi(["analytics-errors", tr.key], () => api.errors({ top: 40, ...tr.params }), { revalidateOnFocus: false });
  const d = list.data;
  const rows = d?.items ?? [];
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const maxW = Math.max(1, ...rows.map((w) => w.waitMs ?? 0));
  const maxR = Math.max(1, ...rows.map((w) => w.runMs ?? 0));
  const statusSel = PRESETS.find(([, s]) => s.length === f.status.length && s.every((x) => f.status.includes(x)))?.[0] ?? (f.status.length === 1 ? f.status[0] : f.status.length ? "_custom" : "");
  const set = (p: Partial<typeof f>) => setF({ ...p, page: 1 }, { history: "push" });
  const val = (k: TextKey) => draft[k] ?? f[k] ?? "";
  /** Remember the filtered explorer URL so the detail page's "Explorer" crumb can return to it. */
  const openWf = (id: string) => {
    try {
      window.sessionStorage.setItem(EXPLORER_RETURN_KEY, window.location.search);
    } catch {
      /* storage unavailable — crumb falls back to the bare explorer */
    }
    router.push(rh(`/workflows/${id}`));
  };
  const anyFilter =
    TEXT_KEYS.some((k) => f[k]) || f.status.length || f.language.length || f.version || f.event_type || f.error_code || f.error_category || f.pipeline_id || f.model_version || f.has_retries || f.replay;
  const pipeOpts = Object.entries(d?.facets.pipeline_id ?? {}).sort((a, b) => b[1] - a[1]);
  const modelOpts = Object.entries(d?.facets.model_version ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
  const any = c("state.all");
  /** clear every filter but keep the period */
  const resetHref = () => {
    const keep = new URLSearchParams();
    Object.entries(tr.params).forEach(([k, v]) => keep.set(k, v));
    const q = keep.toString();
    return "/explorer" + (q ? "?" + q : "");
  };

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-03 · WORKFLOW EXPLORER"
        title={t("title")}
        desc={
          <>
            {t("desc")} <RangeTag />
          </>
        }
        acts={
          <button
            className="btn"
            onClick={() => {
              setDraft({});
              router.replace(resetHref(), { scroll: false });
            }}
          >
            <X />
            {c("actions.resetFilters")}
          </button>
        }
      />
      <Plate>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="filters">
            <label className="field f-wide">
              <span>{t("f.q")}</span>
              <input className="in mono" value={val("q")} onChange={(e) => setDraft((x) => ({ ...x, q: e.target.value }))} placeholder="wf-20261112-ko-0022 / trace id / batch-0001.jsonl" />
            </label>
            <label className="field">
              <span>Workflow ID</span>
              <input className="in mono" value={val("workflow_id")} onChange={(e) => setDraft((x) => ({ ...x, workflow_id: e.target.value }))} placeholder="ko-0022" />
            </label>
            <label className="field">
              <span>PipelineJob ID</span>
              <input className="in mono" value={val("pipeline_job_id")} onChange={(e) => setDraft((x) => ({ ...x, pipeline_job_id: e.target.value }))} placeholder="…-attempt-2" />
            </label>
            <label className="field">
              <span>{t("f.status")}</span>
              <select
                className="in"
                value={statusSel}
                onChange={(e) => {
                  const v = e.target.value;
                  const p = PRESETS.find(([k]) => k === v);
                  set({ status: p ? p[1] : v ? [v] : [] });
                }}
              >
                <option value="">{t("f.statusAll")}</option>
                {statusSel === "_custom" ? <option value="_custom">{f.status.join(", ")}</option> : null}
                {PRESETS.map(([k]) => (
                  <option key={k} value={k}>
                    {t(`presets.${k}`)}
                  </option>
                ))}
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel("workflow", s, locale)} · {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Pipeline</span>
              <select className="in" value={f.pipeline_id ?? ""} onChange={(e) => set({ pipeline_id: e.target.value || null })}>
                <option value="">{any}</option>
                {f.pipeline_id && !pipeOpts.some(([k]) => k === f.pipeline_id) ? <option value={f.pipeline_id}>{f.pipeline_id}</option> : null}
                {pipeOpts.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k} ({n})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Pipeline version</span>
              <select className="in" value={f.version ?? ""} onChange={(e) => set({ version: e.target.value || null })}>
                <option value="">{any}</option>
                {PIPELINE_VERSIONS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("f.model")}</span>
              <select className="in" value={f.model_version ?? ""} onChange={(e) => set({ model_version: e.target.value || null })}>
                <option value="">{any}</option>
                {f.model_version && !modelOpts.some(([k]) => k === f.model_version) ? <option value={f.model_version}>{f.model_version}</option> : null}
                {modelOpts.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k} ({n})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Batch ID</span>
              <input className="in mono" value={val("batch_id")} onChange={(e) => setDraft((x) => ({ ...x, batch_id: e.target.value }))} placeholder="batch-20261112-ko-0022" />
            </label>
            <label className="field">
              <span>Event type</span>
              <select className="in" value={f.event_type ?? ""} onChange={(e) => set({ event_type: e.target.value || null })}>
                <option value="">{any}</option>
                <option>pipeline.batch.requested</option>
                <option>pipeline.batch.replay.requested</option>
              </select>
            </label>
            <label className="field">
              <span>{t("f.errorCode")}</span>
              <select className="in" value={f.error_code ?? ""} onChange={(e) => set({ error_code: e.target.value || null })}>
                <option value="">{any}</option>
                {(errs.data?.topErrorCodes ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("f.errorCategory")}</span>
              <select className="in" value={f.error_category ?? ""} onChange={(e) => set({ error_category: e.target.value || null })}>
                <option value="">{any}</option>
                {(Object.keys(FAILURE_CATEGORY_META) as FailureCategory[]).map((k) => (
                  <option key={k} value={k}>
                    {failureCategoryLabel(k, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("f.rangeBy")}</span>
              <select className="in" value={f.range_by ?? "active"} onChange={(e) => set({ range_by: e.target.value })} title={t(`rangeBy.${(RANGE_BY as readonly string[]).includes(f.range_by ?? "") ? (f.range_by as (typeof RANGE_BY)[number]) : "active"}Help`)}>
                {RANGE_BY.map((k) => (
                  <option key={k} value={k}>
                    {t(`rangeBy.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("f.sort")}</span>
              <select className="in" value={f.sort ?? "created_desc"} onChange={(e) => set({ sort: e.target.value })}>
                {SORTS.map((k) => (
                  <option key={k} value={k}>
                    {t(`sorts.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chipset" role="group" aria-label={t("f.language")}>
              {LANG_CODES.map((c) => (
                <button key={c} aria-pressed={f.language.includes(c)} onClick={() => set({ language: f.language.includes(c) ? f.language.filter((x) => x !== c) : [...f.language, c] })}>
                  <LangBadge lang={c} />
                  {d?.facets.language[c] != null ? <span className="mono muted">{d.facets.language[c]}</span> : null}
                </button>
              ))}
            </div>
            <div className="chipset">
              <button aria-pressed={f.has_retries} onClick={() => set({ has_retries: !f.has_retries })}>
                <RotateCcw />
                {t("f.hasRetries")}
              </button>
              <button aria-pressed={f.replay} onClick={() => set({ replay: !f.replay })}>
                <RefreshCw />
                {t("f.replay")}
              </button>
            </div>
            <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {d ? (
                <>
                  {t("total", { count: f8.number(d.total) })}
                  {(Object.entries(d.facets.status) as [WorkflowStatus, number][]).map(([s, n]) => (
                    <span key={s}>
                      {" · "}
                      <button
                        className="btn sm ghost"
                        style={{ padding: 0, height: 18, color: `var(--st-${STATUS_META[s].tone})`, fontFamily: "var(--f-mono)", fontWeight: 500 }}
                        onClick={() => set({ status: [s] })}
                      >
                        {statusLabel("workflow", s, locale)} {n}
                      </button>
                    </span>
                  ))}
                </>
              ) : (
                "…"
              )}
            </span>
          </div>
          {anyFilter ? <div className="mono muted" style={{ fontSize: 11 }}>GET /api/v1/workflows{qs({ ...query, pageSize: undefined, page: undefined, sort: query.sort === "created_desc" ? undefined : query.sort })}</div> : null}
        </div>
      </Plate>
      <ErrorNote error={list.error} />
      <Plate flush>
        <div className="tbl-wrap" style={{ maxHeight: "calc(100dvh - 140px)" }}>
          <table className="t">
            <thead>
              <tr>
                <th>Workflow / PipelineJob</th>
                <th>{t("cols.status")}</th>
                <th>{t("cols.language")}</th>
                <th>{t("cols.pipeline")}</th>
                <th className="r">Attempt</th>
                <th>{t("cols.wait")}</th>
                <th>{t("cols.run")}</th>
                <th>{t("cols.input")}</th>
                <th>{t("cols.error")}</th>
                <th>{t("cols.created")}</th>
              </tr>
            </thead>
            <tbody className={clsx(list.isValidating && "validating")}>
              {!d ? (
                <tr>
                  <td colSpan={10}>
                    <Skeleton rows={8} />
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((w) => (
                  <tr
                    key={w.workflow_id}
                    className="click"
                    tabIndex={0}
                    onClick={() => openWf(w.workflow_id)}
                    onKeyDown={(e) => e.key === "Enter" && openWf(w.workflow_id)}
                  >
                    <td>
                      <div className="idc">{w.workflow_id}</div>
                      <div className="mono muted" style={{ fontSize: 10.5 }}>
                        {w.pipeline_job_id ?? "—"}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={w.status} />
                    </td>
                    <td>
                      <LangBadge lang={w.language} />
                    </td>
                    <td className="mono">
                      <div style={{ fontSize: 11.5 }}>
                        {w.pipeline_id ?? "—"} <span className="muted">{w.pipeline_version}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {w.model_version ?? ""}
                        {w.replay_of ? (
                          <span className="chip" style={{ marginLeft: 4, height: 18 }} title={t("replayOf", { id: w.replay_of })}>
                            Replay c{w.replay_cycle}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="mono r">
                      {w.attempt || 0}
                      {w.retries ? <span className="sev-WARNING"> (+{w.retries})</span> : null}
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <div className="mono" style={{ fontSize: 11.5 }}>
                        {w.waitMs != null ? f8.duration(w.waitMs, { style: "short" }) : "—"}
                      </div>
                      <div className="bar" style={{ height: 3, ["--tc" as string]: "var(--st-queued)" }}>
                        <i style={{ width: `${((w.waitMs ?? 0) / maxW) * 100}%` }} />
                      </div>
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <div className="mono" style={{ fontSize: 11.5 }}>
                        {w.runMs ? f8.duration(w.runMs, { style: "short" }) : "—"}
                      </div>
                      <div className="bar" style={{ height: 3, ["--tc" as string]: "var(--st-running)" }}>
                        <i style={{ width: `${((w.runMs ?? 0) / maxR) * 100}%` }} />
                      </div>
                    </td>
                    <td>
                      <div className="mono" style={{ fontSize: 11.5 }}>
                        {w.input.object}
                      </div>
                      <div className="muted mono" style={{ fontSize: 10.5 }}>
                        {t("utt", { count: w.input.utteranceCount })} · {f8.bytes(w.input.sizeBytes)}
                      </div>
                    </td>
                    <td>{w.lastErrorCode ? <span className="mono sev-ERROR" style={{ fontSize: 11.5 }}>{w.lastErrorCode}</span> : <span className="muted">—</span>}</td>
                    <td className="mono muted">{f8.dateTime(w.created_at).slice(5)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10}>
                    <RangeEmpty title={t("empty.title")} hint={anyFilter ? t("empty.filters") : t("empty.range", { by: t(`rangeBy.${(f.range_by as (typeof RANGE_BY)[number]) ?? "active"}`) })} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">
            {d && d.total ? `${(page - 1) * PAGE + 1}–${Math.min(d.total, page * PAGE)}` : 0} / {f8.number(d?.total ?? 0)}
          </span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setF({ page: page - 1 }, { history: "push" })} aria-label={c("actions.previous")}>
              <ChevronLeft />
            </button>
            <span className="mono" style={{ fontSize: 11 }}>
              {page} / {pages}
            </span>
            <button className="btn sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 }, { history: "push" })} aria-label={c("actions.next")}>
              <ChevronRight />
            </button>
          </span>
        </div>
      </Plate>
    </Sheet>
  );
}
