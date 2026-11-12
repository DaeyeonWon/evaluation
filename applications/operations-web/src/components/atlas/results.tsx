"use client";
/**
 * U-01 · Evaluation results (per-utterance PASS/FAIL) read from the result CSVs in GCS.
 * Filters live in the URL; every chart is drawn from the server-side aggregates of the FILTERED
 * rows; downloads are real files from /api/v1/results/csv (Content-Disposition + UTF-8 BOM).
 *
 * Every query follows the global period (useTimeRange → eval_ts). `model_version` (model under
 * test) and `pipeline_id` are real API filters + facets — independent of the pipeline version.
 * Explicit row selection (`ids=`) ignores the period by API contract.
 */
import "@/styles/atlas-data.css";
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Eye, FileCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LangBadge } from "@/components/shared";
import { CAPSULES, DEVICES, FAILURE_REASON_META, LANG_CODES } from "@/lib/catalog";
import { api, csvUrl, downloadCsv, parseAsInt, parseAsList, parseAsString, useApi, useQueryStates, type ResultQuery } from "@/lib/client";
import type { FailureReason, LangCode, ResultRow, ResultsAggregates } from "@/lib/types";
import { capsuleLabel, deviceLabel, failureReasonLabel, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { ResultCharts } from "./results/charts";
import { Empty, JsonView, Plate, Sheet, SheetHead, Skeleton, copyText, useToast, useReducedMotionSafe } from "./ui";
import { QueryError, RangeTag, useLoginRedirect, useRangeInfo } from "./analytics/kit";

const PARSERS = {
  language: parseAsList,
  capsule: parseAsString,
  intent: parseAsString,
  device: parseAsString,
  version: parseAsString,
  model_version: parseAsString,
  pipeline_id: parseAsString,
  result: parseAsString,
  reason: parseAsString,
  batch_id: parseAsString,
  workflow_id: parseAsString,
  q: parseAsString,
  sort: parseAsString.withDefault("eval_desc"),
  page: parseAsInt.withDefault(1),
  utt: parseAsString,
};
const PAGE = 50;
const RESULTS_BUCKET = "bixby-eval-results";

export type F = { [K in keyof typeof PARSERS]: (typeof PARSERS)[K]["defaultValue"] };

/** URL filters → API filters (without the period; callers spread the range params in). */
function toQuery(f: F): ResultQuery {
  return {
    language: f.language.length ? (f.language as LangCode[]) : undefined,
    capsule: f.capsule ?? undefined,
    intent: f.intent ?? undefined,
    device: f.device ?? undefined,
    version: f.version ?? undefined,
    model_version: f.model_version ?? undefined,
    pipeline_id: f.pipeline_id ?? undefined,
    result: (f.result as "PASS" | "FAIL" | null) ?? undefined,
    failure_reason: f.reason ?? undefined,
    batch_id: f.batch_id ?? undefined,
    workflow_id: f.workflow_id ?? undefined,
    q: f.q ?? undefined,
  };
}

const facetKeys = (o: Record<string, number> | undefined) =>
  Object.entries(o ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

function CsvModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const t = useT("results");
  const tc = useT("common");
  const f = useFmt();
  const [text, setText] = useState<string | null>(null);
  const [rows, setRows] = useState<number | null>(null);
  const toast = useToast();
  const toLogin = useLoginRedirect();
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then(async (r) => {
        if (r.status === 401) return toLogin();
        const body = await r.text();
        if (alive) {
          setText(r.ok ? body.replace(/^﻿/, "") : t("csv.loadFailed", { status: r.status }));
          setRows(Number(r.headers.get("x-row-count")) || null);
        }
      })
      .catch((e) => alive && setText(t("csv.loadFailed", { status: String(e) })));
    return () => {
      alive = false;
    };
  }, [url, t, toLogin]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const head = text ? text.split("\r\n").slice(0, 401).join("\n") : "";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label={t("csv.title", { label })}>
        <div className="dlg-head">
          <h3>{t("csv.title", { label })}</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label={tc("actions.close")}>
            <X />
          </button>
        </div>
        <div className="dlg-body">
          <div className="note">
            {rows != null ? `${tc("count.rows", { count: rows })} · ` : ""}
            {text ? f.bytes(new Blob([text]).size) + " · " : ""}
            {t("csv.note")} <span className="mono">{url}</span>
          </div>
          {text == null ? <Skeleton rows={8} /> : <textarea className="in mono" readOnly value={head} style={{ minHeight: 360, fontSize: 11, whiteSpace: "pre" }} aria-label={t("csv.previewAria")} />}
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={onClose}>
            {tc("actions.close")}
          </button>
          <a className="btn" href={url} download>
            <Download />
            {t("csv.downloadThis")}
          </a>
          <button
            className="btn primary"
            disabled={!text}
            onClick={async () => {
              if (text && (await copyText(text))) toast.ok(t("csv.copied"));
              else toast.err(t("csv.copyBlocked"));
            }}
          >
            <Copy />
            {t("csv.copyAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

function UttDrawer({ id, rows, onNav, onClose }: { id: string; rows: ResultRow[]; onNav: (id: string) => void; onClose: () => void }) {
  const t = useT("results");
  const tc = useT("common");
  const locale = useLocale();
  const f = useFmt();
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
        aria-label={t("drawer.aria")}
        initial={reduced ? false : { x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="dlg-head">
          <div style={{ minWidth: 0 }}>
            <div className="mono muted" style={{ fontSize: 10.5 }}>
              UTTERANCE {i >= 0 ? `· ${t("drawer.position", { n: i + 1, total: rows.length })}` : ""}
            </div>
            <h3 className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
              {id}
            </h3>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn icon" disabled={i <= 0} onClick={() => onNav(rows[i - 1].utterance_id)} aria-label={t("drawer.prev")}>
              <ChevronLeft />
            </button>
            <button className="btn icon" disabled={i < 0 || i >= rows.length - 1} onClick={() => onNav(rows[i + 1].utterance_id)} aria-label={t("drawer.next")}>
              <ChevronRight />
            </button>
            <button className="btn icon" onClick={onClose} aria-label={tc("actions.close")}>
              <X />
            </button>
          </div>
        </div>
        <div className="dlg-body" style={{ flex: 1 }}>
          {!r ? (
            q.error ? (
              <QueryError error={q.error} />
            ) : (
              <Skeleton rows={8} />
            )
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className={clsx("st-pill solid")} style={{ ["--tone" as string]: r.result === "PASS" ? "var(--st-success)" : "var(--st-failed)" }} title={statusLabel("result", r.result, locale)}>
                  {r.result === "PASS" ? <Check size={13} /> : <X size={13} />}
                  {r.result}
                </span>
                {fr ? (
                  <span className="st-pill" style={{ ["--tone" as string]: `var(--st-${fr.tone})` }}>
                    {failureReasonLabel(r.failure_reason, locale)}
                  </span>
                ) : null}
                <LangBadge lang={r.language} />
                <span className="chip">{capsuleLabel(r.capsule_id ?? r.capsule, locale)}</span>
                <span className="chip">{deviceLabel(r.device_type, locale)}</span>
              </div>
              <div className="cmp">
                <div className="full">
                  <div className="k">UTTERANCE TEXT</div>
                  <div className="v" style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.02em" }}>
                    {r.utterance_text}
                  </div>
                </div>
                <div className="full">
                  <div className="k">ASR TEXT {r.asr_text !== r.utterance_text ? <span className="sev-ERROR">· {t("drawer.mismatch")}</span> : null}</div>
                  <div className="v">{r.asr_text}</div>
                </div>
                <div>
                  <div className="k">{t("drawer.intentExpected")}</div>
                  <div className="v mono">{r.intent_expected}</div>
                </div>
                <div>
                  <div className="k">{t("drawer.intentPredicted")}</div>
                  <div className={clsx("v mono", r.intent_expected !== r.intent_predicted && "sev-ERROR")}>{r.intent_predicted}</div>
                </div>
                <div>
                  <div className="k">{t("drawer.expectedResponse")}</div>
                  <div className="v">{r.expected_response}</div>
                </div>
                <div>
                  <div className="k">{t("drawer.actualResponse")}</div>
                  <div className="v">{r.actual_response || <span className="muted">{t("drawer.noResponse")}</span>}</div>
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
                  ▲ {t("drawer.passLine")}
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13 }}>{r.judge_reason}</p>
              </div>
              <dl className="kv">
                <dt>{t("drawer.latency")}</dt>
                <dd className="mono" style={r.latency_ms > 8000 ? { color: "var(--st-failed)" } : undefined}>
                  {f.number(r.latency_ms)} ms{r.latency_ms > 8000 ? ` · ${t("drawer.over8s")}` : ""}
                </dd>
                <dt>{t("filters.model")}</dt>
                <dd className="mono">{r.model_version}</dd>
                <dt>Pipeline</dt>
                <dd className="mono">
                  {r.pipeline_id} · {r.pipeline_version}
                </dd>
                <dt>{t("drawer.evalTime")}</dt>
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
                    {t("drawer.inputLine")}
                  </summary>
                  <pre className="code wrap" style={{ marginTop: 6 }}>
                    {q.data.inputLine}
                  </pre>
                </details>
              ) : null}
              <details>
                <summary className="mono" style={{ cursor: "pointer", fontSize: 11.5 }}>
                  {t("drawer.rawRow")}
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

/** GCS result objects written in the period (per-workflow results.csv + daily aggregates). */
function ResultFiles({ rangeKey, params, label }: { rangeKey: string; params: Record<string, string>; label: string }) {
  const t = useT("results");
  const f = useFmt();
  const meta = useApi(["results-file"], () => api.resultFile(), { revalidateOn: ["transition"], throttleMs: 6000 });
  const gcs = useApi(["results-gcs", rangeKey], () => api.gcsObjects({ bucket: RESULTS_BUCKET, delimiter: "", limit: 5000, ...params }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const objs = gcs.data?.objects ?? [];
  const csvs = objs.filter((o) => o.name.endsWith("/results.csv"));
  const aggs = objs.filter((o) => o.name.includes("/aggregate/")).sort((a, b) => b.timeCreated - a.timeCreated);
  const rows = csvs.reduce((s, o) => s + (Number(o.metadata?.rows) || 0), 0);
  const bytes = csvs.reduce((s, o) => s + o.size, 0);
  const days = new Set(csvs.map((o) => o.name.slice(0, 10)));
  const latest = csvs.reduce((m, o) => Math.max(m, o.timeCreated), 0);
  const file = meta.data?.file;
  return (
    <div className="res-file">
      <FileCheck aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="uri">{aggs[0]?.uri ?? file?.uri ?? `gs://${RESULTS_BUCKET}/…`}</div>
        <div className="meta">
          <span className="ad-range">{label}</span>
          {gcs.data ? (
            <>
              <span>{t("files.csvCount", { count: csvs.length })}</span>
              <span>{t("files.rows", { count: rows })}</span>
              <span>{f.bytes(bytes)}</span>
              <span>{t("files.days", { count: days.size })}</span>
              {latest ? <span>{t("files.latest", { time: f.dateTimeLabel(latest) })}</span> : null}
            </>
          ) : (
            <span>{t("files.loading")}</span>
          )}
          {meta.data ? (
            <span>
              BigQuery {meta.data.bigquery.table} · {f.number(meta.data.bigquery.rows)} rows
            </span>
          ) : null}
        </div>
      </div>
      <div className="chipset">
        {aggs.slice(0, 6).map((x) => (
          <span className="chip" key={x.uri} title={`${x.uri} · ${f.bytes(x.size)}${x.metadata?.scope ? " · " + x.metadata.scope : ""}`}>
            {x.name.split("/").pop()} · {f.number(Number(x.metadata?.rows) || 0)}
          </span>
        ))}
        {gcs.data && !aggs.length ? <span className="chip">{t("files.noAggregate")}</span> : null}
      </div>
    </div>
  );
}

export function ResultsScreen() {
  const t = useT("results");
  const tc = useT("common");
  const locale = useLocale();
  const fm = useFmt();
  const [f, setF] = useQueryStates(PARSERS);
  const toast = useToast();
  const tr0 = useRangeInfo();
  const rp = tr0.params;
  const query = useMemo(() => toQuery(f as F), [f]);
  const page = f.page ?? 1;
  const q = useMemo<ResultQuery>(() => ({ ...rp, ...query, sort: (f.sort ?? "eval_desc") as ResultQuery["sort"], page, pageSize: PAGE }), [rp, query, f.sort, page]);
  const res = useApi(["results", tr0.key, q], () => api.results(q), { revalidateOn: ["transition"], throttleMs: 4000 });
  const all = useApi(["results", "facets", tr0.key], () => api.results({ ...rp, pageSize: 1 }), { revalidateOn: ["transition"], throttleMs: 8000 });
  const tr = useRangeInfo(res.data?.range ?? all.data?.range);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ url: string; label: string } | null>(null);
  const [qDraft, setQDraft] = useState<string | null>(null);
  const [batchDraft, setBatchDraft] = useState<string | null>(null);

  useEffect(() => {
    if (qDraft == null && batchDraft == null) return;
    const h = setTimeout(() => setF({ ...(qDraft != null ? { q: qDraft || null } : {}), ...(batchDraft != null ? { batch_id: batchDraft || null } : {}), page: 1 }), 320);
    return () => clearTimeout(h);
  }, [qDraft, batchDraft, setF]);

  const d = res.data;
  const ag = d?.aggregates;
  const rows = d?.rows ?? [];
  const filtered = Object.values(query).some((v) => v != null && !(Array.isArray(v) && !v.length));
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const facets = all.data?.facets;
  const intents = Object.keys(all.data?.aggregates.byIntent ?? {}).sort();
  const models = facetKeys(facets?.model_version);
  const pipelines = facetKeys(facets?.pipeline_id);
  const versions = Object.keys(facets?.version ?? {}).sort();
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.utterance_id));
  const setFilter = (p: Partial<F>) => setF({ ...p, page: 1 });
  const fullUrl = csvUrl({ ...rp });
  const filteredUrl = csvUrl({ ...rp, ...query });
  const withCount = (k: string, n: number | undefined) => (n != null ? `${k} · ${fm.number(n)}` : k);
  const sel1 = (label: string, key: keyof F, opts: string[], lab: (x: string) => string = (x) => x, mono = false) => {
    const cur = (f[key] as string | null) ?? "";
    return (
      <label className="field">
        <span>{label}</span>
        <select className={clsx("in", mono && "mono")} value={cur} onChange={(e) => setFilter({ [key]: e.target.value || null } as Partial<F>)}>
          <option value="">{tc("state.all")}</option>
          {cur && !opts.includes(cur) ? <option value={cur}>{lab(cur)}</option> : null}
          {opts.map((x) => (
            <option key={x} value={x}>
              {lab(x)}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET U-01 · EVALUATION RESULTS"
        title={t("title")}
        desc={t("desc")}
        acts={
          <>
            <a className="btn" href={fullUrl} download onClick={() => toast.ok(t("toast.full", { range: tr.label, count: all.data?.total ?? 0 }))}>
              <Download />
              {t("csv.full")}
            </a>
            <a
              className="btn"
              href={filteredUrl}
              download
              aria-disabled={!filtered}
              onClick={(e) => {
                if (!filtered) {
                  e.preventDefault();
                  return toast.err(t("toast.noFilter"));
                }
                toast.ok(t("toast.filtered", { count: d?.total ?? 0, range: tr.label }));
              }}
            >
              <Download />
              {t("csv.filtered")}
            </a>
            <button className="btn" onClick={() => setModal({ url: filtered ? filteredUrl : fullUrl, label: filtered ? t("csv.labelFiltered", { count: d?.total ?? 0 }) : t("csv.labelFull", { range: tr.label }) })}>
              <Eye />
              {t("csv.view")}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (!sel.size) return toast.err(t("toast.selectFirst"));
                downloadCsv({ ...rp, ids: [...sel] });
                toast.ok(t("toast.selected", { count: sel.size }));
              }}
            >
              <Check />
              {sel.size ? t("csv.selectedN", { count: sel.size }) : t("csv.selected")}
            </button>
          </>
        }
      />
      <ResultFiles rangeKey={tr0.key} params={rp} label={tr.label} />

      <Plate>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="filters">
            <label className="field f-wide">
              <span>{t("filters.search")}</span>
              <input className="in" value={qDraft ?? f.q ?? ""} onChange={(e) => setQDraft(e.target.value)} placeholder={t("filters.searchPh")} />
            </label>
            <label className="field">
              <span>Batch ID</span>
              <input className="in mono" value={batchDraft ?? f.batch_id ?? ""} onChange={(e) => setBatchDraft(e.target.value)} placeholder="batch-20261112-ko-0001" />
            </label>
            {sel1("Pipeline", "pipeline_id", pipelines, (x) => withCount(x, facets?.pipeline_id[x]), true)}
            {sel1(t("filters.pipelineVersion"), "version", versions, (x) => withCount(x, facets?.version[x]), true)}
            {sel1(t("filters.model"), "model_version", models, (x) => withCount(x, facets?.model_version[x]), true)}
            {sel1(t("filters.capsule"), "capsule", CAPSULES.map((c) => c.id), (id) => capsuleLabel(id, locale))}
            {sel1(t("filters.intent"), "intent", intents, (x) => x, true)}
            {sel1(t("filters.device"), "device", DEVICES, (x) => deviceLabel(x, locale))}
            {sel1(t("filters.result"), "result", ["PASS", "FAIL"], (x) => x)}
            {sel1(t("filters.reason"), "reason", Object.keys(FAILURE_REASON_META), (k) => `${failureReasonLabel(k, locale)} · ${k}`)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chipset" role="group" aria-label={tc("field.language")}>
              {LANG_CODES.map((c) => (
                <button key={c} aria-pressed={f.language.includes(c)} onClick={() => setFilter({ language: f.language.includes(c) ? f.language.filter((x) => x !== c) : [...f.language, c] })}>
                  <LangBadge lang={c} />
                </button>
              ))}
            </div>
            {f.workflow_id ? (
              <span className="chip">
                workflow {f.workflow_id}
                <button className="btn sm ghost icon" style={{ height: 18, width: 18 }} aria-label={t("filters.clearWorkflow")} onClick={() => setFilter({ workflow_id: null })}>
                  <X />
                </button>
              </span>
            ) : null}
            <button
              className="btn sm ghost"
              onClick={() => {
                setQDraft(null);
                setBatchDraft(null);
                setF({ language: [], capsule: null, intent: null, device: null, version: null, model_version: null, pipeline_id: null, result: null, reason: null, batch_id: null, workflow_id: null, q: null, page: 1 });
              }}
            >
              <X />
              {tc("actions.resetFilters")}
            </button>
            <span className="mono muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
              {d ? t("filters.count", { shown: fm.number(d.total), total: fm.number(all.data?.total ?? d.total) }) : "…"} · {t("filters.selected", { count: sel.size })}
              {sel.size ? (
                <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setSel(new Set())}>
                  {t("filters.clearSelection")}
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </Plate>
      <QueryError error={res.error} />

      <Kpis ag={ag} f={f as F} filtered={filtered} rangeLabel={tr.label} onPick={setFilter} />

      <ResultCharts ag={ag} f={f as F} onPick={setFilter} rangeLabel={tr.label} />

      <Plate flush title={t("table.title")} right={<RangeTag label={`${tr.label} · ${t("table.ref")}`} />}>
        <div className="tbl-wrap" style={{ maxHeight: 660 }}>
          <table className="t">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={t("table.selectPage")}
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
                <th>{tc("field.language")}</th>
                <th>{t("table.capsule")}</th>
                <th>{t("table.utterance")}</th>
                <th>{t("table.intent")}</th>
                <th className="r">
                  <button className="btn sm ghost" style={{ height: 20, padding: 0 }} onClick={() => setF({ sort: f.sort === "score_asc" ? "score_desc" : "score_asc", page: 1 })}>
                    Judge {f.sort === "score_asc" ? "▲" : f.sort === "score_desc" ? "▼" : ""}
                  </button>
                </th>
                <th>{t("table.result")}</th>
                <th>{t("table.reason")}</th>
                <th className="r">
                  <button className="btn sm ghost" style={{ height: 20, padding: 0 }} onClick={() => setF({ sort: f.sort === "latency_desc" ? "latency_asc" : "latency_desc", page: 1 })}>
                    {t("table.latency")} {f.sort === "latency_asc" ? "▲" : f.sort === "latency_desc" ? "▼" : ""}
                  </button>
                </th>
                <th>{t("table.device")}</th>
                <th>Pipeline</th>
                <th>{t("table.model")}</th>
              </tr>
            </thead>
            <tbody>
              {!d ? (
                <tr>
                  <td colSpan={13}>
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
                          aria-label={t("table.selectRow", { id: r.utterance_id })}
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
                      <td>{capsuleLabel(r.capsule_id ?? r.capsule, locale)}</td>
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
                      <td style={{ fontSize: 11.5 }}>{fr ? <span style={{ color: `var(--st-${fr.tone})` }}>{failureReasonLabel(r.failure_reason, locale)}</span> : "—"}</td>
                      <td className="mono r">{fm.number(r.latency_ms)}</td>
                      <td className="muted">{deviceLabel(r.device_type, locale)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {r.pipeline_id}
                        <br />
                        <span className="muted">{r.pipeline_version}</span>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {r.model_version}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={13}>
                    <Empty title={t("table.emptyTitle")}>{t("table.emptyBody")}</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">
            {d && d.total ? `${(page - 1) * PAGE + 1}–${Math.min(d.total, page * PAGE)}` : 0} / {tc("count.rows", { count: d?.total ?? 0 })} · {t("filters.selected", { count: sel.size })}
          </span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setF({ page: page - 1 })} aria-label={t("table.prevPage")}>
              <ChevronLeft />
            </button>
            <span className="mono" style={{ fontSize: 11 }}>
              {page} / {pages}
            </span>
            <button className="btn sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 })} aria-label={t("table.nextPage")}>
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

function Kpis({ ag, f, filtered, rangeLabel, onPick }: { ag: ResultsAggregates | undefined; f: F; filtered: boolean; rangeLabel: string; onPick: (p: Partial<F>) => void }) {
  const t = useT("results");
  const locale = useLocale();
  const fm = useFmt();
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="k">{t("kpi.evaluated")}</div>
        <div className="v">{ag ? fm.number(ag.total) : "—"}</div>
        <div className="s">{filtered ? t("kpi.filtered") : rangeLabel}</div>
      </div>
      <button className="kpi" data-tone style={{ ["--tc" as string]: "var(--st-success)" }} onClick={() => onPick({ result: f.result === "PASS" ? null : "PASS" })} aria-pressed={f.result === "PASS"}>
        <div className="k">PASS</div>
        <div className="v">{ag ? fm.number(ag.pass) : "—"}</div>
        <div className="s">{t("kpi.passRule")}</div>
      </button>
      <button className="kpi" data-tone style={{ ["--tc" as string]: "var(--st-failed)" }} onClick={() => onPick({ result: f.result === "FAIL" ? null : "FAIL" })} aria-pressed={f.result === "FAIL"}>
        <div className="k">FAIL</div>
        <div className="v">{ag ? fm.number(ag.fail) : "—"}</div>
        <div className="s">
          {ag
            ? Object.entries(ag.byFailureReason)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .slice(0, 2)
                .map(([k, v]) => `${failureReasonLabel(k, locale)} ${v}`)
                .join(" · ")
            : ""}
        </div>
      </button>
      <div className="kpi">
        <div className="k">{t("kpi.passRate")}</div>
        <div className="v">{ag ? fm.pct(ag.passRate ?? 0, 1) : "—"}</div>
        <div className="pf">
          <i style={{ width: `${(ag?.passRate ?? 0) * 100}%`, background: "var(--st-success)" }} />
          <i style={{ width: `${(1 - (ag?.passRate ?? 0)) * 100}%`, background: "var(--st-failed)" }} />
        </div>
      </div>
      <div className="kpi">
        <div className="k">{t("kpi.judge")}</div>
        <div className="v">{ag ? (ag.avgJudgeScore || 0).toFixed(3) : "—"}</div>
        <div className="s">LLM Judge</div>
      </div>
      <div className="kpi">
        <div className="k">{t("kpi.latency")}</div>
        <div className="v" style={{ fontSize: 21 }}>
          {ag ? (
            <>
              {fm.number(ag.latency.p50Ms)}
              <small>ms</small> / {fm.number(ag.latency.p95Ms)}
              <small>ms</small>
            </>
          ) : (
            "—"
          )}
        </div>
        <div className="s">{t("kpi.latencyAvg", { ms: ag ? fm.number(ag.latency.avgMs) : "—" })}</div>
      </div>
    </div>
  );
}
