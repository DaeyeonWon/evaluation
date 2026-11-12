"use client";
/**
 * S3 Pipeline Explorer. Every filter lives in the URL (?q=&language=&status=…&page=), so reload and
 * back/forward keep the context; opening a row carries the query into the detail breadcrumb.
 */
import clsx from "clsx";
import { FileText, Filter, RefreshCw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { StatusPill } from "@/components/shared";
import { LANG_CODES, LANG_LABEL, PIPELINE_VERSIONS, STATES, STATUS_META } from "@/lib/catalog";
import { api, parseAsBool, parseAsInt, parseAsString, useApi, useQueryStates, useSimNow, useStreamEvent, type WorkflowQuery } from "@/lib/client";
import { fmt, kstDayStart } from "@/lib/format";
import type { LangCode, WorkflowStatus, WorkflowSummary } from "@/lib/types";
import { wfHref } from "./nav-store";
import { useDebouncedParam } from "./use-debounced-param";
import { ErrorBox, Lang, Pager, Skel, Tag, TextModal, dur } from "./ui";

const PARSERS = {
  q: parseAsString,
  job: parseAsString,
  batch: parseAsString,
  language: parseAsString,
  status: parseAsString,
  version: parseAsString,
  event_type: parseAsString,
  error_code: parseAsString,
  from: parseAsString,
  to: parseAsString,
  sort: parseAsString.withDefault("created_desc"),
  page: parseAsInt.withDefault(1),
  retries: parseAsBool,
  preset: parseAsString,
};

export const PRESETS: Record<string, { label: string; statuses: WorkflowStatus[]; today?: boolean }> = {
  running: { label: "Running", statuses: ["RUNNING"] },
  pending: { label: "Pending", statuses: ["RECEIVED", "VALIDATED", "QUEUED", "RESERVED", "DISPATCHING"] },
  completed: { label: "Completed (오늘)", statuses: ["SUCCEEDED"], today: true },
  failed: { label: "Failed (오늘)", statuses: ["DEAD_LETTERED", "TIMED_OUT"], today: true },
  retry: { label: "Retry Waiting", statuses: ["RETRY_WAIT"] },
};
const PER = 20;
const toEpoch = (v: string | null) => (v ? Date.parse(v + ":00+09:00") : undefined);

export function Explorer() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const now = useSimNow();
  const [fRaw, setF] = useQueryStates(PARSERS);
  // parseAsX.withDefault() is typed as nullable by the shared parser (overload order) → normalize here
  const f = { ...fRaw, page: fRaw.page ?? 1, sort: fRaw.sort ?? "created_desc" };
  const preset = f.preset && PRESETS[f.preset] ? PRESETS[f.preset] : null;
  const setFilter = useCallback((patch: Partial<typeof f>) => setF({ ...patch, page: 1 }), [setF]);
  const writeQ = useCallback((v: string | null) => setFilter({ q: v }), [setFilter]);
  const writeJob = useCallback((v: string | null) => setFilter({ job: v }), [setFilter]);
  const writeBatch = useCallback((v: string | null) => setFilter({ batch: v }), [setFilter]);
  const [qText, setQText] = useDebouncedParam(f.q, writeQ);
  const [jobText, setJobText] = useDebouncedParam(f.job, writeJob);
  const [batchText, setBatchText] = useDebouncedParam(f.batch, writeBatch);
  const registryTotal = useTotal();

  const base: WorkflowQuery = {
    q: f.q ?? undefined,
    pipeline_job_id: f.job ?? undefined,
    batch_id: f.batch ?? undefined,
    language: (f.language as LangCode) ?? undefined,
    status: f.status ?? (preset ? preset.statuses : undefined),
    version: f.version ?? undefined,
    event_type: f.event_type ?? undefined,
    error_code: f.error_code ?? undefined,
    from: toEpoch(f.from),
    to: toEpoch(f.to),
    has_retries: f.retries || undefined,
    sort: f.sort as WorkflowQuery["sort"],
  };
  // KPI "today" presets use completed_at (same definition as the KPI) → filter + paginate client-side
  const clientSide = !!preset?.today && !f.status;
  const query: WorkflowQuery = clientSide ? { ...base, page: 1, pageSize: 500 } : { ...base, page: f.page, pageSize: PER };
  const { data, error, mutate, isValidating } = useApi(["workflows", "explorer", query], () => api.workflows(query), { revalidateOn: ["transition"], throttleMs: 2500 });
  const errs = useApi(["errors", "codes"], () => api.errors({ range: "7d", top: 50 }));
  const errorCodes = useMemo(() => [...new Set((errs.data?.topErrorCodes ?? []).map((e) => e.code))].sort(), [errs.data]);

  const day0 = kstDayStart(now);
  const rowsAll: WorkflowSummary[] = useMemo(() => {
    if (!data) return [];
    if (!clientSide) return data.items;
    return data.items.filter((w) => w.completed_at != null && w.completed_at >= day0);
  }, [data, clientSide, day0]);
  const total = clientSide ? rowsAll.length : data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER));
  const page = Math.min(f.page, pages);
  const rows = clientSide ? rowsAll.slice((page - 1) * PER, page * PER) : rowsAll;

  // flash rows that just changed state
  const [flash, setFlash] = useState<Record<string, number>>({});
  useStreamEvent("transition", (t) => {
    const k = Date.now();
    setFlash((x) => ({ ...x, [t.workflow_id]: k }));
    setTimeout(() => setFlash((x) => (x[t.workflow_id] === k ? Object.fromEntries(Object.entries(x).filter(([id]) => id !== t.workflow_id)) : x)), 1500);
  });

  const active = (["q", "job", "batch", "language", "status", "version", "event_type", "error_code", "from", "to", "retries", "preset"] as const).filter((k) => !!f[k]).length;
  const fq = sp.toString();

  // export (all pages for the current filter)
  const [exp, setExp] = useState<{ open: boolean; text: string; n: number; loading: boolean }>({ open: false, text: "", n: 0, loading: false });
  const doExport = async () => {
    setExp({ open: true, text: "", n: 0, loading: true });
    const r = await api.workflows({ ...base, page: 1, pageSize: 500 });
    const items = clientSide ? r.items.filter((w) => w.completed_at != null && w.completed_at >= day0) : r.items;
    const head = ["workflow_id", "status", "language", "pipeline_version", "batch_id", "input_uri", "utterances", "created_at", "wait_ms", "run_ms", "retries", "error_code", "pipeline_job_id"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head.join(",")]
      .concat(items.map((w) => [w.workflow_id, w.status, w.language, w.pipeline_version, w.batch_id, w.input.uri, w.input.utteranceCount, fmt.iso(w.created_at), w.waitMs ?? "", w.runMs ?? "", w.retries, w.lastErrorCode ?? "", w.pipeline_job_id ?? ""].map(esc).join(",")))
      .join("\r\n");
    setExp({ open: true, text: csv, n: items.length, loading: false });
  };

  return (
    <div className="screen enter">
      <div className="head-row">
        <div>
          <div className="eyebrow">Screen 3 · Firestore Registry</div>
          <h1 className="h1">Pipeline Explorer</h1>
          <div className="sub">
            Workflow 레지스트리 <span className="mono">{fmt.number(registryTotal)}</span>건 · 실시간 갱신 · 필터는 URL에 저장되어 새로고침·뒤로가기에도 유지됩니다 · 행을 누르면 Pipeline Detail
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => router.replace(pathname, { scroll: false })} disabled={!active}>
            <X aria-hidden />
            필터 초기화{active ? ` (${active})` : ""}
          </button>
          <button className="btn" onClick={doExport}>
            <FileText aria-hidden />
            목록 CSV 보기/복사
          </button>
        </div>
      </div>
      {preset && (
        <div>
          <span className="preset-chip">
            <Filter aria-hidden />
            <span className="row" style={{ gap: 5 }}>
              관제 KPI <b>{preset.label}</b> 기준 · 상태 {preset.statuses.map((s) => <StatusPill key={s} status={s} size="sm" />)}
              {preset.today && (
                <>
                  {" "}
                  · <b>오늘(KST) 종료</b>분
                </>
              )}{" "}
              · <b className="mono">{total}</b>건 (KPI 값과 같은 정의)
            </span>
            <button className="btn sm ghost" onClick={() => setFilter({ preset: null })} aria-label="KPI 필터 해제">
              <X aria-hidden />
              해제
            </button>
          </span>
        </div>
      )}
      <div className="panel">
        <div className="panel-b" style={{ paddingTop: 14 }}>
          <form className="filters" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <label className="field span2">
              <span>Workflow ID · 통합 검색 (object, trace, idempotency, DLQ)</span>
              <input className="inp mono" value={qText} onChange={(e) => setQText(e.target.value)} placeholder="wf-20261112-ko-0012" />
            </label>
            <label className="field">
              <span>PipelineJob ID</span>
              <input className="inp mono" value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="…-cycle-0-attempt-2" />
            </label>
            <label className="field">
              <span>Batch ID</span>
              <input className="inp mono" value={batchText} onChange={(e) => setBatchText(e.target.value)} placeholder="batch-20261112-en" />
            </label>
            <label className="field">
              <span>Language</span>
              <select className="inp" value={f.language ?? ""} onChange={(e) => setFilter({ language: e.target.value || null })}>
                <option value="">전체</option>
                {LANG_CODES.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()} · {LANG_LABEL[l]}
                    {data?.facets.language[l] != null ? ` (${data.facets.language[l]})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select className="inp" value={f.status ?? ""} onChange={(e) => setFilter({ status: e.target.value || null, preset: null })}>
                <option value="">전체</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label} ({s})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Pipeline Version</span>
              <select className="inp" value={f.version ?? ""} onChange={(e) => setFilter({ version: e.target.value || null })}>
                <option value="">전체</option>
                {PIPELINE_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Event Type</span>
              <select className="inp" value={f.event_type ?? ""} onChange={(e) => setFilter({ event_type: e.target.value || null })}>
                <option value="">전체</option>
                <option value="pipeline.batch.requested">batch.requested</option>
                <option value="pipeline.batch.replay.requested">batch.replay.requested</option>
              </select>
            </label>
            <label className="field">
              <span>Error Code</span>
              <select className="inp" value={f.error_code ?? ""} onChange={(e) => setFilter({ error_code: e.target.value || null })}>
                <option value="">전체</option>
                {errorCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>시작 (KST · 생성 시각)</span>
              <input className="inp mono" type="datetime-local" value={f.from ?? ""} onChange={(e) => setFilter({ from: e.target.value || null })} />
            </label>
            <label className="field">
              <span>종료 (KST)</span>
              <input className="inp mono" type="datetime-local" value={f.to ?? ""} onChange={(e) => setFilter({ to: e.target.value || null })} />
            </label>
            <label className="field">
              <span>정렬</span>
              <select className="inp" value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })}>
                {[
                  ["created_desc", "최근 생성순"],
                  ["created_asc", "오래된 순"],
                  ["wait_desc", "대기 시간 긴 순"],
                  ["run_desc", "실행 시간 긴 순"],
                  ["updated_desc", "최근 갱신순"],
                  ["attempts_desc", "Attempt 많은 순"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>&nbsp;</span>
              <span className="check">
                <input type="checkbox" checked={f.retries} onChange={(e) => setFilter({ retries: e.target.checked })} /> Retry 발생 건만
              </span>
            </label>
          </form>
        </div>
      </div>
      <div className="panel">
        <div className="panel-b" style={{ paddingTop: 10 }}>
          {error && !data ? (
            <ErrorBox error={error} retry={() => mutate()} />
          ) : !data ? (
            <Skel h={420} />
          ) : (
            <>
              <div className="tbl-wrap" style={{ opacity: isValidating && !rows.length ? 0.6 : 1 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Workflow ID</th>
                      <th>상태</th>
                      <th>언어</th>
                      <th>버전</th>
                      <th>입력 데이터</th>
                      <th>생성</th>
                      <th className="r">대기</th>
                      <th className="r">실행</th>
                      <th className="r">Retry</th>
                      <th>오류</th>
                      <th>PipelineJob</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((w) => (
                        <tr
                          key={w.workflow_id}
                          className={clsx("clickable", flash[w.workflow_id] && "flash")}
                          onClick={() => router.push(wfHref(w.workflow_id, { screen: "explorer", fq }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") router.push(wfHref(w.workflow_id, { screen: "explorer", fq }));
                          }}
                          tabIndex={0}
                        >
                          <td>
                            <span className="mono">{w.workflow_id}</span>
                            {w.replay_of && (
                              <>
                                {" "}
                                <Tag title={`replay of ${w.replay_of}`}>
                                  <RefreshCw aria-hidden />
                                  replay c{w.replay_cycle}
                                </Tag>
                              </>
                            )}
                          </td>
                          <td>
                            <StatusPill status={w.status} size="sm" />
                          </td>
                          <td>
                            <Lang code={w.language} />
                          </td>
                          <td className="mono">{w.pipeline_version}</td>
                          <td className="mono" title={w.input.uri} style={{ whiteSpace: "normal", minWidth: 130, lineHeight: 1.35 }}>
                            {w.input.object.split("/").slice(-1)[0]}
                            <br />
                            <span className="sub">
                              {w.input.utteranceCount}건 · {fmt.bytes(w.input.sizeBytes)}
                            </span>
                          </td>
                          <td className="mono">{fmt.hm(w.created_at)}</td>
                          <td className="r mono">{dur(w.waitMs)}</td>
                          <td className="r mono">
                            {w.status === "RUNNING" && w.started_at ? (
                              <span style={{ color: "var(--st-running)" }} title="실행 중 · 경과 시간">
                                {dur(now - w.started_at)}…
                              </span>
                            ) : (
                              dur(w.runMs)
                            )}
                          </td>
                          <td className="r mono">
                            {w.retries ? (
                              <>
                                <span style={{ color: "var(--st-retry)" }}>{w.retries}</span>
                                {w.status === "RETRY_WAIT" && (
                                  <span className="sub" style={{ fontSize: 10.5 }}>
                                    {" "}
                                    대기
                                  </span>
                                )}
                              </>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td className="mono" style={{ color: w.lastErrorCode ? "var(--st-failed)" : "var(--muted)" }}>
                            {w.lastErrorCode ?? "—"}
                          </td>
                          <td className="mono sub">{w.pipeline_job_id ? w.pipeline_job_id.replace(w.workflow_id, "…") : "-"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={11}>
                          <div className="empty">조건에 맞는 Workflow가 없습니다. 필터를 줄여 보세요.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pages={pages} total={total} from={total ? (page - 1) * PER + 1 : 0} to={Math.min(total, page * PER)} onPage={(p) => setF({ page: p }, { history: "push" })} />
            </>
          )}
        </div>
      </div>
      <TextModal
        open={exp.open}
        onClose={() => setExp((x) => ({ ...x, open: false }))}
        title="Workflow 목록"
        sub={`${exp.n}건 · 현재 필터 기준`}
        text={exp.text}
        loading={exp.loading}
        filename="workflows.csv"
      />
    </div>
  );
}

function useTotal() {
  const { data } = useApi(["workflows", "total"], () => api.workflows({ pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 5000 });
  return data?.total ?? 0;
}
