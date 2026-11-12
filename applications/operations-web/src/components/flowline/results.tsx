"use client";
/**
 * U1 Evaluation Results — reads the result CSV in GCS (via the mock API), pass/fail summary,
 * filterable charts, real CSV download (Content-Disposition from the API route), selected-rows CSV,
 * and the utterance detail drawer (?utt=).
 */
import clsx from "clsx";
import { AlertTriangle, Check, CheckCircle, Copy, Download, ExternalLink, FileCheck, FileText, Filter, RefreshCw, Table2, X, XOctagon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { CAPSULE_BY_ID, FAILURE_REASON_META, LANG_CODES, LANG_LABEL, PIPELINE_VERSIONS } from "@/lib/catalog";
import { api, csvUrl, downloadCsv, parseAsInt, parseAsString, useApi, useQueryStates, useSimNow, useStreamEvent, type ResultQuery } from "@/lib/client";
import { fmt, kstDayStart } from "@/lib/format";
import type { FailureReason, LangCode, ResultRow } from "@/lib/types";
import { accent, axX, axY, baseOpt, itemTooltip } from "./chart";
import { wfHref } from "./nav-store";
import { useDebouncedParam } from "./use-debounced-param";
import { Drawer, Empty, ErrorBox, JsonView, Lang, Pager, Panel, Skel, Tag, TextModal, useCopy, usePerm, useToast } from "./ui";

const PARSERS = {
  file: parseAsInt,
  language: parseAsString,
  workflow_id: parseAsString,
  version: parseAsString,
  capsule: parseAsString,
  intent: parseAsString,
  device: parseAsString,
  date: parseAsString,
  result: parseAsString,
  reason: parseAsString,
  q: parseAsString,
  sort: parseAsString,
  page: parseAsInt,
  utt: parseAsString,
};
const FILE_VERSION: Record<number, string | undefined> = { 0: undefined, 1: "v1.2-rc", 2: "v1.1" };
const PER = 25;

function fileLabel(name: string) {
  const n = name.split("/").pop() ?? name;
  return /_only\.csv$/.test(n) ? `${n.replace("results_", "").replace("_only.csv", "")} 단독` : "전체 버전 비교본 (v1.2-rc 후보 + v1.1 기준)";
}

export function Results() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const now = useSimNow();
  const toast = useToast();
  const { can } = usePerm();
  const [f, setF] = useQueryStates(PARSERS);
  const fileIdx = f.file ?? 0;
  const page = f.page ?? 1;
  const setFilter = useCallback((p: Partial<typeof f>) => setF({ ...p, page: null }), [setF]);
  const writeQ = useCallback((v: string | null) => setFilter({ q: v }), [setFilter]);
  const [qText, setQText] = useDebouncedParam(f.q, writeQ, 250);

  const fileVersion = FILE_VERSION[fileIdx];
  const version = f.version ?? fileVersion;
  const dayFrom = f.date ? kstDayStart(Date.parse(f.date + "T12:00:00+09:00")) : undefined;
  const filters: ResultQuery = {
    language: (f.language as LangCode) ?? undefined,
    workflow_id: f.workflow_id ?? undefined,
    version: version ?? undefined,
    capsule: f.capsule ?? undefined,
    intent: f.intent ?? undefined,
    device: f.device ?? undefined,
    result: (f.result as "PASS" | "FAIL") ?? undefined,
    failure_reason: f.reason ?? undefined,
    q: f.q ?? undefined,
    from: dayFrom,
    to: dayFrom != null ? dayFrom + 86400e3 - 1 : undefined,
    sort: (f.sort as ResultQuery["sort"]) ?? undefined,
  };
  const query: ResultQuery = { ...filters, page, pageSize: PER };
  const meta = useApi(["results-file"], () => api.resultFile(), { revalidateOn: ["transition"], throttleMs: 5000 });
  const base = useApi(["results", "base", fileVersion ?? "all"], () => api.results({ version: fileVersion, pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 5000 });
  const res = useApi(["results", "page", query], () => api.results(query), { revalidateOn: ["transition"], throttleMs: 5000 });
  const batches = useApi(["workflows", "succeeded-batches"], () => api.workflows({ status: ["SUCCEEDED"], pageSize: 500, sort: "created_desc" }), { revalidateOn: ["transition"], throttleMs: 8000 });

  const file = meta.data?.files[fileIdx] ?? meta.data?.file;
  const agg = res.data?.aggregates;
  const baseAgg = base.data?.aggregates;
  const activeN = (["language", "workflow_id", "version", "capsule", "intent", "device", "date", "result", "reason", "q"] as const).filter((k) => !!f[k]).length;
  const total = res.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER));

  // selection
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // live commits: inline chip + at most one toast per 20 s
  const [liveRows, setLiveRows] = useState(0);
  const lastToast = useRef(0);
  useStreamEvent("transition", (t) => {
    if (t.to !== "SUCCEEDED") return;
    setLiveRows((n) => n + 1);
    const k = Date.now();
    if (k - lastToast.current > 20000) {
      lastToast.current = k;
      toast(
        <>
          결과 CSV 갱신 · <span className="mono">{t.workflow_id}</span> commit
        </>,
        "success",
      );
    }
  });

  // CSV view / download
  const [view, setView] = useState<{ open: boolean; text: string; loading: boolean; title: string; sub: string; dl?: () => void }>({ open: false, text: "", loading: false, title: "", sub: "" });
  const fileBase = (file?.name.split("/").pop() ?? "results.csv").replace(".csv", "");
  const dlName = fileBase + (activeN ? "_filtered" : "") + ".csv";
  const viewCsv = async (q: ResultQuery, title: string, sub: string, dl: () => void) => {
    setView({ open: true, text: "", loading: true, title, sub, dl });
    const r = await fetch(csvUrl(q), { cache: "no-store" });
    const text = (await r.text()).replace(/^﻿/, "");
    setView({ open: true, text, loading: false, title, sub: `${sub} · ${r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? ""}`, dl });
  };
  const downloadFiltered = () => {
    downloadCsv(filters, { filename: dlName });
    toast(
      <>
        <span className="mono">{dlName}</span> 다운로드 ({fmt.number(total)} rows · UTF-8 BOM)
      </>,
    );
  };
  const downloadSelected = () => {
    downloadCsv({ ids: [...sel] }, { filename: `${fileBase}_selected.csv` });
    toast(`선택 ${sel.size}행 CSV 다운로드`);
  };

  const option = (k: string, label: string) => (
    <option key={k} value={k}>
      {label}
    </option>
  );
  const keys = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).sort();

  return (
    <div className="screen enter">
      <div className="head-row">
        <div>
          <div className="eyebrow">Evaluation Results · Vertex AI 출력</div>
          <h1 className="h1">평가 결과 (PASS / FAIL)</h1>
          <div className="sub">Result Aggregation이 GCS에 기록한 결과 CSV를 그대로 읽어 집계합니다. 새 배치가 성공하면 행이 자동으로 추가됩니다.</div>
        </div>
      </div>
      <div className="file-card">
        <div className="fi">
          <FileCheck aria-hidden />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 8 }}>
            <select className="inp" style={{ width: "auto", maxWidth: "100%", minWidth: 0 }} aria-label="결과 파일" value={fileIdx} onChange={(e) => setF({ file: +e.target.value || null, version: null, page: null })}>
              {(meta.data?.files ?? []).map((x, i) => (
                <option key={x.name} value={i}>
                  {fileLabel(x.name)} — {x.name.split("/").pop()}
                </option>
              ))}
            </select>
            {file && <Tag title="GCS metadata scope">scope: {file.scope}</Tag>}
            {liveRows > 0 && (
              <span className="live-chip" title="세션 시작 후 새로 commit된 결과 배치">
                <RefreshCw aria-hidden />
                라이브 +{liveRows} batch
              </span>
            )}
          </div>
          <code className="mono">{file ? file.uri : "gs://…"}</code>
          {fileIdx === 0 && (
            <span className="sub">
              파일명은 <span className="mono">results_{"{후보 버전}"}.csv</span> 명명 규칙을 따르며, 후보 v1.2-rc와 기준선 v1.1 행을 <b>모두</b> 포함한 비교본입니다. 단일 버전만 보려면 <span className="mono">_only</span> 파일을 고르세요.
            </span>
          )}
          <span className="sub">
            {file ? (
              <>
                <span className="mono">{fmt.bytes(file.sizeBytes)}</span> · <span className="mono">{fmt.number(baseAgg?.total ?? file.rowCount)}</span> rows · 생성 <span className="mono">{fmt.dateTime(file.generatedAt)}</span> ({fmt.relative(file.generatedAt, now)}) ·{" "}
                {meta.data?.columns.length ?? "-"} columns · BigQuery <span className="mono">{meta.data?.bigquery.table}</span>
              </>
            ) : (
              "파일 메타데이터를 불러오는 중…"
            )}
          </span>
        </div>
        <div className="row end">
          <button className="btn primary" onClick={downloadFiltered} disabled={!can("export")} title={can("export") ? "API에서 CSV 파일 다운로드" : "export 권한 필요"}>
            <Download aria-hidden />
            CSV 다운로드{activeN ? " (필터)" : ""}
          </button>
          <button className="btn" onClick={() => viewCsv(filters, "결과 CSV", `${file?.uri ?? ""} · ${fmt.number(total)} rows${activeN ? " (필터 적용)" : ""}`, downloadFiltered)}>
            <FileText aria-hidden />
            CSV 보기/복사
          </button>
          <button className="btn" disabled={!sel.size} onClick={downloadSelected}>
            <Check aria-hidden />
            {`선택 행만 (${sel.size})`}
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-b" style={{ paddingTop: 14 }}>
          <div className="filters">
            <label className="field span2">
              <span>발화 · ID · 응답 검색</span>
              <input className="inp" value={qText} onChange={(e) => setQText(e.target.value)} placeholder="예: 데이식스, utt-20261112-ko" />
            </label>
            <label className="field">
              <span>언어</span>
              <select className="inp" value={f.language ?? ""} onChange={(e) => setFilter({ language: e.target.value || null })}>
                <option value="">전체</option>
                {LANG_CODES.filter((l) => !baseAgg || baseAgg.byLanguage[l]).map((l) => option(l, `${l.toUpperCase()} · ${LANG_LABEL[l]}`))}
              </select>
            </label>
            <label className="field">
              <span>배치 (Workflow)</span>
              <select className="inp mono" value={f.workflow_id ?? ""} onChange={(e) => setFilter({ workflow_id: e.target.value || null })}>
                <option value="">전체</option>
                {f.workflow_id && !(batches.data?.items ?? []).some((w) => w.workflow_id === f.workflow_id) && option(f.workflow_id, f.workflow_id)}
                {(batches.data?.items ?? []).filter((w) => (w.result?.rows ?? 0) > 0 && (!f.language || w.language === f.language)).map((w) => option(w.workflow_id, w.workflow_id))}
              </select>
            </label>
            <label className="field">
              <span>Pipeline 버전</span>
              <select className="inp" value={f.version ?? ""} onChange={(e) => setFilter({ version: e.target.value || null })} disabled={!!fileVersion}>
                <option value="">{fileVersion ? `${fileVersion} (파일 범위)` : "전체"}</option>
                {!fileVersion && PIPELINE_VERSIONS.filter((v) => !baseAgg || baseAgg.byVersion[v]).map((v) => option(v, v))}
              </select>
            </label>
            <label className="field">
              <span>캡슐 / 도메인</span>
              <select className="inp" value={f.capsule ?? ""} onChange={(e) => setFilter({ capsule: e.target.value || null })}>
                <option value="">전체</option>
                {keys(baseAgg?.byCapsule).map((c) => option(c, CAPSULE_BY_ID[c]?.label ?? c))}
              </select>
            </label>
            <label className="field">
              <span>Intent (기대)</span>
              <select className="inp mono" value={f.intent ?? ""} onChange={(e) => setFilter({ intent: e.target.value || null })}>
                <option value="">전체</option>
                {keys(baseAgg?.byIntent)
                  .filter((i) => !f.capsule || i === f.intent || !!res.data?.aggregates.byIntent[i])
                  .map((i) => option(i, i))}
              </select>
            </label>
            <label className="field">
              <span>디바이스</span>
              <select className="inp" value={f.device ?? ""} onChange={(e) => setFilter({ device: e.target.value || null })}>
                <option value="">전체</option>
                {keys(baseAgg?.byDevice).map((d) => option(d, d))}
              </select>
            </label>
            <label className="field">
              <span>평가 일자</span>
              <select className="inp mono" value={f.date ?? ""} onChange={(e) => setFilter({ date: e.target.value || null })}>
                <option value="">전체</option>
                {keys(baseAgg?.byDate).map((d) => option(d, d))}
              </select>
            </label>
            <label className="field">
              <span>결과</span>
              <select className="inp" value={f.result ?? ""} onChange={(e) => setFilter({ result: e.target.value || null })}>
                <option value="">전체</option>
                {option("PASS", "PASS")}
                {option("FAIL", "FAIL")}
              </select>
            </label>
            <label className="field">
              <span>실패 사유</span>
              <select className="inp" value={f.reason ?? ""} onChange={(e) => setFilter({ reason: e.target.value || null })}>
                <option value="">전체</option>
                {(Object.keys(FAILURE_REASON_META) as FailureReason[]).map((r) => option(r, FAILURE_REASON_META[r].label))}
              </select>
            </label>
            <label className="field">
              <span>정렬</span>
              <select className="inp" value={f.sort ?? "eval_desc"} onChange={(e) => setFilter({ sort: e.target.value === "eval_desc" ? null : e.target.value })}>
                {[
                  ["eval_desc", "최근 평가순"],
                  ["eval_asc", "오래된 평가순"],
                  ["score_asc", "Judge 낮은 순"],
                  ["score_desc", "Judge 높은 순"],
                  ["latency_desc", "지연 긴 순"],
                  ["id_asc", "utterance_id"],
                ].map(([v, l]) => option(v, l))}
              </select>
            </label>
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
            <span className="sub">
              {activeN ? `필터 ${activeN}개 적용 · ` : ""}
              <span className="mono">{fmt.number(total)}</span> / <span className="mono">{fmt.number(baseAgg?.total ?? 0)}</span> rows
            </span>
            {activeN > 0 && (
              <button className="btn sm ghost" onClick={() => router.replace(fileIdx ? `${pathname}?file=${fileIdx}` : pathname, { scroll: false })}>
                <X aria-hidden />
                필터 초기화
              </button>
            )}
          </div>
        </div>
      </div>
      {res.error && !res.data ? (
        <ErrorBox error={res.error} retry={() => res.mutate()} />
      ) : (
        <>
          <div className="grid g-5-7">
            <Panel title="Pass Rate" right={<span className="sub">필터 적용 결과</span>} bodyClassName="stack" bodyStyle={{ gap: 14 }}>
              {agg ? (
                <>
                  <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
                    <span className="big-rate">{fmt.pct(agg.passRate, 1)}</span>
                    <div className="sub stack" style={{ gap: 2 }}>
                      <b className="row" style={{ color: "var(--st-success)", gap: 4 }}>
                        <CheckCircle size={14} aria-hidden /> PASS <span className="mono">{fmt.number(agg.pass)}</span>
                      </b>
                      <b className="row" style={{ color: "var(--st-failed)", gap: 4 }}>
                        <XOctagon size={14} aria-hidden /> FAIL <span className="mono">{fmt.number(agg.fail)}</span>
                      </b>
                    </div>
                  </div>
                  <div className="passbar">
                    <i style={{ width: `${((agg.passRate ?? 0) * 100).toFixed(2)}%`, background: "var(--st-success)" }} />
                    <i style={{ width: `${(100 - (agg.passRate ?? 0) * 100).toFixed(2)}%`, background: "var(--st-failed)" }} />
                  </div>
                  <div className="metric-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                    <div>
                      <small>전체 발화</small>
                      <b>{fmt.number(agg.total)}</b>
                    </div>
                    <div>
                      <small>평균 Judge score</small>
                      <b>{agg.avgJudgeScore != null ? agg.avgJudgeScore.toFixed(2) : "-"}</b>
                    </div>
                    <div>
                      <small>지연 p50 / p95</small>
                      <b>
                        {fmt.number(agg.latency.p50Ms)} / {fmt.number(agg.latency.p95Ms)}
                        <small>ms</small>
                      </b>
                    </div>
                    <div>
                      <small>Judge score 분포</small>
                      <b className="row" style={{ gap: 1, alignItems: "flex-end", height: 22 }} aria-label="Judge score 히스토그램">
                        {agg.judgeScoreHistogram.map((n, i) => (
                          <i key={i} title={`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${n}`} style={{ display: "block", width: 6, height: `${Math.max(2, (n / Math.max(1, ...agg.judgeScoreHistogram)) * 22)}px`, background: i >= 7 ? "var(--st-success)" : "var(--st-failed)", borderRadius: 1, opacity: 0.85 }} />
                        ))}
                      </b>
                    </div>
                  </div>
                  <ReasonChart byReason={agg.byFailureReason} onPick={(r) => setFilter({ reason: r, result: "FAIL" })} />
                </>
              ) : (
                <Skel h={380} />
              )}
            </Panel>
            <Panel title="캡슐별 PASS / FAIL" right={<span className="sub">막대를 누르면 해당 캡슐로 필터</span>}>
              {agg ? <CapsuleChart byCapsule={agg.byCapsule} onPick={(c) => setFilter({ capsule: c })} /> : <Skel h={300} />}
            </Panel>
          </div>
          <div className="grid g3">
            <Panel title="언어별 Pass rate">{agg ? <LangChart byLanguage={agg.byLanguage} onPick={(l) => setFilter({ language: l })} /> : <Skel h={180} />}</Panel>
            <Panel title="버전 × 캡슐 Pass rate" right={<span className="sub">v1.1 vs v1.2-rc</span>}>
              {agg ? <VersionCapsuleChart cv={agg.byCapsuleVersion} /> : <Skel h={180} />}
            </Panel>
            <Panel title="응답 지연 분포" right={<span className="sub">latency_ms · 0.5s 구간 · 8s 초과 = TIMEOUT</span>}>
              {agg ? <LatencyChart hist={agg.latencyHistogram} fine={agg.latencyHistogramFine} /> : <Skel h={180} />}
            </Panel>
          </div>
        </>
      )}
      <Panel title="발화 단위 결과" icon={<Table2 aria-hidden />} right={<span className="sub">행 클릭 → 발화 상세 · 체크박스로 선택 내보내기</span>}>
        {!res.data ? (
          <Skel h={420} />
        ) : (
          <>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="이 페이지 전체 선택"
                        checked={res.data.rows.length > 0 && res.data.rows.every((r) => sel.has(r.utterance_id))}
                        onChange={(e) => res.data!.rows.forEach((r) => toggle(r.utterance_id, e.target.checked))}
                      />
                    </th>
                    <th>결과</th>
                    <th className="ko">발화</th>
                    <th>언어</th>
                    <th className="ko">캡슐</th>
                    <th>Intent 기대 → 예측</th>
                    <th className="r">Judge</th>
                    <th className="ko">실패 사유</th>
                    <th className="r">지연</th>
                    <th className="ko">디바이스</th>
                    <th>버전</th>
                    <th>utterance_id</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.rows.length ? (
                    res.data.rows.map((r) => (
                      <tr
                        key={r.utterance_id}
                        className={clsx("clickable", f.utt === r.utterance_id && "sel")}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("input")) return;
                          setF({ utt: r.utterance_id }, { history: "push" });
                        }}
                      >
                        <td>
                          <input type="checkbox" checked={sel.has(r.utterance_id)} onChange={(e) => toggle(r.utterance_id, e.target.checked)} aria-label={`${r.utterance_id} 선택`} />
                        </td>
                        <td>
                          <ResultPill r={r.result} />
                        </td>
                        <td title={r.utterance_text}>
                          <div style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{r.utterance_text}</div>
                        </td>
                        <td>
                          <Lang code={r.language} />
                        </td>
                        <td>{r.capsule}</td>
                        <td className="mono" style={{ fontSize: 11.5, whiteSpace: "normal", minWidth: 150, overflowWrap: "anywhere" }}>
                          {r.intent_expected}
                          {r.intent_expected !== r.intent_predicted && (
                            <>
                              {" "}
                              → <span style={{ color: "var(--st-failed)" }}>{r.intent_predicted}</span>
                            </>
                          )}
                        </td>
                        <td className="r mono" style={{ color: r.judge_score >= 0.7 ? "var(--st-success)" : "var(--st-failed)" }}>
                          {r.judge_score.toFixed(2)}
                        </td>
                        <td>{r.failure_reason ? <ReasonPill reason={r.failure_reason} /> : <span className="sub">—</span>}</td>
                        <td className="r mono">{fmt.number(r.latency_ms)}ms</td>
                        <td>{r.device_type}</td>
                        <td className="mono">{r.pipeline_version}</td>
                        <td className="mono sub">{r.utterance_id}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12}>
                        <div className="empty">조건에 맞는 발화가 없습니다</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager
              page={Math.min(page, pages)}
              pages={pages}
              total={total}
              unit="행"
              from={total ? (Math.min(page, pages) - 1) * PER + 1 : 0}
              to={Math.min(total, Math.min(page, pages) * PER)}
              onPage={(p) => setF({ page: p === 1 ? null : p }, { history: "push" })}
              extra={
                sel.size ? (
                  <>
                    · 선택 <span className="mono">{sel.size}</span>
                    <button className="btn sm ghost" onClick={() => setSel(new Set())}>
                      선택 해제
                    </button>
                  </>
                ) : null
              }
            />
          </>
        )}
      </Panel>
      <UtteranceDrawer id={f.utt} onClose={() => setF({ utt: null })} onSameBatch={(wf) => setF({ workflow_id: wf, utt: null, page: null })} fq={sp.toString()} />
      <TextModal open={view.open} onClose={() => setView((v) => ({ ...v, open: false }))} title={view.title} sub={view.sub} text={view.text} loading={view.loading} onDownload={view.dl} />
    </div>
  );
}

function ResultPill({ r }: { r: "PASS" | "FAIL" }) {
  return r === "PASS" ? (
    <span className="pill sm t-success">
      <CheckCircle aria-hidden />
      PASS
    </span>
  ) : (
    <span className="pill sm t-failed">
      <XOctagon aria-hidden />
      FAIL
    </span>
  );
}
function ReasonPill({ reason }: { reason: string }) {
  const m = FAILURE_REASON_META[reason as FailureReason];
  return (
    <span className={`pill sm t-${m?.tone ?? "failed"}`}>
      <AlertTriangle aria-hidden />
      {m?.label ?? reason}
    </span>
  );
}

// ───────────────────────────── charts ──
type Rate = { total: number; pass: number; fail: number; passRate: number | null };

function ReasonChart({ byReason, onPick }: { byReason: Partial<Record<FailureReason, number>>; onPick: (r: string) => void }) {
  const reasons = Object.entries(byReason).sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0)) as [FailureReason, number][];
  const sig = JSON.stringify(reasons);
  const option = useMemo(
    () => (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        tooltip: itemTooltip(t),
        grid: { left: 6, right: 34, top: 4, bottom: 4, containLabel: true },
        xAxis: axY(t, { splitNumber: 3 }),
        yAxis: axX(t, reasons.map(([k]) => FAILURE_REASON_META[k]?.label ?? k), { axisLabel: { color: t.text, fontSize: 11, fontFamily: t.font } }),
        series: [
          {
            type: "bar",
            barWidth: 9,
            cursor: "pointer",
            label: { show: true, position: "right", color: t.text, fontSize: 10.5, fontFamily: t.mono },
            data: reasons.map(([k, v]) => ({ value: v, itemStyle: { color: t.tone[FAILURE_REASON_META[k]?.tone ?? "failed"], borderRadius: 2 } })),
          },
        ],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  if (!reasons.length) return <Empty>실패 사유가 없습니다</Empty>;
  return <EChart className="chart short" option={option} onEvents={{ click: (p) => onPick(reasons[(p as { dataIndex: number }).dataIndex][0]) }} ariaLabel="실패 사유 분포" />;
}

function CapsuleChart({ byCapsule, onPick }: { byCapsule: Record<string, Rate>; onPick: (c: string) => void }) {
  const caps = Object.entries(byCapsule).sort((a, b) => (a[1].passRate ?? 0) - (b[1].passRate ?? 0));
  const sig = JSON.stringify(caps);
  const option = useMemo(
    () => (t: ChartTokens) =>
      baseOpt(t, {
        tooltip: { ...(baseOpt(t, {}).tooltip as object), axisPointer: { type: "shadow" } },
        grid: { left: 6, right: 44, top: 28, bottom: 4, containLabel: true },
        xAxis: axY(t),
        yAxis: axX(t, caps.map(([c]) => CAPSULE_BY_ID[c]?.label ?? c), { axisLabel: { color: t.text, fontSize: 11, fontFamily: t.font } }),
        series: [
          { name: "PASS", type: "bar", stack: "a", barWidth: 12, cursor: "pointer", itemStyle: { color: t.tone.success }, data: caps.map(([, v]) => v.pass) },
          {
            name: "FAIL",
            type: "bar",
            stack: "a",
            barWidth: 12,
            cursor: "pointer",
            itemStyle: { color: t.tone.failed },
            label: { show: true, position: "right", color: t.text, fontSize: 10.5, fontFamily: t.mono, formatter: (p: { dataIndex: number }) => fmt.pct(caps[p.dataIndex][1].passRate, 0) },
            data: caps.map(([, v]) => v.fail),
          },
        ],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  return <EChart className="chart tall" option={option} onEvents={{ click: (p) => onPick(caps[(p as { dataIndex: number }).dataIndex][0]) }} ariaLabel="캡슐별 PASS/FAIL" />;
}

function LangChart({ byLanguage, onPick }: { byLanguage: Record<string, Rate>; onPick: (l: string) => void }) {
  const ls = LANG_CODES.filter((l) => byLanguage[l]);
  const sig = JSON.stringify(ls.map((l) => byLanguage[l].passRate));
  const option = useMemo(
    () => (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        tooltip: { ...(baseOpt(t, {}).tooltip as object), valueFormatter: (v: unknown) => v + "%" },
        xAxis: axX(t, ls.map((l) => l.toUpperCase())),
        yAxis: axY(t, { min: 50, max: 100, axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "{value}%" } }),
        series: [
          {
            type: "bar",
            barWidth: 22,
            cursor: "pointer",
            label: { show: true, position: "top", color: t.text, fontSize: 10.5, fontFamily: t.mono, formatter: "{c}%" },
            data: ls.map((l) => ({ value: +((byLanguage[l].passRate ?? 0) * 100).toFixed(1), itemStyle: { color: t.lang[l], borderRadius: [2, 2, 0, 0] } })),
          },
        ],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  if (!ls.length) return <Empty>데이터 없음</Empty>;
  return <EChart className="chart short" option={option} onEvents={{ click: (p) => onPick(ls[(p as { dataIndex: number }).dataIndex]) }} ariaLabel="언어별 Pass rate" />;
}

function VersionCapsuleChart({ cv }: { cv: Record<string, Record<string, Rate>> }) {
  const vers = ["v1.1", "v1.2-rc"];
  const capIds = Object.keys(cv);
  const sig = JSON.stringify(cv);
  const option = useMemo(
    () => (t: ChartTokens) =>
      baseOpt(t, {
        tooltip: { ...(baseOpt(t, {}).tooltip as object), valueFormatter: (v: unknown) => (v == null ? "-" : v + "%") },
        grid: { left: 6, right: 10, top: 28, bottom: 4, containLabel: true },
        xAxis: axX(t, capIds.map((c) => (CAPSULE_BY_ID[c]?.label ?? c).replace("(SmartThings)", "")), { axisLabel: { color: t.muted, fontSize: 9.5, rotate: 40, interval: 0, fontFamily: t.font } }),
        yAxis: axY(t, { min: 50, max: 100, axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "{value}%" } }),
        series: vers.map((v, i) => ({
          type: "bar" as const,
          name: v,
          barGap: "10%",
          itemStyle: { color: i ? accent(t) : t.tone.queued },
          data: capIds.map((c) => (cv[c][v] ? +((cv[c][v].passRate ?? 0) * 100).toFixed(1) : null)),
        })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  return <EChart className="chart short" option={option} ariaLabel="버전 × 캡슐 Pass rate" />;
}

function LatencyChart({ hist, fine }: { hist: number[]; fine?: { edgesMs: number[]; counts: number[] } }) {
  // Prefer the prototype's finer bins (0.5s → 3s, 3–4, 4–6, 6–8, 8s+); fall back to 1s buckets.
  const edges = fine?.edgesMs ?? hist.map((_, i) => i * 1000);
  const counts = fine?.counts ?? hist;
  const sig = edges.join(",") + "|" + counts.join(",");
  const option = useMemo(
    () => (t: ChartTokens) => {
      const sec = (ms: number) => `${+(ms / 1000).toFixed(1)}s`;
      const labels = edges.map((e, i) => (i === edges.length - 1 ? `${sec(e)}+` : sec(e)));
      const ranges = edges.map((e, i) => (i === edges.length - 1 ? `${sec(e)} 이상 (TIMEOUT)` : `${sec(e)} – ${sec(edges[i + 1])}`));
      return baseOpt(t, {
        legend: { show: false },
        tooltip: { ...(baseOpt(t, {}).tooltip as object), axisPointer: { type: "shadow" }, formatter: (p: unknown) => {
          const a = (Array.isArray(p) ? p[0] : p) as { dataIndex: number; value: number };
          return `${ranges[a.dataIndex]}<br/><b>${fmt.number(a.value)}</b> 발화`;
        } },
        xAxis: axX(t, labels, { axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, interval: 0 } }),
        yAxis: axY(t),
        series: [{ type: "bar", name: "발화 수", barWidth: "80%", data: counts.map((v, i) => ({ value: v, itemStyle: { color: edges[i] >= 8000 ? t.tone.failed : accent(t), borderRadius: [2, 2, 0, 0] } })) }],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  return <EChart className="chart short" option={option} ariaLabel="응답 지연 분포" />;
}

// ───────────────────────────── utterance drawer ──
function UtteranceDrawer({ id, onClose, onSameBatch, fq }: { id: string | null; onClose: () => void; onSameBatch: (wf: string) => void; fq: string }) {
  return (
    <Drawer open={!!id} onClose={onClose} labelledBy="fl-utt-title">
      {id && <UtteranceBody key={id} id={id} onClose={onClose} onSameBatch={onSameBatch} fq={fq} />}
    </Drawer>
  );
}

function UtteranceBody({ id, onClose, onSameBatch, fq }: { id: string; onClose: () => void; onSameBatch: (wf: string) => void; fq: string }) {
  const { data, error } = useApi(["result", id], () => api.result(id));
  const copy = useCopy();
  const jsonRef = useRef<HTMLDivElement>(null);
  const r: ResultRow | undefined = data?.row;
  const pass = r?.result === "PASS";
  const fr = r?.failure_reason ? FAILURE_REASON_META[r.failure_reason as FailureReason] : null;
  return (
    <>
      <div className="drawer-h">
        <div className="dh-icon" style={r ? { background: `color-mix(in srgb,var(--st-${pass ? "success" : "failed"}) 14%,transparent)`, color: `var(--st-${pass ? "success" : "failed"})` } : undefined}>
          {pass ? <CheckCircle aria-hidden /> : <XOctagon aria-hidden />}
        </div>
        <div>
          <div className="eyebrow">{id}</div>
          <div className="h1" id="fl-utt-title" style={{ fontSize: 18 }}>
            발화 평가 상세
          </div>
          {r && (
            <div className="row" style={{ marginTop: 6 }}>
              <ResultPill r={r.result} />
              {fr && <ReasonPill reason={r.failure_reason} />}
              <Lang code={r.language} />
              <Tag>{r.capsule}</Tag>
              <Tag>{r.device_type}</Tag>
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">
          <X aria-hidden />
        </button>
      </div>
      <div className="tabs" style={{ display: "none" }} />
      <div className="drawer-b">
        {error ? (
          <ErrorBox error={error} />
        ) : !r ? (
          <Skel h={400} />
        ) : (
          <div className="utt">
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                사용자 발화
              </div>
              <div className="utt-q">“{r.utterance_text}”</div>
              {r.asr_text !== r.utterance_text ? (
                <div className="sub" style={{ marginTop: 4, color: "var(--st-retry)" }}>
                  ASR 인식: “{r.asr_text}”
                </div>
              ) : (
                <div className="sub" style={{ marginTop: 4 }}>
                  ASR 인식 일치 · “{r.asr_text}”
                </div>
              )}
            </div>
            <div className="cmp">
              <div>
                <small>Intent 기대</small>
                <span className="mono">{r.intent_expected}</span>
              </div>
              <div>
                <small>Intent 예측</small>
                <span className={clsx("mono", r.intent_expected !== r.intent_predicted && "mismatch")}>{r.intent_predicted}</span>
              </div>
              <div>
                <small>기대 응답</small>
                <span>{r.expected_response}</span>
              </div>
              <div>
                <small>실제 응답</small>
                <span className={clsx(r.result === "FAIL" && "mismatch")}>{r.actual_response || <i className="sub">(응답 없음)</i>}</span>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                LLM Judge
              </div>
              <div className="score">
                <b className="mono" style={{ fontSize: 23, letterSpacing: "-0.04em", color: `var(--st-${r.judge_score >= 0.7 ? "success" : "failed"})` }}>
                  {r.judge_score.toFixed(2)}
                </b>
                <div className="meter">
                  <i style={{ width: `${r.judge_score * 100}%`, background: `var(--st-${r.judge_score >= 0.7 ? "success" : "failed"})` }} />
                </div>
                <span className="sub">임계 0.70</span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 12.5 }}>{r.judge_reason}</p>
            </div>
            <dl className="kv">
              <dt>응답 지연</dt>
              <dd className="mono" style={{ color: r.latency_ms > 8000 ? "var(--st-failed)" : "inherit" }}>
                {fmt.number(r.latency_ms)} ms
              </dd>
              <dt>모델</dt>
              <dd className="mono">{r.model_version}</dd>
              <dt>Pipeline 버전</dt>
              <dd className="mono">{r.pipeline_version}</dd>
              <dt>평가 시각</dt>
              <dd className="mono">{r.eval_timestamp}</dd>
              <dt>Batch</dt>
              <dd className="mono">{r.batch_id}</dd>
              <dt>PipelineJob</dt>
              <dd className="mono">{r.pipeline_job_id}</dd>
              <dt>Workflow</dt>
              <dd className="row" style={{ gap: 6 }}>
                <Link className="idlink" href={wfHref(r.workflow_id, { screen: "results", fq })}>
                  {r.workflow_id}
                </Link>
                {data?.workflow && <span className="sub">{data.workflow.input.uri}</span>}
              </dd>
            </dl>
            <div className="row">
              <Link className="btn primary" href={wfHref(r.workflow_id, { screen: "results", fq })}>
                <ExternalLink aria-hidden />
                Workflow 상세로 이동
              </Link>
              <button className="btn" onClick={() => copy(JSON.stringify(r, null, 2), jsonRef.current)}>
                <Copy aria-hidden />
                JSON 복사
              </button>
              <button className="btn" onClick={() => onSameBatch(r.workflow_id)}>
                <Filter aria-hidden />
                같은 배치만 보기
              </button>
            </div>
            {data?.inputLine && (
              <details>
                <summary className="sub">원본 입력 JSONL 행 (gs://…/batch.jsonl)</summary>
                <pre className="json" style={{ marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {data.inputLine}
                </pre>
              </details>
            )}
            <details>
              <summary className="sub">결과 CSV 행 (JSON)</summary>
              <div ref={jsonRef} style={{ marginTop: 6 }}>
                <JsonView value={r} />
              </div>
            </details>
          </div>
        )}
      </div>
    </>
  );
}
