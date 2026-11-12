import type { NextRequest } from "next/server";
import { LANG_CODES, PIPELINE_VERSIONS } from "@/lib/catalog";
import type { FailureReason, ResultDetail, ResultFileMeta, ResultRow, ResultsPage } from "@/lib/types";
import { Query, notFound, paginate } from "../http";
import { getEngine } from "../mock/runtime";
import { resultsAggregates, toSummary } from "../mock/projections";

const REASONS: FailureReason[] = ["INTENT_MISMATCH", "SLOT_ERROR", "RESPONSE_QUALITY", "TIMEOUT", "ASR_ERROR", "POLICY_VIOLATION"];
const SORTS = ["eval_desc", "eval_asc", "score_asc", "score_desc", "latency_desc", "latency_asc", "id_asc"] as const;

function stripFile<T extends { filter?: unknown }>(f: T): Omit<T, "filter"> {
  const { filter: _ignored, ...rest } = f;
  void _ignored;
  return rest;
}

/** Shared filter for GET /results and GET /results/csv. */
export function filterResults(req: NextRequest): { rows: ResultRow[]; q: Query } {
  const e = getEngine();
  const q = Query.of(req);
  const ids = q.list("ids");
  let rows = e.results.rows;
  if (ids) {
    const set = new Set(ids);
    rows = rows.filter((r) => set.has(r.utterance_id));
  }
  const langs = q.enumList("language", LANG_CODES);
  const caps = q.list("capsule");
  const intents = q.list("intent");
  const devices = q.list("device");
  const versions = q.enumList("version", PIPELINE_VERSIONS);
  const result = q.enumOne("result", ["PASS", "FAIL"] as const);
  const reasons = q.enumList("failure_reason", REASONS);
  const wf = q.str("workflow_id");
  const batch = q.str("batch_id");
  const minScore = q.num("min_score", { min: 0, max: 1 });
  const maxScore = q.num("max_score", { min: 0, max: 1 });
  const minLat = q.num("min_latency", { min: 0 });
  const maxLat = q.num("max_latency", { min: 0 });
  const from = q.time("from");
  const to = q.time("to");
  const text = q.str("q")?.toLowerCase();
  rows = rows.filter((r) => {
    if (langs && !langs.includes(r.language)) return false;
    if (caps && !caps.includes(r.capsule_id) && !caps.includes(r.capsule)) return false;
    if (intents && !intents.includes(r.intent_expected)) return false;
    if (devices && !devices.includes(r.device_type)) return false;
    if (versions && !versions.includes(r.pipeline_version)) return false;
    if (result && r.result !== result) return false;
    if (reasons && !reasons.includes(r.failure_reason as FailureReason)) return false;
    if (wf && r.workflow_id !== wf) return false;
    if (batch && r.batch_id !== batch) return false;
    if (minScore != null && r.judge_score < minScore) return false;
    if (maxScore != null && r.judge_score > maxScore) return false;
    if (minLat != null && r.latency_ms < minLat) return false;
    if (maxLat != null && r.latency_ms > maxLat) return false;
    if (from != null && r.eval_ts < from) return false;
    if (to != null && r.eval_ts > to) return false;
    if (text) {
      const hay = (
        r.utterance_id + " " + r.utterance_text + " " + r.asr_text + " " + r.actual_response + " " + r.expected_response + " " +
        r.intent_expected + " " + r.intent_predicted + " " + r.judge_reason + " " + r.workflow_id
      ).toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  const sort = q.enumOne("sort", SORTS, "eval_desc")!;
  const sorters: Record<(typeof SORTS)[number], (a: ResultRow, b: ResultRow) => number> = {
    eval_desc: (a, b) => b.eval_ts - a.eval_ts || (a.utterance_id < b.utterance_id ? -1 : 1),
    eval_asc: (a, b) => a.eval_ts - b.eval_ts || (a.utterance_id < b.utterance_id ? -1 : 1),
    score_asc: (a, b) => a.judge_score - b.judge_score,
    score_desc: (a, b) => b.judge_score - a.judge_score,
    latency_desc: (a, b) => b.latency_ms - a.latency_ms,
    latency_asc: (a, b) => a.latency_ms - b.latency_ms,
    id_asc: (a, b) => (a.utterance_id < b.utterance_id ? -1 : a.utterance_id > b.utterance_id ? 1 : 0),
  };
  rows = [...rows].sort(sorters[sort]);
  return { rows, q };
}

export function resultsPage(req: NextRequest): ResultsPage {
  const e = getEngine();
  const { rows, q } = filterResults(req);
  const { page, pageSize } = q.page(50, 1000);
  const p = paginate(rows, page, pageSize);
  return { rows: p.items, total: p.total, page, pageSize, aggregates: resultsAggregates(e, rows), file: stripFile(e.results.file) };
}

export function resultDetail(id: string): ResultDetail {
  const e = getEngine();
  let row = e.results.rows.find((r) => r.utterance_id === id);
  if (!row) {
    // also look at per-workflow results outside "today"
    for (const rows of Object.values(e._internal.RESULTS_BY_WF)) {
      row = rows.find((r) => r.utterance_id === id);
      if (row) break;
    }
  }
  if (!row) throw notFound(`발화 결과를 찾을 수 없습니다: ${id}`);
  const wf = e.getWorkflow(row.workflow_id);
  let inputLine: string | null = null;
  if (wf) {
    const utts = e._internal.genUtterances(wf);
    const i = utts.findIndex((u) => u.utterance_id === id);
    if (i >= 0) inputLine = e._internal.inputLine(utts[i], wf, i);
  }
  return { row, workflow: wf ? toSummary(wf) : null, inputLine };
}

export function resultFileMeta(): ResultFileMeta {
  const e = getEngine();
  return {
    file: stripFile(e.results.file),
    files: e.results.files.map(stripFile),
    columns: e.results.columns,
    bigquery: { table: e.config.bigquery.resultsTable, rows: e.results.rows.length },
  };
}

export function resultsCsv(req: NextRequest): Response {
  const e = getEngine();
  const { rows, q } = filterResults(req);
  const cols = q.list("columns");
  const csv = e.results.toCSV(rows, { bom: true, ...(cols ? { columns: cols } : {}) });
  const date = e._internal.kstDate(e.now());
  const suffix = [q.list("language")?.join("-"), q.list("version")?.join("-"), q.str("result")?.toLowerCase(), q.list("ids") ? "selected" : null]
    .filter(Boolean)
    .join("_");
  const custom = q.str("filename")?.replace(/[^\w.\-가-힣]/g, "_");
  const filename = custom || `bixby-eval-results_${date}${suffix ? "_" + suffix : ""}.csv`;
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
      "x-row-count": String(rows.length),
    },
  });
}
