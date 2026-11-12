"use client";
/**
 * S-03 · Pipeline Explorer. Every filter is a URL query param (back/forward + reload keep context;
 * returning from S4 restores the list). Server-side filtering/paging via GET /api/v1/workflows.
 */
import clsx from "clsx";
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LangBadge, StatusPill, fmt } from "@/components/shared";
import { ACTIVE_STATES, FAILURE_CATEGORY_META, LANG_CODES, PIPELINE_VERSIONS, STATES, STATUS_META } from "@/lib/catalog";
import { api, qs, parseAsBool, parseAsInt, parseAsList, parseAsString, useApi, useQueryStates, type WorkflowQuery } from "@/lib/client";
import type { FailureCategory, LangCode, WorkflowStatus } from "@/lib/types";
import { Empty, ErrorNote, Plate, Sheet, SheetHead, Skeleton, EXPLORER_RETURN_KEY } from "./ui";

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
  from: parseAsString,
  to: parseAsString,
  has_retries: parseAsBool,
  replay: parseAsBool,
  sort: parseAsString.withDefault("created_desc"),
  page: parseAsInt.withDefault(1),
};
const PAGE = 50;
const SORTS: [string, string][] = [
  ["created_desc", "최근 생성순"],
  ["created_asc", "오래된 순"],
  ["wait_desc", "대기 시간 긴 순"],
  ["run_desc", "실행 시간 긴 순"],
  ["updated_desc", "최근 갱신순"],
  ["attempts_desc", "Attempt 많은 순"],
];
const PRESETS: [string, string, WorkflowStatus[]][] = [
  ["_active", "Slot 점유 (RESERVED·DISPATCHING·RUNNING)", ACTIVE_STATES],
  ["_failed", "실패 관련 (RETRY·DLQ·TIMEOUT)", ["RETRY_WAIT", "DEAD_LETTERED", "TIMED_OUT"]],
];
const toMs = (local: string | null) => (local ? new Date(local + ":00+09:00").getTime() : undefined);
const TEXT_KEYS = ["q", "workflow_id", "pipeline_job_id", "batch_id"] as const;
type TextKey = (typeof TEXT_KEYS)[number];

export function ExplorerScreen() {
  const router = useRouter();
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
      from: toMs(f.from),
      to: toMs(f.to),
      has_retries: f.has_retries || undefined,
      replay: f.replay || undefined,
      sort: (f.sort ?? "created_desc") as WorkflowQuery["sort"],
      page,
      pageSize: PAGE,
    }),
    [f, page],
  );
  const list = useApi(["workflows", "explorer", query], () => api.workflows(query), { revalidateOn: ["transition"], throttleMs: 2000 });
  const errs = useApi(["analytics-errors"], () => api.errors({ top: 40 }), { revalidateOnFocus: false });
  const d = list.data;
  const rows = d?.items ?? [];
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const maxW = Math.max(1, ...rows.map((w) => w.waitMs ?? 0));
  const maxR = Math.max(1, ...rows.map((w) => w.runMs ?? 0));
  const statusSel = PRESETS.find(([, , s]) => s.length === f.status.length && s.every((x) => f.status.includes(x)))?.[0] ?? (f.status.length === 1 ? f.status[0] : f.status.length ? "_custom" : "");
  const set = (p: Partial<typeof f>) => setF({ ...p, page: 1 }, { history: "push" });
  const val = (k: TextKey) => draft[k] ?? f[k] ?? "";
  /** Remember the filtered explorer URL so the detail page's "Explorer" crumb can return to it. */
  const openWf = (id: string) => {
    try {
      window.sessionStorage.setItem(EXPLORER_RETURN_KEY, window.location.search);
    } catch {
      /* storage unavailable — crumb falls back to the bare explorer */
    }
    router.push(`/workflows/${id}`);
  };
  const anyFilter = TEXT_KEYS.some((k) => f[k]) || f.status.length || f.language.length || f.version || f.event_type || f.error_code || f.error_category || f.from || f.to || f.has_retries || f.replay;

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-03 · PIPELINE EXPLORER"
        title="Pipeline Explorer"
        desc="Workflow · PipelineJob · Batch ID · Trace · Idempotency Key로 검색합니다. 필터는 URL에 저장되어 상세 화면에서 돌아오거나 새로고침해도 유지됩니다."
        acts={
          <button
            className="btn"
            onClick={() => {
              setDraft({});
              router.replace("/explorer", { scroll: false });
            }}
          >
            <X />
            필터 초기화
          </button>
        }
      />
      <Plate>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="filters">
            <label className="field f-wide">
              <span>통합 검색 (ID · Trace · 오브젝트 · 오류 · DLQ)</span>
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
              <span>Status</span>
              <select
                className="in"
                value={statusSel}
                onChange={(e) => {
                  const v = e.target.value;
                  const p = PRESETS.find(([k]) => k === v);
                  set({ status: p ? p[2] : v ? [v] : [] });
                }}
              >
                <option value="">전체 상태</option>
                {statusSel === "_custom" ? <option value="_custom">{f.status.join(", ")}</option> : null}
                {PRESETS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label} · {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Pipeline Version</span>
              <select className="in" value={f.version ?? ""} onChange={(e) => set({ version: e.target.value || null })}>
                <option value="">전체</option>
                {PIPELINE_VERSIONS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Batch ID</span>
              <input className="in mono" value={val("batch_id")} onChange={(e) => setDraft((x) => ({ ...x, batch_id: e.target.value }))} placeholder="batch-20261112-ko-0022" />
            </label>
            <label className="field">
              <span>Event Type</span>
              <select className="in" value={f.event_type ?? ""} onChange={(e) => set({ event_type: e.target.value || null })}>
                <option value="">전체</option>
                <option>pipeline.batch.requested</option>
                <option>pipeline.batch.replay.requested</option>
              </select>
            </label>
            <label className="field">
              <span>Error Code</span>
              <select className="in" value={f.error_code ?? ""} onChange={(e) => set({ error_code: e.target.value || null })}>
                <option value="">전체</option>
                {(errs.data?.topErrorCodes ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Error 유형</span>
              <select className="in" value={f.error_category ?? ""} onChange={(e) => set({ error_category: e.target.value || null })}>
                <option value="">전체</option>
                {(Object.keys(FAILURE_CATEGORY_META) as FailureCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {FAILURE_CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>생성 시작 (KST)</span>
              <input className="in mono" type="datetime-local" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
            </label>
            <label className="field">
              <span>생성 종료 (KST)</span>
              <input className="in mono" type="datetime-local" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
            </label>
            <label className="field">
              <span>정렬</span>
              <select className="in" value={f.sort ?? "created_desc"} onChange={(e) => set({ sort: e.target.value })}>
                {SORTS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chipset" role="group" aria-label="언어">
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
                Retry 발생
              </button>
              <button aria-pressed={f.replay} onClick={() => set({ replay: !f.replay })}>
                <RefreshCw />
                Replay 실행
              </button>
            </div>
            <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {d ? (
                <>
                  {fmt.number(d.total)}건
                  {(Object.entries(d.facets.status) as [WorkflowStatus, number][]).map(([s, n]) => (
                    <span key={s}>
                      {" · "}
                      <button
                        className="btn sm ghost"
                        style={{ padding: 0, height: 18, color: `var(--st-${STATUS_META[s].tone})`, fontFamily: "var(--f-mono)", fontWeight: 500 }}
                        onClick={() => set({ status: [s] })}
                      >
                        {STATUS_META[s].label} {n}
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
                <th>상태</th>
                <th>언어</th>
                <th>버전</th>
                <th className="r">Attempt</th>
                <th>대기 시간</th>
                <th>실행 시간</th>
                <th>입력 데이터</th>
                <th>오류</th>
                <th>생성</th>
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
                      {w.pipeline_version}
                      {w.replay_of ? (
                        <span className="chip" style={{ marginLeft: 4 }} title={`replay of ${w.replay_of}`}>
                          replay c{w.replay_cycle}
                        </span>
                      ) : null}
                    </td>
                    <td className="mono r">
                      {w.attempt || 0}
                      {w.retries ? <span className="sev-WARNING"> (+{w.retries})</span> : null}
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <div className="mono" style={{ fontSize: 11.5 }}>
                        {w.waitMs != null ? fmt.duration(w.waitMs, { style: "short" }) : "—"}
                      </div>
                      <div className="bar" style={{ height: 3, ["--tc" as string]: "var(--st-queued)" }}>
                        <i style={{ width: `${((w.waitMs ?? 0) / maxW) * 100}%` }} />
                      </div>
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <div className="mono" style={{ fontSize: 11.5 }}>
                        {w.runMs ? fmt.duration(w.runMs, { style: "short" }) : "—"}
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
                        {w.input.utteranceCount} utt · {fmt.bytes(w.input.sizeBytes)}
                      </div>
                    </td>
                    <td>{w.lastErrorCode ? <span className="mono sev-ERROR" style={{ fontSize: 11.5 }}>{w.lastErrorCode}</span> : <span className="muted">—</span>}</td>
                    <td className="mono muted">{fmt.dateTime(w.created_at).slice(5)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10}>
                    <Empty title="조건에 맞는 Workflow가 없습니다">필터를 줄이거나 Workflow ID 일부로 검색해 보세요.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">
            {d && d.total ? `${(page - 1) * PAGE + 1}–${Math.min(d.total, page * PAGE)}` : 0} / {fmt.number(d?.total ?? 0)}
          </span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setF({ page: page - 1 }, { history: "push" })} aria-label="이전 페이지">
              <ChevronLeft />
            </button>
            <span className="mono" style={{ fontSize: 11 }}>
              {page} / {pages}
            </span>
            <button className="btn sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 }, { history: "push" })} aria-label="다음 페이지">
              <ChevronRight />
            </button>
          </span>
        </div>
      </Plate>
    </Sheet>
  );
}
