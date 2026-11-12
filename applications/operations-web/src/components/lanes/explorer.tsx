"use client";
/**
 * S3 — Pipeline Explorer. Every filter lives in the URL (?q=&workflow_id=&…&page=) so back/forward/reload
 * and the detail breadcrumb (?from=) keep the context. Data: GET /api/v1/workflows (server-side filtering).
 */
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Download, Repeat, Search, X } from "lucide-react";
import { LANG_CODES, PIPELINE_VERSIONS, STATES, STATUS_META } from "@/lib/catalog";
import { api, downloadText, parseAsBool, parseAsInt, parseAsList, parseAsString, useApi, useQueryStates, useSimNow, type WorkflowQuery } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, StatusPill, toneVar } from "@/components/shared";
import type { LangCode, WorkflowStatus, WorkflowSummary } from "@/lib/types";
import { Empty, ErrorBox, LangTag, dur, langName, localToMs, useAction, useHere, useToast, wfHref } from "./core";

const PARSERS = {
  q: parseAsString,
  workflow_id: parseAsString,
  pipeline_job_id: parseAsString,
  batch_id: parseAsString,
  language: parseAsList,
  status: parseAsList,
  version: parseAsString,
  event_type: parseAsString,
  error_code: parseAsString,
  from: parseAsString,
  to: parseAsString,
  retries: parseAsBool,
  sort: parseAsString.withDefault("created_desc"),
  page: parseAsInt.withDefault(1),
};
const PAGE = 100;
const SORTS: [string, string][] = [
  ["created_desc", "최신 생성"],
  ["updated_desc", "최근 갱신"],
  ["wait_desc", "대기 시간 긴 순"],
  ["run_desc", "실행 시간 긴 순"],
  ["attempts_desc", "Attempt 많은 순"],
  ["created_asc", "오래된 순"],
];

/** text input that commits to the URL after a short debounce (key it by the URL value to resync). */
function DebouncedInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (t.current) clearTimeout(t.current);
  }, []);
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => {
        const nv = e.target.value;
        setV(nv);
        if (t.current) clearTimeout(t.current);
        t.current = setTimeout(() => onCommit(nv.trim()), 260);
      }}
    />
  );
}

export function ExplorerScreen() {
  const [f, setF] = useQueryStates(PARSERS);
  const page = f.page ?? 1;
  const sort = f.sort ?? "created_desc";
  const router = useRouter();
  const here = useHere();
  const now = useSimNow();
  const act = useAction();
  const toast = useToast();
  const query: WorkflowQuery = {
    q: f.q ?? undefined,
    workflow_id: f.workflow_id ?? undefined,
    pipeline_job_id: f.pipeline_job_id ?? undefined,
    batch_id: f.batch_id ?? undefined,
    language: f.language as LangCode[],
    status: f.status,
    version: f.version ?? undefined,
    event_type: f.event_type ?? undefined,
    error_code: f.error_code ?? undefined,
    from: localToMs(f.from) ?? undefined,
    to: localToMs(f.to) ?? undefined,
    has_retries: f.retries || undefined,
    sort: sort as WorkflowQuery["sort"],
    page,
    pageSize: PAGE,
  };
  const q = useApi(["lanes-explorer", query], () => api.workflows(query), { revalidateOn: ["transition"], throttleMs: 2000 });
  const errs = useApi(["lanes-errcodes"], () => api.errors({ range: "7d", top: 40 }), { revalidateOnFocus: false });
  const cfg = useApi(["lanes-config"], () => api.config(), { revalidateOn: ["audit"] });
  const backoff = cfg.data?.retry.backoffSeconds ?? [60, 300];
  const set = (patch: Partial<typeof f>) => setF({ ...patch, page: 1 }, { history: "push" });
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const runOf = (w: WorkflowSummary) => (w.runMs ? { ms: w.runMs, live: false } : { ms: w.started_at && !w.completed_at ? Math.max(0, now - w.started_at) : 0, live: true });
  const boOf = (w: WorkflowSummary) => backoff.slice(0, Math.max(0, w.attemptsCount - 1)).reduce((s, x) => s + x * 1000, 0);
  const maxT = Math.max(1, ...rows.map((w) => (w.waitMs ?? 0) + runOf(w).ms + boOf(w)));
  const facetSt = q.data?.facets.status ?? {};
  const active = Object.entries(f).filter(([k, v]) => !["sort", "page"].includes(k) && (Array.isArray(v) ? v.length : v)).length;

  const exportCsv = async () => {
    const all = await act(() => api.workflows({ ...query, page: 1, pageSize: 500 }));
    if (!all) return;
    const cols = ["workflow_id", "language", "status", "attempt", "retries", "pipeline_version", "batch_id", "event_type", "pipeline_job_id", "wait_ms", "run_ms", "error_code", "input_uri", "created_at"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(",")].concat(
      all.items.map((w) =>
        [w.workflow_id, w.language, w.status, w.attempt, w.retries, w.pipeline_version, w.batch_id, w.event_type, w.pipeline_job_id, w.waitMs, w.runMs, w.lastErrorCode, w.input.uri, fmt.iso(w.created_at)].map(esc).join(","),
      ),
    );
    downloadText("﻿" + lines.join("\r\n"), `workflows_${fmt.date(now)}.csv`, "text/csv;charset=utf-8");
    toast(`workflows_${fmt.date(now)}.csv · ${all.items.length}행 내보내기`, "success");
  };

  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Screen 3 · Search & filter</div>
          <h1>Pipeline Explorer</h1>
          <p>Workflow · PipelineJob · Batch · Error Code로 검색합니다. 필터는 URL에 보존되어, 상세 화면에서 돌아오거나 새로고침해도 그대로 유지됩니다.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn" onClick={() => router.push("/lanes/explorer")} disabled={!active}>
            <X />
            필터 초기화
          </button>
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            <Download />
            목록 CSV
          </button>
        </div>
      </div>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <label className="fld span2">
          <span>통합 검색 (id · object · trace · DLQ · error)</span>
          <DebouncedInput key={"q" + (f.q ?? "")} className="inp" value={f.q ?? ""} onCommit={(v) => set({ q: v || null })} placeholder="예: ko-0022, VERTEX_QUOTA, corr-…" />
        </label>
        <label className="fld">
          <span>Workflow ID</span>
          <DebouncedInput key={"w" + (f.workflow_id ?? "")} className="inp mono" value={f.workflow_id ?? ""} onCommit={(v) => set({ workflow_id: v || null })} placeholder="wf-20261112-…" />
        </label>
        <label className="fld">
          <span>PipelineJob ID</span>
          <DebouncedInput key={"p" + (f.pipeline_job_id ?? "")} className="inp mono" value={f.pipeline_job_id ?? ""} onCommit={(v) => set({ pipeline_job_id: v || null })} placeholder="…-cycle-0-attempt-2" />
        </label>
        <label className="fld">
          <span>Batch ID</span>
          <DebouncedInput key={"b" + (f.batch_id ?? "")} className="inp mono" value={f.batch_id ?? ""} onCommit={(v) => set({ batch_id: v || null })} placeholder="batch-…" />
        </label>
        <label className="fld">
          <span>Language</span>
          <select className="inp" value={f.language[0] ?? ""} onChange={(e) => set({ language: e.target.value ? [e.target.value] : [] })}>
            <option value="">전체</option>
            {LANG_CODES.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Pipeline Version</span>
          <select className="inp" value={f.version ?? ""} onChange={(e) => set({ version: e.target.value || null })}>
            <option value="">전체</option>
            {PIPELINE_VERSIONS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Event Type</span>
          <select className="inp" value={f.event_type ?? ""} onChange={(e) => set({ event_type: e.target.value || null })}>
            <option value="">전체</option>
            {["pipeline.batch.requested", "pipeline.batch.replay.requested"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Error Code</span>
          <select className="inp mono" value={f.error_code ?? ""} onChange={(e) => set({ error_code: e.target.value || null })}>
            <option value="">전체</option>
            {(errs.data?.topErrorCodes ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} ({c.count})
              </option>
            ))}
            {f.error_code && !errs.data?.topErrorCodes.some((c) => c.code === f.error_code) && <option>{f.error_code}</option>}
          </select>
        </label>
        <label className="fld">
          <span>생성 시작 (from, KST)</span>
          <input className="inp" type="datetime-local" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
        </label>
        <label className="fld">
          <span>생성 종료 (to, KST)</span>
          <input className="inp" type="datetime-local" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
        </label>
        <label className="fld">
          <span>정렬</span>
          <select className="inp" value={sort} onChange={(e) => set({ sort: e.target.value })}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="fld full">
          <span>Status {q.data && <span className="dim">· 결과 내 분포</span>}</span>
          <div className="fchips">
            {STATES.map((s) => {
              const on = f.status.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  className="st-pill stbtn"
                  data-size="sm"
                  style={{ ["--tone" as string]: toneVar(STATUS_META[s].tone) }}
                  aria-pressed={on}
                  onClick={() => set({ status: on ? f.status.filter((x) => x !== s) : [...f.status, s] })}
                >
                  <CatalogIcon name={STATUS_META[s].icon} />
                  {STATUS_META[s].label}
                  {facetSt[s as WorkflowStatus] ? <b className="mono" style={{ marginLeft: 2 }}>{facetSt[s as WorkflowStatus]}</b> : null}
                </button>
              );
            })}
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 10, fontSize: 12 }}>
              <input type="checkbox" className="chk" checked={f.retries} onChange={(e) => set({ retries: e.target.checked })} />
              Retry 발생만
            </label>
          </div>
        </div>
      </form>
      <div className="panel flush">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <b className="disp" style={{ fontSize: 22 }}>
            {fmt.number(total)}
          </b>
          <span className="muted" style={{ fontWeight: 500 }}>
            workflows {q.isValidating && <span className="dim">· 갱신 중</span>}
          </span>
          <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
            행 클릭 → Pipeline Detail · 막대는 대기(회색) / 실행(파랑, 빗금=진행 중) / Retry Backoff(주황)
          </span>
        </div>
        {q.error && !q.data ? (
          <div style={{ padding: 14 }}>
            <ErrorBox error={q.error} retry={() => q.mutate()} />
          </div>
        ) : (
          <div className="scroll-x" style={{ maxHeight: 680, overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Workflow ID</th>
                  <th>언어</th>
                  <th>상태</th>
                  <th>Version</th>
                  <th className="r">Retry</th>
                  <th style={{ minWidth: 180 }}>대기 · 실행 · Backoff</th>
                  <th className="r">대기</th>
                  <th className="r">실행</th>
                  <th>입력 데이터</th>
                  <th>오류</th>
                  <th>생성</th>
                </tr>
              </thead>
              <tbody>
                {!q.data
                  ? Array.from({ length: 8 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={11}>
                          <div className="skel" />
                        </td>
                      </tr>
                    ))
                  : rows.map((w) => {
                      const ro = runOf(w);
                      const bo = boOf(w);
                      return (
                        <tr key={w.workflow_id} className="click" onClick={() => router.push(wfHref(w.workflow_id, here))}>
                          <td className="mono">
                            <Link href={wfHref(w.workflow_id, here)} className="copy-id" onClick={(e) => e.stopPropagation()}>
                              {w.replay_of && <Repeat className="i sm" />} {w.workflow_id}
                            </Link>
                            <div className="dim" style={{ fontSize: 10 }}>
                              {w.pipeline_job_id ?? "—"}
                            </div>
                          </td>
                          <td>
                            <LangTag code={w.language} />
                          </td>
                          <td>
                            <StatusPill status={w.status} />
                          </td>
                          <td className="mono">{w.pipeline_version}</td>
                          <td className="r mono" style={w.retries ? { color: "var(--st-retry)", fontWeight: 700 } : undefined}>
                            {w.retries}
                          </td>
                          <td>
                            <span style={{ display: "flex", height: 7, borderRadius: 2, overflow: "hidden", background: "var(--sunken)", width: "100%" }}>
                              <i style={{ width: `${((w.waitMs ?? 0) / maxT) * 100}%`, background: "var(--st-queued)", opacity: 0.6 }} />
                              <i
                                style={{
                                  width: `${(ro.ms / maxT) * 100}%`,
                                  background:
                                    ro.live && ro.ms
                                      ? "repeating-linear-gradient(135deg,var(--st-running) 0 4px,color-mix(in srgb,var(--st-running) 55%,transparent) 4px 7px)"
                                      : "var(--st-running)",
                                }}
                              />
                              <i style={{ width: `${(bo / maxT) * 100}%`, background: "var(--st-retry)" }} />
                            </span>
                          </td>
                          <td className="r mono">{dur(w.waitMs)}</td>
                          <td className="r mono">
                            {ro.ms ? dur(ro.ms) : "—"}
                            {ro.live && ro.ms ? (
                              <div className="dim" style={{ fontSize: 10 }}>
                                경과 · 진행 중
                              </div>
                            ) : null}
                          </td>
                          <td className="mono muted trunc" title={w.input.uri}>
                            {w.input.object} · {fmt.number(w.input.utteranceCount)}건
                          </td>
                          <td>
                            {w.error || w.lastErrorCode ? (
                              <>
                                <span className="mono" style={{ color: "var(--st-failed)", fontSize: 11 }}>
                                  {w.error?.code ?? w.lastErrorCode}
                                </span>
                                <div className="dim" style={{ fontSize: 10 }}>
                                  {w.error?.node ?? ""}
                                </div>
                              </>
                            ) : (
                              <span className="dim">—</span>
                            )}
                          </td>
                          <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
                            {fmt.date(w.created_at).slice(5)} {fmt.hm(w.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                {q.data && !rows.length && (
                  <tr>
                    <td colSpan={11}>
                      <Empty icon={<Search className="i" />}>조건에 맞는 Workflow가 없습니다 — 필터를 줄여 보세요</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="pager">
          <span>
            {page} / {pages} 페이지 · {PAGE}개씩
          </span>
          <button type="button" className={clsx("btn sm")} disabled={page <= 1} onClick={() => setF({ page: page - 1 }, { history: "push" })}>
            이전
          </button>
          <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 }, { history: "push" })}>
            다음
          </button>
        </div>
      </div>
    </section>
  );
}
