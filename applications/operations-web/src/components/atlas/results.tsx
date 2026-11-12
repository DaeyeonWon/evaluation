"use client";
/**
 * U-01 · Evaluation results (per-utterance PASS/FAIL) read from the result CSV in GCS.
 * Filters live in the URL; every chart is drawn from the server-side aggregates of the FILTERED
 * rows; downloads are real files from /api/v1/results/csv (Content-Disposition + UTF-8 BOM).
 */
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Eye, FileCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { EChartsOption } from "echarts";
import { EChart, LangBadge, fmt } from "@/components/shared";
import { CAPSULES, CAPSULE_BY_ID, DEVICES, FAILURE_REASON_META, LANG_CODES, PIPELINE_VERSIONS } from "@/lib/catalog";
import { api, csvUrl, downloadCsv, parseAsInt, parseAsList, parseAsString, useApi, useQueryStates, type ResultQuery } from "@/lib/client";
import type { FailureReason, LangCode, ResultRow } from "@/lib/types";
import { kstDayStart } from "@/lib/format";
import { axisX, axisY, barLabel, baseOpt, catY, tooltip, verColor } from "./chart";
import { Empty, ErrorNote, JsonView, Plate, Sheet, SheetHead, Skeleton, copyText, useToast, useReducedMotionSafe } from "./ui";

const PARSERS = {
  language: parseAsList,
  capsule: parseAsString,
  intent: parseAsString,
  device: parseAsString,
  version: parseAsString,
  model: parseAsString,
  result: parseAsString,
  reason: parseAsString,
  batch_id: parseAsString,
  workflow_id: parseAsString,
  date: parseAsString,
  q: parseAsString,
  sort: parseAsString.withDefault("eval_desc"),
  page: parseAsInt.withDefault(1),
  utt: parseAsString,
};
const PAGE = 50;
const DAY = 86400000;

type F = { [K in keyof typeof PARSERS]: (typeof PARSERS)[K]["defaultValue"] };

/** model_version → pipeline_version(s). Results carry exactly one model per pipeline version, so
 *  the 모델 버전 filter is resolved to the API's `version` filter (no extra endpoint needed). */
type ModelMap = Record<string, string[]>;

function toQuery(f: F, models?: ModelMap): ResultQuery {
  const from = f.date ? kstDayStart(new Date(f.date + "T12:00:00+09:00").getTime()) : undefined;
  let version: string | string[] | undefined = f.version ?? undefined;
  let ids: string[] | undefined;
  if (f.model && models) {
    const vs = models[f.model] ?? [];
    const v = f.version ? vs.filter((x) => x === f.version) : vs;
    if (v.length) version = v;
    else ids = ["__none__"]; // model/version combination that cannot match → empty result
  }
  return {
    language: f.language.length ? (f.language as LangCode[]) : undefined,
    capsule: f.capsule ?? undefined,
    intent: f.intent ?? undefined,
    device: f.device ?? undefined,
    version,
    ids,
    result: (f.result as "PASS" | "FAIL" | null) ?? undefined,
    failure_reason: f.reason ?? undefined,
    batch_id: f.batch_id ?? undefined,
    workflow_id: f.workflow_id ?? undefined,
    q: f.q ?? undefined,
    from,
    to: from ? from + DAY - 1 : undefined,
  };
}

function CsvModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [rows, setRows] = useState<number | null>(null);
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then(async (r) => {
        const t = await r.text();
        if (alive) {
          setText(t.replace(/^﻿/, ""));
          setRows(Number(r.headers.get("x-row-count")) || null);
        }
      })
      .catch((e) => alive && setText("불러오지 못했습니다: " + e));
    return () => {
      alive = false;
    };
  }, [url]);
  const head = text ? text.split("\r\n").slice(0, 401).join("\n") : "";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label={`CSV 보기 · ${label}`}>
        <div className="dlg-head">
          <h3>CSV 보기/복사 · {label}</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </div>
        <div className="dlg-body">
          <div className="note">
            {rows != null ? `${fmt.number(rows)}행 · ` : ""}
            {text ? fmt.bytes(new Blob([text]).size) + " · " : ""}RFC 4180 · UTF-8 BOM. 미리보기는 처음 400행이며, 복사는 전체 내용을 복사합니다. 원본: <span className="mono">{url}</span>
          </div>
          {text == null ? <Skeleton rows={8} /> : <textarea className="in mono" readOnly value={head} style={{ minHeight: 360, fontSize: 11, whiteSpace: "pre" }} aria-label="CSV 미리보기" />}
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <a className="btn" href={url} download>
            <Download />
            이 CSV 다운로드
          </a>
          <button
            className="btn primary"
            disabled={!text}
            onClick={async () => {
              if (text && (await copyText(text))) toast.ok("CSV 전체를 클립보드에 복사했습니다.");
              else toast.err("클립보드 접근이 막혔습니다. 텍스트를 선택해 ⌘C로 복사하세요.");
            }}
          >
            <Copy />
            전체 CSV 복사
          </button>
        </div>
      </div>
    </div>
  );
}

function UttDrawer({ id, rows, onNav, onClose }: { id: string; rows: ResultRow[]; onNav: (id: string) => void; onClose: () => void }) {
  const q = useApi(["result", id], () => api.result(id));
  const reduced = useReducedMotionSafe();
  const r = q.data?.row.utterance_id === id ? q.data.row : rows.find((x) => x.utterance_id === id);
  const i = rows.findIndex((x) => x.utterance_id === id);
  const fr = r?.failure_reason ? FAILURE_REASON_META[r.failure_reason as FailureReason] : null;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <motion.div className="scrim" style={{ padding: 0 }} onClick={onClose} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="실발화 상세"
        initial={reduced ? false : { x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="dlg-head">
          <div style={{ minWidth: 0 }}>
            <div className="mono muted" style={{ fontSize: 10.5 }}>
              UTTERANCE · {i >= 0 ? `${i + 1}/${rows.length} (이 페이지)` : ""}
            </div>
            <h3 className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
              {id}
            </h3>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn icon" disabled={i <= 0} onClick={() => onNav(rows[i - 1].utterance_id)} aria-label="이전 행">
              <ChevronLeft />
            </button>
            <button className="btn icon" disabled={i < 0 || i >= rows.length - 1} onClick={() => onNav(rows[i + 1].utterance_id)} aria-label="다음 행">
              <ChevronRight />
            </button>
            <button className="btn icon" onClick={onClose} aria-label="닫기">
              <X />
            </button>
          </div>
        </div>
        <div className="dlg-body" style={{ flex: 1 }}>
          {!r ? (
            <Skeleton rows={8} />
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className={clsx("st-pill solid")} style={{ ["--tone" as string]: r.result === "PASS" ? "var(--st-success)" : "var(--st-failed)" }}>
                  {r.result === "PASS" ? <Check size={13} /> : <X size={13} />}
                  {r.result}
                </span>
                {fr ? (
                  <span className="st-pill" style={{ ["--tone" as string]: `var(--st-${fr.tone})` }}>
                    {fr.label}
                  </span>
                ) : null}
                <LangBadge lang={r.language} />
                <span className="chip">{r.capsule}</span>
                <span className="chip">{r.device_type}</span>
              </div>
              <div className="cmp">
                <div className="full">
                  <div className="k">UTTERANCE TEXT</div>
                  <div className="v" style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.02em" }}>
                    {r.utterance_text}
                  </div>
                </div>
                <div className="full">
                  <div className="k">ASR TEXT {r.asr_text !== r.utterance_text ? <span className="sev-ERROR">· 불일치</span> : null}</div>
                  <div className="v">{r.asr_text}</div>
                </div>
                <div>
                  <div className="k">INTENT 기대</div>
                  <div className="v mono">{r.intent_expected}</div>
                </div>
                <div>
                  <div className="k">INTENT 예측</div>
                  <div className={clsx("v mono", r.intent_expected !== r.intent_predicted && "sev-ERROR")}>{r.intent_predicted}</div>
                </div>
                <div>
                  <div className="k">기대 응답</div>
                  <div className="v">{r.expected_response}</div>
                </div>
                <div>
                  <div className="k">실제 응답</div>
                  <div className="v">{r.actual_response || <span className="muted">(응답 없음)</span>}</div>
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="grp-t" style={{ padding: 0 }}>
                    Judge score
                  </span>
                  <b className="mono" style={{ fontSize: 24, fontWeight: 500, color: r.judge_score < 0.7 ? "var(--st-failed)" : "var(--st-success)" }}>
                    {r.judge_score.toFixed(2)}
                  </b>
                </div>
                <div className="bar" style={{ height: 8, marginTop: 4, ["--tc" as string]: r.judge_score < 0.7 ? "var(--st-failed)" : "var(--st-success)" }}>
                  <i style={{ width: `${r.judge_score * 100}%` }} />
                </div>
                <div className="mono muted" style={{ fontSize: 10, marginTop: 2, marginLeft: "calc(70% - 4px)" }}>
                  ▲ 0.70 PASS 기준
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13 }}>{r.judge_reason}</p>
              </div>
              <dl className="kv">
                <dt>응답 지연</dt>
                <dd className="mono" style={r.latency_ms > 8000 ? { color: "var(--st-failed)" } : undefined}>
                  {fmt.number(r.latency_ms)} ms{r.latency_ms > 8000 ? " · 8초 초과" : ""}
                </dd>
                <dt>모델</dt>
                <dd className="mono">{r.model_version}</dd>
                <dt>Pipeline</dt>
                <dd className="mono">{r.pipeline_version}</dd>
                <dt>평가 시각</dt>
                <dd className="mono">{r.eval_timestamp}</dd>
                <dt>Batch</dt>
                <dd className="mono">{r.batch_id}</dd>
                <dt>PipelineJob</dt>
                <dd className="mono">{r.pipeline_job_id}</dd>
                <dt>Workflow</dt>
                <dd>
                  <Link className="mono" href={`/workflows/${r.workflow_id}?node=aggregate`}>
                    {r.workflow_id} →
                  </Link>
                </dd>
              </dl>
              {q.data?.inputLine ? (
                <details>
                  <summary className="mono" style={{ cursor: "pointer", fontSize: 11.5 }}>
                    입력 JSONL 원본 행
                  </summary>
                  <pre className="code wrap" style={{ marginTop: 6 }}>
                    {q.data.inputLine}
                  </pre>
                </details>
              ) : null}
              <details>
                <summary className="mono" style={{ cursor: "pointer", fontSize: 11.5 }}>
                  결과 행 원본 (JSON)
                </summary>
                <JsonView value={r} className="wrap" style={{ marginTop: 6 }} />
              </details>
            </>
          )}
        </div>
      </motion.aside>
    </>
  );
}

export function ResultsScreen() {
  const [f, setF] = useQueryStates(PARSERS);
  const toast = useToast();
  const modelsQ = useApi(
    ["atlas-model-map"],
    async () => {
      const out: ModelMap = {};
      await Promise.all(
        PIPELINE_VERSIONS.map(async (v) => {
          const r = await api.results({ version: v, pageSize: 1 });
          const m = r.rows[0]?.model_version;
          if (m) (out[m] ??= []).push(v);
        }),
      );
      return out;
    },
    { revalidateOnFocus: false },
  );
  const models = modelsQ.data;
  const modelPending = !!f.model && !models;
  const query = useMemo(() => toQuery(f as F, models), [f, models]);
  const page = f.page ?? 1;
  const q = useMemo<ResultQuery>(() => ({ ...query, sort: (f.sort ?? "eval_desc") as ResultQuery["sort"], page, pageSize: PAGE }), [query, f.sort, page]);
  const res = useApi(modelPending ? null : ["results", q], () => api.results(q), { revalidateOn: ["transition"], throttleMs: 4000 });
  const all = useApi(["results", "facets"], () => api.results({ pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const meta = useApi(["results-file"], () => api.resultFile(), { revalidateOn: ["transition"], throttleMs: 6000 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ url: string; label: string } | null>(null);
  const [qDraft, setQDraft] = useState<string | null>(null);
  const [batchDraft, setBatchDraft] = useState<string | null>(null);

  useEffect(() => {
    if (qDraft == null && batchDraft == null) return;
    const t = setTimeout(() => setF({ ...(qDraft != null ? { q: qDraft || null } : {}), ...(batchDraft != null ? { batch_id: batchDraft || null } : {}), page: 1 }), 320);
    return () => clearTimeout(t);
  }, [qDraft, batchDraft, setF]);

  const d = res.data;
  const ag = d?.aggregates;
  const rows = d?.rows ?? [];
  const file = meta.data?.file ?? d?.file;
  const filtered = Object.values(query).some((v) => v != null && !(Array.isArray(v) && !v.length));
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const intents = Object.keys(all.data?.aggregates.byIntent ?? {}).sort();
  const dates = Object.keys(all.data?.aggregates.byDate ?? {}).sort().reverse();
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.utterance_id));
  const setFilter = (p: Partial<F>) => setF({ ...p, page: 1 });
  const sel1 = (label: string, key: keyof F, opts: string[], lab: (x: string) => string = (x) => x) => (
    <label className="field">
      <span>{label}</span>
      <select className="in" value={(f[key] as string | null) ?? ""} onChange={(e) => setFilter({ [key]: e.target.value || null } as Partial<F>)}>
        <option value="">전체</option>
        {opts.map((x) => (
          <option key={x} value={x}>
            {lab(x)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET U-01 · EVALUATION RESULTS"
        title="평가 결과 (PASS / FAIL)"
        desc="Vertex AI Pipeline의 persist 단계가 GCS에 올린 결과 CSV를 읽습니다. 필터는 URL에 저장되고, 행을 누르면 실발화 하나의 판정 근거가 열립니다."
        acts={
          <>
            <a className="btn" href={csvUrl()} download onClick={() => toast.ok("전체 결과 CSV 다운로드를 시작했습니다.")}>
              <Download />
              전체 CSV
            </a>
            <a className="btn" href={csvUrl(query)} download aria-disabled={!filtered} onClick={() => toast.ok(`필터 결과 ${fmt.number(d?.total ?? 0)}행 CSV 다운로드를 시작했습니다.`)}>
              <Download />
              필터 결과 CSV
            </a>
            <button className="btn" onClick={() => setModal({ url: csvUrl(query), label: filtered ? `필터 결과 ${fmt.number(d?.total ?? 0)}행` : "전체" })}>
              <Eye />
              CSV 보기/복사
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (!sel.size) return toast.err("내보낼 행을 체크박스로 먼저 선택하세요.");
                downloadCsv({ ids: [...sel] });
                toast.ok(`선택한 ${sel.size}행 CSV 다운로드를 시작했습니다.`);
              }}
            >
              <Check />
              선택 {sel.size ? sel.size + "행 " : ""}내보내기
            </button>
          </>
        }
      />
      <div className="res-file">
        <FileCheck aria-hidden />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="uri">{file?.uri ?? "gs://bixby-eval-results/…"}</div>
          <div className="meta">
            {file ? (
              <>
                <span>{fmt.bytes(file.sizeBytes)}</span>
                <span>생성 {fmt.dateTime(file.generatedAt)}</span>
                <span>{fmt.number(file.rowCount)} rows</span>
                <span>{file.scope}</span>
              </>
            ) : null}
            {meta.data ? (
              <span>
                BigQuery {meta.data.bigquery.table} · {fmt.number(meta.data.bigquery.rows)} rows
              </span>
            ) : null}
          </div>
        </div>
        <div className="chipset">
          {(meta.data?.files ?? []).map((x) => (
            <span className="chip" key={x.uri} title={`${x.uri} · ${fmt.bytes(x.sizeBytes)}`}>
              {x.name.split("/").pop()} · {fmt.number(x.rowCount)}
            </span>
          ))}
        </div>
      </div>

      <Plate>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="filters">
            <label className="field f-wide">
              <span>발화 · 응답 · Judge 사유 검색</span>
              <input className="in" value={qDraft ?? f.q ?? ""} onChange={(e) => setQDraft(e.target.value)} placeholder="예: 데이식스, 거실 조명, timeout" />
            </label>
            <label className="field">
              <span>Batch ID</span>
              <input className="in mono" value={batchDraft ?? f.batch_id ?? ""} onChange={(e) => setBatchDraft(e.target.value)} placeholder="batch-20261112-ko-0001" />
            </label>
            <label className="field">
              <span>Pipeline 버전</span>
              <select
                className="in"
                value={f.version ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  // keep 모델 버전 consistent: drop it when it cannot run on the chosen pipeline version
                  const keepModel = !v || !f.model || !models || (models[f.model] ?? []).includes(v);
                  setFilter({ version: v, ...(keepModel ? {} : { model: null }) });
                }}
              >
                <option value="">전체</option>
                {PIPELINE_VERSIONS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>모델 버전</span>
              <select
                className="in"
                title={f.model && models?.[f.model] ? `${f.model} · Pipeline ${models[f.model].join(", ")}` : undefined}
                value={f.model ?? ""}
                onChange={(e) => {
                  const m = e.target.value || null;
                  const keepVersion = !m || !f.version || !models || (models[m] ?? []).includes(f.version);
                  setFilter({ model: m, ...(keepVersion ? {} : { version: null }) });
                }}
              >
                <option value="">전체</option>
                {f.model && !models?.[f.model] ? <option value={f.model}>{f.model}</option> : null}
                {Object.entries(models ?? {}).map(([m, vs]) => (
                  <option key={m} value={m}>
                    {m} ({vs.join(", ")})
                  </option>
                ))}
              </select>
            </label>
            {sel1("캡슐/도메인", "capsule", CAPSULES.map((c) => c.id), (id) => CAPSULE_BY_ID[id]?.label ?? id)}
            {sel1("Intent (기대)", "intent", intents)}
            {sel1("기기", "device", DEVICES)}
            {sel1("평가 날짜", "date", dates)}
            {sel1("결과", "result", ["PASS", "FAIL"])}
            {sel1("실패 원인", "reason", Object.keys(FAILURE_REASON_META), (k) => `${FAILURE_REASON_META[k as FailureReason].label} · ${k}`)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chipset" role="group" aria-label="언어">
              {LANG_CODES.map((c) => (
                <button key={c} aria-pressed={f.language.includes(c)} onClick={() => setFilter({ language: f.language.includes(c) ? f.language.filter((x) => x !== c) : [...f.language, c] })}>
                  <LangBadge lang={c} />
                </button>
              ))}
            </div>
            {f.workflow_id ? (
              <span className="chip">
                workflow {f.workflow_id}
                <button className="btn sm ghost icon" style={{ height: 18, width: 18 }} aria-label="workflow 필터 해제" onClick={() => setFilter({ workflow_id: null })}>
                  <X />
                </button>
              </span>
            ) : null}
            <button
              className="btn sm ghost"
              onClick={() => {
                setQDraft(null);
                setBatchDraft(null);
                setF({ language: [], capsule: null, intent: null, device: null, version: null, model: null, result: null, reason: null, batch_id: null, workflow_id: null, date: null, q: null, page: 1 });
              }}
            >
              <X />
              필터 초기화
            </button>
            <span className="mono muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
              {d ? `${fmt.number(d.total)} / ${fmt.number(all.data?.total ?? d.total)}행` : "…"} · 선택 {sel.size}
              {sel.size ? (
                <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setSel(new Set())}>
                  선택 해제
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </Plate>
      <ErrorNote error={res.error} />

      <div className="kpis">
        <div className="kpi">
          <div className="k">평가 실발화</div>
          <div className="v">{ag ? fmt.number(ag.total) : "—"}</div>
          <div className="s">{filtered ? "필터 적용" : "전체 CSV"}</div>
        </div>
        <button className="kpi" data-tone style={{ ["--tc" as string]: "var(--st-success)" }} onClick={() => setFilter({ result: f.result === "PASS" ? null : "PASS" })} aria-pressed={f.result === "PASS"}>
          <div className="k">PASS</div>
          <div className="v">{ag ? fmt.number(ag.pass) : "—"}</div>
          <div className="s">judge ≥ 0.7 · intent 일치</div>
        </button>
        <button className="kpi" data-tone style={{ ["--tc" as string]: "var(--st-failed)" }} onClick={() => setFilter({ result: f.result === "FAIL" ? null : "FAIL" })} aria-pressed={f.result === "FAIL"}>
          <div className="k">FAIL</div>
          <div className="v">{ag ? fmt.number(ag.fail) : "—"}</div>
          <div className="s">
            {ag
              ? Object.entries(ag.byFailureReason)
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                  .slice(0, 2)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")
              : ""}
          </div>
        </button>
        <div className="kpi">
          <div className="k">Pass rate</div>
          <div className="v">{ag ? fmt.pct(ag.passRate ?? 0, 1) : "—"}</div>
          <div className="pf">
            <i style={{ width: `${(ag?.passRate ?? 0) * 100}%`, background: "var(--st-success)" }} />
            <i style={{ width: `${(1 - (ag?.passRate ?? 0)) * 100}%`, background: "var(--st-failed)" }} />
          </div>
        </div>
        <div className="kpi">
          <div className="k">평균 Judge score</div>
          <div className="v">{ag ? (ag.avgJudgeScore || 0).toFixed(3) : "—"}</div>
          <div className="s">LLM Judge</div>
        </div>
        <div className="kpi">
          <div className="k">응답 지연 p50 / p95</div>
          <div className="v" style={{ fontSize: 21 }}>
            {ag ? (
              <>
                {fmt.number(ag.latency.p50Ms)}
                <small>ms</small> / {fmt.number(ag.latency.p95Ms)}
                <small>ms</small>
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="s">평균 {ag ? fmt.number(ag.latency.avgMs) : "—"}ms</div>
        </div>
      </div>

      <ResultCharts ag={ag} f={f as F} onPick={setFilter} />

      <Plate flush title="results.csv 행" refText="22 columns · 행 클릭 = 상세 · 체크 = 선택 내보내기">
        <div className="tbl-wrap" style={{ maxHeight: 660 }}>
          <table className="t">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="이 페이지 전체 선택"
                    checked={allSel}
                    onChange={(e) =>
                      setSel((s) => {
                        const n = new Set(s);
                        rows.forEach((r) => (e.target.checked ? n.add(r.utterance_id) : n.delete(r.utterance_id)));
                        return n;
                      })
                    }
                  />
                </th>
                <th>utterance_id</th>
                <th>언어</th>
                <th>캡슐</th>
                <th>발화</th>
                <th>Intent 기대 → 예측</th>
                <th className="r">
                  <button className="btn sm ghost" style={{ height: 20, padding: 0 }} onClick={() => setF({ sort: f.sort === "score_asc" ? "score_desc" : "score_asc", page: 1 })}>
                    Judge {f.sort === "score_asc" ? "▲" : f.sort === "score_desc" ? "▼" : ""}
                  </button>
                </th>
                <th>결과</th>
                <th>실패 원인</th>
                <th className="r">
                  <button className="btn sm ghost" style={{ height: 20, padding: 0 }} onClick={() => setF({ sort: f.sort === "latency_desc" ? "latency_asc" : "latency_desc", page: 1 })}>
                    지연 {f.sort === "latency_asc" ? "▲" : f.sort === "latency_desc" ? "▼" : ""}
                  </button>
                </th>
                <th>기기</th>
                <th>버전</th>
              </tr>
            </thead>
            <tbody>
              {!d ? (
                <tr>
                  <td colSpan={12}>
                    <Skeleton rows={6} />
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((r) => {
                  const fr = r.failure_reason ? FAILURE_REASON_META[r.failure_reason as FailureReason] : null;
                  return (
                    <tr
                      key={r.utterance_id}
                      className={clsx("click", f.utt === r.utterance_id && "sel")}
                      tabIndex={0}
                      onClick={(e) => {
                        if ((e.target as Element).closest("input")) return;
                        setF({ utt: r.utterance_id }, { history: "push" });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && setF({ utt: r.utterance_id }, { history: "push" })}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${r.utterance_id} 선택`}
                          checked={sel.has(r.utterance_id)}
                          onChange={(e) =>
                            setSel((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.utterance_id);
                              else n.delete(r.utterance_id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="idc">{r.utterance_id.replace("utt-", "")}</td>
                      <td>
                        <LangBadge lang={r.language} />
                      </td>
                      <td>{r.capsule}</td>
                      <td className="wrap" style={{ maxWidth: 340 }}>
                        {r.utterance_text}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {r.intent_expected}
                        {r.intent_expected !== r.intent_predicted ? (
                          <>
                            <br />
                            <span className="sev-ERROR">→ {r.intent_predicted}</span>
                          </>
                        ) : (
                          <span className="muted"> ✓</span>
                        )}
                      </td>
                      <td className="mono r" style={r.judge_score < 0.7 ? { color: "var(--st-failed)" } : undefined}>
                        {r.judge_score.toFixed(2)}
                      </td>
                      <td>
                        <span className="st-pill" style={{ ["--tone" as string]: r.result === "PASS" ? "var(--st-success)" : "var(--st-failed)" }}>
                          {r.result === "PASS" ? <Check size={12} /> : <X size={12} />}
                          {r.result}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {fr ? <span style={{ color: `var(--st-${fr.tone})` }}>{fr.label}</span> : "—"}
                      </td>
                      <td className="mono r">{fmt.number(r.latency_ms)}</td>
                      <td className="muted">{r.device_type}</td>
                      <td className="mono">{r.pipeline_version}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12}>
                    <Empty title="필터에 맞는 행이 없습니다">캡슐이나 실패 원인 조건을 풀어 보세요.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">
            {d && d.total ? `${(page - 1) * PAGE + 1}–${Math.min(d.total, page * PAGE)}` : 0} / {fmt.number(d?.total ?? 0)}행 · 선택 {sel.size}
          </span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setF({ page: page - 1 })} aria-label="이전 페이지">
              <ChevronLeft />
            </button>
            <span className="mono" style={{ fontSize: 11 }}>
              {page} / {pages}
            </span>
            <button className="btn sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 })} aria-label="다음 페이지">
              <ChevronRight />
            </button>
          </span>
        </div>
      </Plate>
      <AnimatePresence>
        {f.utt ? <UttDrawer key="drawer" id={f.utt} rows={rows} onNav={(id) => setF({ utt: id })} onClose={() => setF({ utt: null })} /> : null}
      </AnimatePresence>
      {modal ? <CsvModal url={modal.url} label={modal.label} onClose={() => setModal(null)} /> : null}
    </Sheet>
  );
}

function ResultCharts({ ag, f, onPick }: { ag: import("@/lib/types").ResultsAggregates | undefined; f: F; onPick: (p: Partial<F>) => void }) {
  const reduced = useReducedMotionSafe();
  if (!ag)
    return (
      <div className="split s-64">
        <Plate title="캡슐 × Pipeline 버전 Pass rate">
          <Skeleton rows={6} />
        </Plate>
        <Plate title="실패 원인 분포">
          <Skeleton rows={6} />
        </Plate>
      </div>
    );
  const caps = CAPSULES.filter((c) => ag.byCapsuleVersion[c.id]);
  const vers = [...new Set(Object.values(ag.byCapsuleVersion).flatMap((o) => Object.keys(o)))].sort();
  const allPr = caps.flatMap((c) => Object.values(ag.byCapsuleVersion[c.id]).map((x) => x.passRate ?? 0));
  const minPr = allPr.length ? Math.min(...allPr) : 1;
  const yMin = minPr >= 0.55 ? 0.5 : Math.max(0, Math.floor((minPr - 0.05) * 10) / 10);
  const capNote =
    f.result === "FAIL"
      ? "결과=FAIL 필터: 모든 행이 FAIL이므로 Pass rate는 0%입니다. 결과 필터를 해제하면 버전 비교가 보입니다."
      : f.result === "PASS"
        ? "결과=PASS 필터: 모든 행이 PASS이므로 Pass rate는 100%입니다."
        : !caps.length
          ? "필터에 맞는 행이 없습니다."
          : "";
  const reasons = Object.entries(ag.byFailureReason).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [FailureReason, number][];
  const ls = LANG_CODES.filter((c) => ag.byLanguage[c]);
  return (
    <>
      <div className="split s-64">
        <Plate title="캡슐 × Pipeline 버전 Pass rate" refText="v1.2-rc 후보 vs v1.1 기준 · 막대 클릭 = 캡슐 필터">
          <EChart
            className="chart tall"
            ariaLabel="캡슐별 Pipeline 버전 Pass rate"
            onEvents={{
              click: (p) => {
                const i = (p as { dataIndex: number }).dataIndex;
                const c = caps[i];
                if (c) onPick({ capsule: f.capsule === c.id ? null : c.id });
              },
            }}
            option={(t) => ({
              ...baseOpt(t, reduced, { grid: { left: 44, right: 10, top: capNote ? 52 : 34, bottom: 64 } }),
              graphic: [{ type: "text", left: 48, top: 22, style: { text: capNote, fill: t.muted, font: `500 11.5px ${t.font}`, width: 560, overflow: "break" } }],
              xAxis: axisX(t, caps.map((c) => c.label), { boundaryGap: true, axisLabel: { color: t.text, fontSize: 11, rotate: 30, interval: 0, fontFamily: t.font } }),
              yAxis: axisY(t, { min: yMin, max: 1, axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono, formatter: (v: number) => Math.round(v * 100) + "%" } }),
              tooltip: tooltip(t, { valueFormatter: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%") }),
              series: vers.map((v) => ({
                name: v,
                type: "bar",
                barGap: "10%",
                barMaxWidth: 14,
                itemStyle: { color: verColor(t, v) },
                data: caps.map((c) => {
                  const x = ag.byCapsuleVersion[c.id][v];
                  return x && x.passRate != null ? +x.passRate.toFixed(4) : null;
                }),
                markPoint:
                  v === "v1.2-rc" && caps.some((c) => c.id === "device_control") && !f.result
                    ? {
                        symbol: "pin",
                        symbolSize: 36,
                        itemStyle: { color: t.tone.failed },
                        label: { color: "#fff", fontSize: 9.5, formatter: "회귀", fontFamily: t.font },
                        data: [{ coord: [caps.findIndex((c) => c.id === "device_control"), ag.byCapsuleVersion.device_control?.[v]?.passRate ?? 0] }],
                      }
                    : undefined,
              })) as EChartsOption["series"],
            })}
          />
        </Plate>
        <Plate title="실패 원인 분포" refText="FAIL 행 기준 · 클릭 = 필터">
          <EChart
            className="chart tall"
            ariaLabel="실패 원인 분포"
            onEvents={{
              click: (p) => {
                const k = reasons[(p as { dataIndex: number }).dataIndex]?.[0];
                if (k) onPick({ reason: f.reason === k ? null : k });
              },
            }}
            option={(t) => ({
              ...baseOpt(t, reduced, { grid: { left: 110, right: 40, top: 8, bottom: 22 } }),
              legend: { show: false },
              tooltip: tooltip(t, { trigger: "item" }),
              xAxis: axisY(t, { minInterval: 1 }),
              yAxis: catY(t, reasons.map(([k]) => FAILURE_REASON_META[k]?.label ?? k)),
              series: [
                {
                  type: "bar",
                  barWidth: 11,
                  data: reasons.map(([k, v]) => ({ value: v, itemStyle: { color: t.tone[FAILURE_REASON_META[k]?.tone ?? "failed"], opacity: f.reason && f.reason !== k ? 0.35 : 1 } })),
                  label: barLabel(t),
                },
              ],
            })}
          />
        </Plate>
      </div>
      <div className="split s-55">
        <Plate title="언어별 PASS / FAIL" refText="클릭 = 언어 필터">
          <EChart
            className="chart"
            ariaLabel="언어별 PASS FAIL"
            onEvents={{
              click: (p) => {
                const c = ls[(p as { dataIndex: number }).dataIndex];
                if (c) onPick({ language: f.language.length === 1 && f.language[0] === c ? [] : [c] });
              },
            }}
            option={(t) => ({
              ...baseOpt(t, reduced),
              xAxis: axisX(t, ls.map((c) => c.toUpperCase()), { boundaryGap: true }),
              yAxis: axisY(t),
              series: [
                { name: "PASS", type: "bar", stack: "r", barWidth: 28, itemStyle: { color: t.tone.success }, data: ls.map((c) => ag.byLanguage[c].pass) },
                { name: "FAIL", type: "bar", stack: "r", barWidth: 28, itemStyle: { color: t.tone.failed }, data: ls.map((c) => ag.byLanguage[c].fail) },
              ],
            })}
          />
        </Plate>
        <Plate title="Judge score 분포" refText="0.1 구간 · 빨강 = 0.7 미만">
          <EChart
            className="chart"
            ariaLabel="Judge score 분포"
            option={(t) => ({
              ...baseOpt(t, reduced),
              legend: { show: false },
              xAxis: axisX(t, ag.judgeScoreHistogram.map((_, i) => (i / 10).toFixed(1)), { boundaryGap: true, name: "judge score", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: t.muted, fontSize: 10 } }),
              yAxis: axisY(t),
              series: [
                {
                  name: "행 수",
                  type: "bar",
                  barWidth: "78%",
                  data: ag.judgeScoreHistogram.map((v, i) => ({ value: v, itemStyle: { color: i >= 7 ? t.tone.success : t.tone.failed } })),
                  markLine: { symbol: "none", lineStyle: { color: t.read("--mark"), type: "dashed" }, label: { color: t.read("--mark"), formatter: "PASS 0.7", fontSize: 10, fontFamily: t.mono }, data: [{ xAxis: "0.7" }] },
                },
              ],
            })}
          />
        </Plate>
      </div>
    </>
  );
}
