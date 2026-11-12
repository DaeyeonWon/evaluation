"use client";
/**
 * U1 — Evaluation results (per-utterance PASS/FAIL from the result CSV in GCS).
 * Filters (URL) → GET /api/v1/results aggregates power every chart; CSV downloads are real navigations to
 * /api/v1/results/csv (Content-Disposition + BOM): full file, filtered, selected rows. Row → utterance detail.
 */
import clsx from "clsx";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Check, CheckCircle2, Copy, Download, ExternalLink, Eye, FileCheck, FileText, Filter, GitBranch, Layers, Table2, Target, TrendingDown, X, XOctagon } from "lucide-react";
import { CAPSULES, CAPSULE_BY_ID, FAILURE_REASON_META, LANG_CODES, PIPELINE_VERSIONS } from "@/lib/catalog";
import { api, csvUrl, downloadCsv, parseAsInt, parseAsString, useApi, useQueryStates, useSimNow, type ResultQuery } from "@/lib/client";
import { fmt } from "@/lib/format";
import { EChart } from "@/components/shared";
import type { FailureReason, LangCode, RateStat, ResultsAggregates } from "@/lib/types";
import { eo, CopyId, Empty, ErrorBox, LangTag, Pill, Tween, axX, axY, chartBase, errMsg, langName, pct, shortWf, useCopy, useHere, useToast, wfHref } from "./core";

const PARSERS = {
  language: parseAsString,
  workflow_id: parseAsString,
  version: parseAsString,
  model: parseAsString,
  capsule: parseAsString,
  intent: parseAsString,
  device: parseAsString,
  date: parseAsString,
  result: parseAsString,
  failure_reason: parseAsString,
  h0: parseAsString,
  h1: parseAsString,
  q: parseAsString,
  page: parseAsInt,
  utt: parseAsString,
};
type F = { [K in keyof typeof PARSERS]: ReturnType<(typeof PARSERS)[K]["parse"]> };
const PS = 40;
const FILTER_LABEL: Record<string, string> = {
  language: "언어",
  workflow_id: "Batch / Workflow",
  version: "Pipeline 버전",
  model: "모델 버전",
  capsule: "Capsule",
  intent: "Intent",
  device: "Device",
  date: "평가 일자",
  result: "결과",
  failure_reason: "실패 사유",
  h0: "시작 시",
  h1: "종료 시",
  q: "검색",
};

/** model_version is a pure function of pipeline_version (config.pipelineVersionDetails[].modelUnderTest),
 *  so the 모델 버전 filter is sent to /results as the equivalent `version` set. */
type ModelMap = Record<string, string>; // pipeline_version → model_version
const NO_MATCH = ["__no_match__"]; // model × pipeline-version conflict → empty result set

function toQuery(f: F, latestDate: string | undefined, models?: ModelMap): ResultQuery {
  const date = f.date ?? (f.h0 || f.h1 ? latestDate : undefined);
  let from: number | undefined;
  let to: number | undefined;
  if (date) {
    const h0 = f.h0 ? Math.max(0, Math.min(23, +f.h0)) : 0;
    const h1 = f.h1 ? Math.max(0, Math.min(23, +f.h1)) : 23;
    from = new Date(`${date}T${String(h0).padStart(2, "0")}:00:00+09:00`).getTime();
    to = new Date(`${date}T${String(h1).padStart(2, "0")}:59:59.999+09:00`).getTime();
  }
  let version: string[] | undefined = f.version ? [f.version] : undefined;
  let ids: string[] | undefined;
  if (f.model && models) {
    const vs = Object.keys(models).filter((v) => models[v] === f.model && (!f.version || v === f.version));
    if (vs.length) version = vs;
    else ids = NO_MATCH;
  }
  return {
    language: f.language ? [f.language as LangCode] : undefined,
    workflow_id: f.workflow_id ?? undefined,
    version,
    ids,
    capsule: f.capsule ?? undefined,
    intent: f.intent ?? undefined,
    device: f.device ?? undefined,
    result: (f.result as "PASS" | "FAIL") ?? undefined,
    failure_reason: f.failure_reason ?? undefined,
    q: f.q ?? undefined,
    from,
    to,
  };
}

export function ResultsScreen() {
  const [f, setF] = useQueryStates(PARSERS);
  const page = f.page ?? 1;
  const toast = useToast();
  const opts = useApi(["lanes-results-opts"], () => api.results({ pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const dates = Object.keys(opts.data?.aggregates.byDate ?? {}).sort();
  const cfgQ = useApi(["lanes-model-map"], () => api.config(), { revalidateOn: ["audit"], revalidateOnFocus: false });
  const models: ModelMap | undefined = useMemo(
    () => (cfgQ.data ? Object.fromEntries(cfgQ.data.pipelineVersionDetails.map((v) => [v.version, v.modelUnderTest])) : undefined),
    [cfgQ.data],
  );
  const ready = !f.model || !!models; // never show unfiltered numbers while the model map loads
  const base = toQuery(f, dates[dates.length - 1], models);
  const main = useApi(ready ? ["lanes-results", base, page] : null, () => api.results({ ...base, page, pageSize: PS }), { revalidateOn: ["transition"], throttleMs: 4000 });
  const fileQ = useApi(["lanes-results-file"], () => api.resultFile(), { revalidateOn: ["transition"], throttleMs: 5000 });
  const wfs = useApi(["lanes-wf-succeeded"], () => api.workflows({ status: "SUCCEEDED", pageSize: 500, sort: "updated_desc" }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const passQ = useApi(f.result === "FAIL" || !ready ? null : ["lanes-results-agg", base, "PASS"], () => api.results({ ...base, result: "PASS", pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const failQ = useApi(f.result === "PASS" || !ready ? null : ["lanes-results-agg", base, "FAIL"], () => api.results({ ...base, result: "FAIL", pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [csvOpen, setCsvOpen] = useState<null | { title: string; url: string; filename: string }>(null);
  const agg = main.data?.aggregates;
  const setFilter = (patch: Partial<F>) => setF({ ...patch, page: null }, { history: "push" });
  const chips = (Object.keys(FILTER_LABEL) as (keyof F)[]).filter((k) => f[k]);
  const filename = (fileQ.data?.file.name ?? main.data?.file.name ?? "results.csv").split("/").pop()!;
  const total = main.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PS));

  const chipVal = (k: string, v: string) =>
    k === "language" ? langName(v) : k === "capsule" ? CAPSULE_BY_ID[v]?.label ?? v : k === "failure_reason" ? FAILURE_REASON_META[v as FailureReason]?.label ?? v : k === "workflow_id" ? shortWf(v) : v;

  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">User addition · Vertex AI output</div>
          <h1>평가 결과 (PASS / FAIL)</h1>
          <p>각 Pipeline 실행이 GCS에 업로드한 결과 CSV를 집계한 발화 단위 평가 결과입니다. 필터를 조합해 분석하고, 행을 선택해 개별 발화를 검사하세요. 새 결과 CSV가 커밋되면 자동 갱신됩니다.</p>
        </div>
      </div>
      <FileCard
        meta={fileQ.data}
        onView={() => setCsvOpen({ title: `CSV 보기 · ${filename}`, url: csvUrl({}, { filename }), filename })}
        fullHref={csvUrl({}, { filename })}
        onDl={() => toast(`${filename} 다운로드 시작 (UTF-8 BOM · CRLF)`, "success")}
      />
      <Filters f={f} setFilter={setFilter} opts={opts.data?.aggregates} models={models} wfs={wfs.data?.items.map((w) => w.workflow_id) ?? []} dates={dates} />
      <div className="fchips" style={{ margin: "-4px 0 12px" }}>
        {chips.length ? (
          <>
            {chips.map((k) => (
              <span key={k} className="fchip">
                {FILTER_LABEL[k]}: {chipVal(k, String(f[k]))}
                <button type="button" aria-label="필터 제거" onClick={() => setFilter({ [k]: null } as Partial<F>)}>
                  <X className="i sm" />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setF(Object.fromEntries(Object.keys(PARSERS).map((k) => [k, null])) as Partial<F>, { history: "push" })}
            >
              모두 지우기
            </button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            필터 없음 — 평가된 전체 발화
          </span>
        )}
      </div>
      <Kpis agg={agg} />
      {main.error && !agg ? (
        <ErrorBox error={main.error} retry={() => main.mutate()} />
      ) : (
        <>
          <div className="grid g-12-8">
            <div className="panel">
              <div className="panel-h">
                <h2 className="sec">
                  <Table2 className="i" />
                  PASS율 Heatmap <span className="eyebrow">Capsule × Language · 셀 클릭 = 필터</span>
                </h2>
              </div>
              <Heatmap agg={agg} f={f} onPick={(c, l) => setFilter({ capsule: c, language: l })} />
            </div>
            <div className="panel">
              <div className="panel-h">
                <h2 className="sec">
                  <AlertTriangle className="i" />
                  실패 사유 분포 <span className="eyebrow">막대 클릭 = 필터</span>
                </h2>
              </div>
              <FailChart agg={agg} onPick={(r) => setFilter({ failure_reason: r, result: "FAIL" })} />
            </div>
          </div>
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="panel-h">
              <h2 className="sec">
                <Layers className="i" />
                언어별 Small multiples <span className="eyebrow">시간대별 PASS율 · 평가 건수</span>
              </h2>
            </div>
            <div className="multis">
              {LANG_CODES.map((l) => (
                <Multi key={l} lang={l} base={base} skip={!ready || (!!f.language && f.language !== l)} />
              ))}
            </div>
          </div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <h2 className="sec">
                  <GitBranch className="i" />
                  Pipeline 버전 × Capsule <span className="eyebrow">baseline v1.1 vs candidate v1.2-rc</span>
                </h2>
              </div>
              <VersionChart agg={agg} onPick={() => setFilter({ capsule: "device_control", language: null })} />
            </div>
            <div className="panel">
              <div className="panel-h">
                <h2 className="sec">
                  <BarChart3 className="i" />
                  Judge Score 분포 <span className="eyebrow">PASS 임계 0.70</span>
                </h2>
              </div>
              <ScoreChart pass={passQ.data?.aggregates.judgeScoreHistogram} fail={failQ.data?.aggregates.judgeScoreHistogram} />
            </div>
          </div>
          <div className="split" style={{ marginTop: 14 }}>
            <div className="panel flush" style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                <b className="disp" style={{ fontSize: 22 }}>
                  {fmt.number(total)}
                </b>
                <span className="muted" style={{ fontWeight: 500 }}>
                  / {fmt.number(opts.data?.total ?? fileQ.data?.file.rowCount)} 행
                </span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {sel.size ? `· ${sel.size}행 선택됨` : "· 체크박스로 행 선택"}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn sm" onClick={() => setSel((s) => new Set([...s, ...(main.data?.rows ?? []).map((r) => r.utterance_id)]))}>
                    <Check />
                    페이지 선택
                  </button>
                  {sel.size > 0 && (
                    <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>
                      선택 해제
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!sel.size}
                    onClick={() => {
                      downloadCsv({ ids: [...sel] }, { filename: `bixby-eval-results_selected_${sel.size}.csv` });
                      toast(`선택 ${sel.size}행 CSV 다운로드`, "success");
                    }}
                  >
                    <Download />
                    선택 행만 내보내기
                  </button>
                  <a className="btn sm" href={csvUrl(base)} download onClick={() => toast(`필터 결과 ${fmt.number(total)}행 CSV 다운로드`, "success")}>
                    <Filter />
                    필터 결과 CSV
                  </a>
                  <button type="button" className="btn sm ghost" onClick={() => setCsvOpen({ title: `필터 결과 CSV · ${fmt.number(total)}행`, url: csvUrl(base), filename: "results_filtered.csv" })}>
                    <Eye />
                    미리보기
                  </button>
                </span>
              </div>
              <ResultsTable rows={main.data?.rows} loading={!main.data} sel={sel} setSel={setSel} active={f.utt} onOpen={(id) => setF({ utt: id })} />
              <div className="pager">
                <span>
                  {page} / {pages} 페이지
                </span>
                <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setF({ page: page - 1 }, { history: "push" })}>
                  이전
                </button>
                <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 }, { history: "push" })}>
                  다음
                </button>
              </div>
            </div>
            <aside className="panel inspector" aria-label="발화 상세">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={f.utt ?? "none"} initial={{ opacity: 0.3, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                  <UttDetail id={f.utt} onBatch={(wf) => setFilter({ workflow_id: wf })} />
                </motion.div>
              </AnimatePresence>
            </aside>
          </div>
        </>
      )}
      <AnimatePresence>{csvOpen && <CsvModal {...csvOpen} onClose={() => setCsvOpen(null)} />}</AnimatePresence>
    </section>
  );
}

function FileCard({ meta, onView, fullHref, onDl }: { meta: import("@/lib/types").ResultFileMeta | undefined; onView: () => void; fullHref: string; onDl: () => void }) {
  const now = useSimNow();
  if (!meta) return <div className="skel" style={{ height: 86, marginBottom: 14 }} />;
  const f = meta.file;
  return (
    <div className="filecard">
      <span className="t-success tc">
        <FileCheck className="i lg" />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Result CSV · GCS
        </div>
        <div className="uri">
          <CopyId text={f.uri} />
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
          {fmt.bytes(f.sizeBytes)} · <b>{fmt.number(f.rowCount)}</b>행 · 생성 {fmt.dateTime(f.generatedAt)} ({fmt.relative(f.generatedAt, now)}) · scope: {f.scope} · BigQuery{" "}
          <span className="mono">{meta.bigquery.table}</span> ({fmt.number(meta.bigquery.rows)}행)
        </div>
        <div className="fchips" style={{ marginTop: 6 }}>
          {meta.files.map((x) => (
            <span key={x.uri} className="fchip mono" style={{ fontWeight: 500, paddingRight: 8 }} title={x.uri}>
              <FileText className="i sm" />
              {x.name.split("/").pop()} · {fmt.bytes(x.sizeBytes)} · {fmt.number(x.rowCount)}행
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <a className="btn" href={fullHref} download onClick={onDl}>
          <Download />
          CSV 다운로드
        </a>
        <button type="button" className="btn pri" onClick={onView}>
          <Eye />
          CSV 보기/복사
        </button>
      </div>
    </div>
  );
}

function Filters({
  f,
  setFilter,
  opts,
  models,
  wfs,
  dates,
}: {
  f: F;
  setFilter: (p: Partial<F>) => void;
  opts: ResultsAggregates | undefined;
  models: ModelMap | undefined;
  wfs: string[];
  dates: string[];
}) {
  const keys = (o: Record<string, RateStat> | undefined) => Object.keys(o ?? {}).sort();
  const sel = (k: keyof F, label: string, options: [string, string][]) => (
    <label className="fld" key={k}>
      <span>{label}</span>
      <select className="inp" value={(f[k] as string) ?? ""} onChange={(e) => setFilter({ [k]: e.target.value || null } as Partial<F>)}>
        <option value="">전체</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
        {f[k] && !options.some(([v]) => v === f[k]) && <option value={String(f[k])}>{String(f[k])}</option>}
      </select>
    </label>
  );
  const [qv, setQv] = useState(f.q ?? "");
  const [lastQ, setLastQ] = useState(f.q);
  if (lastQ !== f.q) {
    setLastQ(f.q);
    setQv(f.q ?? "");
  }
  return (
    <div className="filters">
      {sel("language", "언어", LANG_CODES.map((l) => [l, langName(l)]))}
      {sel("workflow_id", "Batch / Workflow", wfs.map((w) => [w, shortWf(w)]))}
      {sel("version", "Pipeline 버전", (opts ? keys(opts.byVersion) : PIPELINE_VERSIONS).map((v) => [v, v]))}
      {sel(
        "model",
        "모델 버전",
        [...new Set((opts ? keys(opts.byVersion) : PIPELINE_VERSIONS).map((v) => models?.[v]).filter((m): m is string => !!m))].map((m) => [m, m]),
      )}
      {sel("capsule", "Capsule (도메인)", CAPSULES.map((c) => [c.id, c.label]))}
      {sel("intent", "Intent", keys(opts?.byIntent).map((v) => [v, v]))}
      {sel("device", "Device", keys(opts?.byDevice).map((v) => [v, v]))}
      {sel("date", "평가 일자 (KST)", dates.map((v) => [v, v]))}
      {sel("result", "결과", [
        ["PASS", "PASS"],
        ["FAIL", "FAIL"],
      ])}
      {sel("failure_reason", "실패 사유", Object.entries(FAILURE_REASON_META).map(([k, m]) => [k, m.label]))}
      <label className="fld">
        <span>시간대 (KST, 시)</span>
        <span style={{ display: "flex", gap: 4 }}>
          <input className="inp" type="number" min={0} max={23} placeholder="0" value={f.h0 ?? ""} onChange={(e) => setFilter({ h0: e.target.value || null })} aria-label="시작 시" />
          <input className="inp" type="number" min={0} max={23} placeholder="23" value={f.h1 ?? ""} onChange={(e) => setFilter({ h1: e.target.value || null })} aria-label="종료 시" />
        </span>
      </label>
      <label className="fld">
        <span>텍스트 검색 (발화 · ASR · 응답 · 판정 사유)</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ q: qv.trim() || null });
          }}
          style={{ display: "flex", gap: 4 }}
        >
          <input className="inp" value={qv} onChange={(e) => setQv(e.target.value)} onBlur={() => qv.trim() !== (f.q ?? "") && setFilter({ q: qv.trim() || null })} placeholder="발화 · 판정 사유 (Enter)" />
        </form>
      </label>
    </div>
  );
}

function Kpis({ agg }: { agg: ResultsAggregates | undefined }) {
  const topFail = Object.entries(agg?.byFailureReason ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  const K: [string, number | null, string | null, (v: number) => string, string][] = [
    ["평가 발화", agg?.total ?? null, null, (v) => fmt.number(Math.round(v)), agg ? `${Object.keys(agg.byLanguage).length}개 언어 · ${Object.keys(agg.byCapsule).length} Capsule` : ""],
    ["PASS", agg?.pass ?? null, "success", (v) => fmt.number(Math.round(v)), agg ? `${pct(agg.passRate)} of ${fmt.number(agg.total)}` : ""],
    ["FAIL", agg?.fail ?? null, "failed", (v) => fmt.number(Math.round(v)), topFail ? `최다: ${FAILURE_REASON_META[topFail[0] as FailureReason]?.label ?? topFail[0]} ${topFail[1]}` : "—"],
    ["PASS율", agg?.passRate != null ? agg.passRate * 100 : null, "success", (v) => v.toFixed(1) + "%", agg?.passRate != null ? `목표 ≥ 85% · ${agg.passRate >= 0.85 ? "충족" : "미달"}` : ""],
    ["평균 Judge Score", agg?.avgJudgeScore ?? null, "running", (v) => v.toFixed(3), "LLM Judge (gemini)"],
    ["Latency p50", agg?.latency.p50Ms ?? null, "queued", (v) => fmt.number(Math.round(v)) + "ms", agg ? `p95 ${fmt.number(agg.latency.p95Ms)}ms · avg ${fmt.number(agg.latency.avgMs)}ms` : ""],
  ];
  return (
    <div className="kpis k6" style={{ marginBottom: 14 }}>
      {K.map(([l, v, t, f, sub]) => (
        <div key={l} className={clsx("kpi", t && `t-${t}`)}>
          <span className="bar" />
          <div className="lbl">{l}</div>
          <div className="v">{v == null ? <span className="skel" style={{ display: "block", height: 36, width: 90 }} /> : <Tween value={v} f={f} decimals={3} />}</div>
          <div className="sub">{sub}</div>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ agg, f, onPick }: { agg: ResultsAggregates | undefined; f: F; onPick: (capsule: string, lang: string | null) => void }) {
  if (!agg) return <div className="skel" style={{ height: 340 }} />;
  const col = (rate: number | null) => {
    if (rate == null) return "var(--sunken)";
    const t = Math.max(0, Math.min(1, (rate - 0.55) / 0.45));
    return `color-mix(in srgb, var(--st-success) ${Math.round(t * 100)}%, var(--st-failed))`;
  };
  return (
    <div className="scroll-x">
      <div className="hm" style={{ gridTemplateColumns: `150px repeat(${LANG_CODES.length + 1},minmax(64px,1fr))`, minWidth: 520 }}>
        <div />
        {LANG_CODES.map((l) => (
          <div key={l} className="h">
            <LangTag code={l} />
          </div>
        ))}
        <div className="h">전체</div>
        {CAPSULES.map((c) => {
          const tot = agg.byCapsule[c.id];
          return (
            <div key={c.id} style={{ display: "contents" }}>
              <div className="rl">
                {c.label}
                {c.id === "device_control" && (
                  <Pill tone="retry" className="ml" title="v1.2-rc 회귀">
                    회귀
                  </Pill>
                )}
              </div>
              {LANG_CODES.map((l) => {
                const x = agg.capsuleLanguage[c.id]?.[l];
                const rate = x && x.total ? x.passRate : null;
                return (
                  <button
                    key={l}
                    type="button"
                    className={clsx("c", f.capsule === c.id && f.language === l && "sel")}
                    style={{ background: col(rate), color: rate == null ? "var(--ink-4)" : "#fff", opacity: rate != null && x ? 0.55 + Math.min(1, x.total / 80) * 0.45 : 1 }}
                    title={`${c.label} · ${langName(l)}\n${x && x.total ? `PASS ${x.pass}/${x.total} (${pct(rate)})` : "데이터 없음"}`}
                    onClick={() => onPick(c.id, l)}
                  >
                    {rate == null ? "—" : Math.round(rate * 100)}
                  </button>
                );
              })}
              <button
                type="button"
                className={clsx("c", f.capsule === c.id && !f.language && "sel")}
                style={{ background: col(tot?.total ? tot.passRate : null), color: "#fff", outline: "1px solid var(--line)" }}
                title={`${c.label} 전체 ${tot ? pct(tot.passRate) : "—"}`}
                onClick={() => onPick(c.id, null)}
              >
                {tot?.total && tot.passRate != null ? Math.round(tot.passRate * 100) : "—"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span>PASS율(%)</span>
        <span style={{ display: "inline-block", width: 120, height: 8, borderRadius: 2, background: "linear-gradient(90deg,var(--st-failed),color-mix(in srgb,var(--st-success) 50%,var(--st-failed)),var(--st-success))" }} />
        <span className="mono">55 → 100</span>
        <span className="muted">· 셀 투명도 = 표본 수</span>
      </div>
    </div>
  );
}

function FailChart({ agg, onPick }: { agg: ResultsAggregates | undefined; onPick: (r: string) => void }) {
  const reduced = !!useReducedMotion();
  const fr = Object.entries(agg?.byFailureReason ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (!agg) return <div className="skel chart" />;
  if (!fr.length) return <Empty icon={<CheckCircle2 className="i" />}>실패 없음</Empty>;
  return (
    <EChart
      className="chart"
      ariaLabel="실패 사유 분포"
      onEvents={{ click: (p) => onPick(fr[(p as { dataIndex: number }).dataIndex][0]) }}
      option={(t) => eo({
        ...chartBase(t, reduced),
        legend: { show: false },
        grid: { left: 110, right: 36, top: 8, bottom: 20 },
        tooltip: { ...(chartBase(t, reduced).tooltip as object), trigger: "item" },
        xAxis: axY(t),
        yAxis: axX(t, "category", { data: fr.map(([k]) => FAILURE_REASON_META[k as FailureReason]?.label ?? k), inverse: true, axisLabel: { color: t.text, fontSize: 11 } }),
        series: [
          {
            type: "bar",
            barWidth: 10,
            cursor: "pointer",
            data: fr.map(([k, v]) => ({ value: v, itemStyle: { color: t.tone[FAILURE_REASON_META[k as FailureReason]?.tone ?? "failed"], borderRadius: [0, 2, 2, 0] } })),
            label: { show: true, position: "right", color: t.text, fontSize: 10, fontFamily: t.mono },
          },
        ],
      })}
    />
  );
}

function Multi({ lang, base, skip }: { lang: LangCode; base: ResultQuery; skip: boolean }) {
  const reduced = !!useReducedMotion();
  const q = useApi(skip ? null : ["lanes-results-lang", base, lang], () => api.results({ ...base, language: [lang], pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const a = skip ? null : q.data?.aggregates;
  const hs = Object.keys(a?.byHour ?? {}).sort();
  return (
    <div className={`multi L-${lang}`}>
      <h4>
        <LangTag code={lang} />
        <span className="muted mono" style={{ fontWeight: 500 }}>
          {a ? fmt.number(a.total) : 0}건
        </span>
        <b>{a && a.total ? pct(a.passRate) : "—"}</b>
      </h4>
      {skip ? (
        <div className="empty" style={{ height: 120, padding: 8 }}>
          언어 필터로 제외됨
        </div>
      ) : !a ? (
        <div className="skel chart xs" />
      ) : (
        <EChart
          className="chart xs"
          ariaLabel={`${langName(lang)} 시간대별 PASS율`}
          option={(t) => eo({
            ...chartBase(t, reduced),
            legend: { show: false },
            grid: { left: 30, right: 6, top: 8, bottom: 18 },
            tooltip: {
              ...(chartBase(t, reduced).tooltip as object),
              formatter: (p: unknown) => {
                const x = (p as { axisValue: string; value: number }[])[0];
                return `${x.axisValue}시<br>PASS율 ${pct(x.value)} · ${a.byHour[x.axisValue]?.total ?? 0}건`;
              },
            },
            xAxis: axX(t, "category", { data: hs, axisLabel: { color: t.muted, fontSize: 9 } }),
            yAxis: axY(t, { min: 0.5, max: 1, splitNumber: 2, axisLabel: { color: t.muted, fontSize: 9, formatter: (v: number) => String(Math.round(v * 100)) } }),
            series: [{ type: "bar", barWidth: "62%", data: hs.map((h) => a.byHour[h].passRate), itemStyle: { color: t.lang[lang], borderRadius: [2, 2, 0, 0] } }],
          })}
        />
      )}
    </div>
  );
}

function VersionChart({ agg, onPick }: { agg: ResultsAggregates | undefined; onPick: () => void }) {
  const reduced = !!useReducedMotion();
  if (!agg) return <div className="skel chart" />;
  const bcv = agg.byCapsuleVersion;
  const caps = CAPSULES.filter((c) => bcv[c.id]);
  const vers = ["v1.1", "v1.2-rc"];
  const dcI = caps.findIndex((c) => c.id === "device_control");
  const dc = bcv.device_control ?? {};
  return (
    <>
      <EChart
        className="chart"
        ariaLabel="Pipeline 버전 × Capsule PASS율"
        option={(t) => eo({
          ...chartBase(t, reduced),
          grid: { left: 16, right: 10, top: 30, bottom: 8, containLabel: true },
          xAxis: axX(t, "category", { data: caps.map((x) => x.label), axisLabel: { color: t.text, fontSize: 10, rotate: 30, interval: 0 } }),
          yAxis: axY(t, { min: 0.5, max: 1, axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => Math.round(v * 100) + "%" } }),
          tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => (v == null ? "—" : pct(v as number)) },
          series: vers.map((v, i) => ({
            type: "bar",
            name: v,
            barGap: "10%",
            barWidth: 9,
            itemStyle: { color: t.read(i ? "--c-2" : "--c-1"), borderRadius: [2, 2, 0, 0] },
            data: caps.map((x) => bcv[x.id]?.[v]?.passRate ?? null),
            markPoint:
              i && dcI >= 0 && dc[v]
                ? { symbol: "pin", symbolSize: 34, itemStyle: { color: t.tone.retry }, label: { fontSize: 9, color: "#fff", formatter: "회귀" }, data: [{ coord: [dcI, dc[v].passRate] }] }
                : undefined,
          })),
        })}
      />
      {dc["v1.1"]?.passRate != null && dc["v1.2-rc"]?.passRate != null && (
        <div className="note t-retry" style={{ marginTop: 6 }}>
          <TrendingDown className="i sm" /> <b>기기제어(SmartThings)</b>: v1.1 {pct(dc["v1.1"].passRate)} → v1.2-rc <b>{pct(dc["v1.2-rc"].passRate)}</b> (
          {((dc["v1.2-rc"].passRate! - dc["v1.1"].passRate!) * 100).toFixed(1)}pp). v1.2-rc slot 파서 교체 영향 — 승격 전 확인 필요.{" "}
          <button type="button" className="btn sm" onClick={onPick}>
            이 Capsule만 보기
          </button>
        </div>
      )}
    </>
  );
}

function ScoreChart({ pass, fail }: { pass: number[] | undefined; fail: number[] | undefined }) {
  const reduced = !!useReducedMotion();
  if (!pass && !fail) return <div className="skel chart" />;
  const bins = Array.from({ length: 10 }, (_, i) => (i / 10).toFixed(1));
  return (
    <EChart
      className="chart"
      ariaLabel="Judge Score 분포"
      option={(t) => eo({
        ...chartBase(t, reduced),
        grid: { left: 40, right: 10, top: 30, bottom: 24 },
        xAxis: axX(t, "category", { data: bins }),
        yAxis: axY(t),
        series: [
          { type: "bar", name: "FAIL", stack: "s", barWidth: "70%", itemStyle: { color: t.tone.failed }, data: fail ?? bins.map(() => 0) },
          {
            type: "bar",
            name: "PASS",
            stack: "s",
            itemStyle: { color: t.tone.success, borderRadius: [2, 2, 0, 0] },
            data: pass ?? bins.map(() => 0),
            markLine: { silent: true, symbol: "none", lineStyle: { color: t.text, type: "dashed" }, label: { color: t.text, fontSize: 10, formatter: "0.70" }, data: [{ xAxis: "0.7" }] },
          },
        ],
      })}
    />
  );
}

function ResultsTable({
  rows,
  loading,
  sel,
  setSel,
  active,
  onOpen,
}: {
  rows: import("@/lib/types").ResultRow[] | undefined;
  loading: boolean;
  sel: Set<string>;
  setSel: (f: (s: Set<string>) => Set<string>) => void;
  active: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <span className="sr">선택</span>
            </th>
            <th>Utterance</th>
            <th>언어</th>
            <th>Capsule</th>
            <th>발화</th>
            <th>Intent 기대 → 예측</th>
            <th className="r">Judge</th>
            <th>결과</th>
            <th>실패 사유</th>
            <th className="r">Latency</th>
            <th>Device</th>
            <th>Ver</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={12}>
                    <div className="skel" />
                  </td>
                </tr>
              ))
            : rows!.map((r) => {
                const ok = r.result === "PASS";
                const fm = r.failure_reason ? FAILURE_REASON_META[r.failure_reason] : null;
                return (
                  <tr key={r.utterance_id} className={clsx("click", active === r.utterance_id && "sel")} onClick={() => onOpen(r.utterance_id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="chk"
                        checked={sel.has(r.utterance_id)}
                        aria-label="행 선택"
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
                    <td className="mono" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>
                      {r.utterance_id.replace(/^utt-\d{8}-/, "")}
                    </td>
                    <td>
                      <LangTag code={r.language} />
                    </td>
                    <td>{r.capsule}</td>
                    <td className="trunc" style={{ maxWidth: 260 }} title={r.utterance_text}>
                      {r.utterance_text}
                    </td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {r.intent_expected}
                      {r.intent_predicted !== r.intent_expected ? <span style={{ color: "var(--st-failed)" }}> → {r.intent_predicted}</span> : <span className="dim"> ✓</span>}
                    </td>
                    <td className="r mono" style={{ color: `var(--st-${r.judge_score >= 0.7 ? "success" : "failed"})` }}>
                      {r.judge_score.toFixed(2)}
                    </td>
                    <td>
                      <Pill tone={ok ? "success" : "failed"} icon={ok ? <CheckCircle2 /> : <XOctagon />}>
                        {r.result}
                      </Pill>
                    </td>
                    <td>
                      {fm ? (
                        <span className={`t-${fm.tone} tc`} style={{ fontSize: 11, fontWeight: 600 }}>
                          {fm.label}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="r mono">{fmt.number(r.latency_ms)}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {r.device_type}
                    </td>
                    <td className="mono">{r.pipeline_version}</td>
                  </tr>
                );
              })}
          {!loading && !rows!.length && (
            <tr>
              <td colSpan={12}>
                <Empty icon={<Filter className="i" />}>필터에 맞는 결과가 없습니다</Empty>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function UttDetail({ id, onBatch }: { id: string | null; onBatch: (wf: string) => void }) {
  const here = useHere();
  const copy = useCopy();
  const q = useApi(id ? ["lanes-result", id] : null, () => api.result(id!), { revalidateOnFocus: false });
  if (!id)
    return (
      <Empty icon={<Target className="i" />}>
        표에서 행을 선택하면
        <br />
        발화 텍스트 · ASR · 기대/예측 · Judge 판정 · Latency와
        <br />
        원본 Workflow 링크가 표시됩니다
      </Empty>
    );
  if (q.error && !q.data) return <ErrorBox error={q.error} />;
  const d = q.data?.row.utterance_id === id ? q.data : undefined;
  if (!d) return <div className="skel" style={{ height: 380 }} />;
  const r = d.row;
  const ok = r.result === "PASS";
  const asrDiff = r.asr_text !== r.utterance_text;
  const intDiff = r.intent_expected !== r.intent_predicted;
  const fm = r.failure_reason ? FAILURE_REASON_META[r.failure_reason] : null;
  return (
    <div className="utt">
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Pill tone={ok ? "success" : "failed"} icon={ok ? <CheckCircle2 /> : <XOctagon />}>
          {r.result}
        </Pill>
        {fm && <Pill tone={fm.tone}>{fm.label}</Pill>}
        <LangTag code={r.language} />
        <span className="muted" style={{ fontSize: 11 }}>
          {r.capsule}
        </span>
      </div>
      <div className="mono muted" style={{ fontSize: 10.5 }}>
        <CopyId text={r.utterance_id} />
      </div>
      <div className="q">“{r.utterance_text}”</div>
      <div className="cmp">
        <div className={asrDiff ? "bad" : ""}>
          <span>ASR 인식</span>
          {r.asr_text}
          {!asrDiff && <span className="dim"> (일치)</span>}
        </div>
        <div className={intDiff ? "bad" : ""}>
          <span>Intent 기대 → 예측</span>
          <span className="mono" style={{ fontSize: 11 }}>
            {r.intent_expected} → {r.intent_predicted}
          </span>
        </div>
      </div>
      <div className="cmp">
        <div>
          <span>기대 응답</span>
          {r.expected_response}
        </div>
        <div className={ok ? "" : "bad"}>
          <span>실제 응답</span>
          {r.actual_response || <i className="muted">(응답 없음)</i>}
        </div>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          LLM Judge
        </div>
        <div className={`score t-${r.judge_score >= 0.7 ? "success" : "failed"}`}>
          <b className="disp" style={{ fontSize: 30 }}>
            {r.judge_score.toFixed(2)}
          </b>
          <span className="trk">
            <i style={{ width: `${r.judge_score * 100}%` }} />
            <b title="PASS 임계 0.70" />
          </span>
        </div>
        <div style={{ fontSize: 12, marginTop: 4 }}>{r.judge_reason}</div>
      </div>
      <dl className="kv">
        <dt>Latency</dt>
        <dd className="mono" style={r.latency_ms > 8000 ? { color: "var(--st-failed)" } : undefined}>
          {fmt.number(r.latency_ms)}ms{r.latency_ms > 8000 ? " (> 8s)" : ""}
        </dd>
        <dt>Device</dt>
        <dd>{r.device_type}</dd>
        <dt>Model</dt>
        <dd className="mono">{r.model_version}</dd>
        <dt>Pipeline</dt>
        <dd className="mono">{r.pipeline_version}</dd>
        <dt>평가 시각</dt>
        <dd className="mono">{r.eval_timestamp}</dd>
        <dt>Batch</dt>
        <dd className="mono">{r.batch_id}</dd>
        <dt>PipelineJob</dt>
        <dd>
          <CopyId text={r.pipeline_job_id} />
        </dd>
      </dl>
      {d.inputLine && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 11.5 }}>
            원본 입력 JSONL 라인
          </summary>
          <pre className="code" style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {d.inputLine}
          </pre>
        </details>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link className="btn sm pri" href={wfHref(r.workflow_id, here)}>
          <ExternalLink />
          Workflow {shortWf(r.workflow_id)}
        </Link>
        <button type="button" className="btn sm" onClick={() => onBatch(r.workflow_id)}>
          <Filter />이 배치만
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={async () => {
            const t = await fetch(csvUrl({ ids: [r.utterance_id] })).then((x) => x.text());
            void copy(t.replace(/^﻿/, ""));
          }}
        >
          <Copy />
          CSV 행 복사
        </button>
      </div>
    </div>
  );
}

function CsvModal({ title, url, filename, onClose }: { title: string; url: string; filename: string; onClose: () => void }) {
  const copy = useCopy();
  const toast = useToast();
  const q = useApi(["lanes-csv-text", url], () => fetch(url).then(async (r) => ({ text: (await r.text()).replace(/^﻿/, ""), rows: Number(r.headers.get("x-row-count") ?? 0), bytes: Number(r.headers.get("content-length") ?? 0) })), {
    revalidateOnFocus: false,
  });
  const lines = q.data?.text.split("\r\n") ?? [];
  const big = lines.length > 601;
  return (
    <>
      <motion.div className="scrim m" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: "min(1100px,calc(100vw - 32px))", x: "-50%", y: "-50%" }}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
      >
        <div className="modal-h">
          <h3>{title}</h3>
          <button type="button" className="iconbtn" style={{ marginLeft: "auto" }} aria-label="닫기" onClick={onClose}>
            <X className="i" />
          </button>
        </div>
        <div className="modal-b">
          {q.error ? (
            <ErrorBox error={q.error} />
          ) : !q.data ? (
            <div className="skel" style={{ height: "40vh" }} />
          ) : (
            <>
              <p className="muted" style={{ margin: "0 0 8px" }}>
                {fmt.number(q.data.rows || lines.length - 1)}행 · {fmt.bytes(new Blob([q.data.text]).size)} · RFC 4180, CRLF, UTF-8 BOM
                {big && <> — 미리보기는 처음 600행만 표시하며, <b>전체 복사</b>는 전체 행을 복사합니다.</>}
              </p>
              <textarea className="inp mono" readOnly spellCheck={false} style={{ height: "52vh", fontSize: 11, whiteSpace: "pre" }} value={lines.slice(0, 601).join("\n")} />
            </>
          )}
        </div>
        <div className="modal-f">
          <a className="btn" href={url} download onClick={() => toast(`${filename} 다운로드를 시작했습니다`, "success")}>
            <Download />
            CSV 다운로드
          </a>
          <button
            type="button"
            className="btn pri"
            disabled={!q.data}
            onClick={() => {
              if (q.data) void copy(q.data.text).catch((e) => toast(errMsg(e), "failed"));
            }}
          >
            <Copy />
            전체 복사
          </button>
        </div>
      </motion.div>
    </>
  );
}
