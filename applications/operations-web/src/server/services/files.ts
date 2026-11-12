/**
 * Stage-relevant object index + file-name search (GET /files/search, StageDetail.objects).
 *
 * One record per (stage, object) that a user may look for by FILE NAME:
 *   gcs_input       input JSONL (bixby-utterance-input)                          kind gcs_object
 *   event_bus       Eventarc/Pub/Sub message that carried the object             kind pubsub_message (ref = message id)
 *   ingress         Firestore event-registry doc keyed by the input object       kind firestore_doc  (ref = events/{event_id})
 *   registry_queue  Firestore workflow doc + pending_jobs entry                  kind firestore_doc  (ref = workflows/{id})
 *   scheduler       capacity reservation for the workflow                        kind reservation    (ref = reservation id)
 *   workflows       Cloud Workflows execution per attempt                        kind execution      (ref = execution id)
 *   vertex          pipeline artifacts in bixby-pipeline-artifacts (root+child jobs) + templates
 *   results         result CSV / summary.json / daily aggregates in bixby-eval-results
 *   retry           attempt docs that were retried                               kind firestore_doc
 *   dlq             DLQ entry (input_uri)                                        kind dlq_entry      (ref = dead_letter_id)
 * Non-GCS records carry the SOURCE input object in bucket/object so "search by file name" works
 * at every stage.
 */
import type { NextRequest } from "next/server";
import { LANG_CODES, STAGES } from "@/lib/catalog";
import type { FileSearchHit, FileSearchResult, GcsObject, ResolvedRange, StageId, Workflow } from "@/lib/types";
import { Query, badRequest } from "../http";
import { getEngine } from "../mock/runtime";
import { readRange } from "../range";

type Rec = Omit<FileSearchHit, "match_ranges">;
const STAGE_IDS = STAGES.map((s) => s.id);

function gcsRec(stage: StageId, o: GcsObject, w: Workflow | null): Rec {
  return {
    stage,
    kind: "gcs_object",
    bucket: o.bucket,
    object: o.name,
    uri: o.uri,
    generation: o.generation,
    size: o.size,
    updated: o.updated,
    workflow_id: w ? w.workflow_id : (o.workflow_id ?? null),
    batch_id: w ? w.batch_id : null,
    language: w ? w.language : ((o.metadata.language as Rec["language"]) ?? null),
    pipeline_job_id: o.metadata.pipeline_job_id ?? null,
    current_status: w ? w.status : null,
    ref: null,
  };
}

let CACHE: { key: string; recs: Rec[] } | null = null;

/** Build (or reuse) the record index for the current engine state. */
export function allRecords(): Rec[] {
  const e = getEngine();
  const now = e.now();
  const key = [e.meta.baseNow, now, e.workflows.length, e.events.all.length, e.dlq.length, e.gcs.objects[e.config.buckets.artifacts].length].join("|");
  if (CACHE && CACHE.key === key) return CACHE.recs;
  const B = e.config.buckets;
  const recs: Rec[] = [];
  const byWf: Record<string, GcsObject[]> = {};
  for (const b of [B.artifacts, B.results]) for (const o of e.gcs.objects[b]) if (o.timeCreated <= now) (byWf[o.workflow_id ?? ""] ||= []).push(o);
  const resvByWf: Record<string, typeof e.reservations> = {};
  for (const r of e.reservations) (resvByWf[r.workflow_id] ||= []).push(r);
  for (const w of e.workflows) {
    if (w.created_at == null || w.created_at > now) continue;
    const src = e.gcs.get(w.input.bucket, w.input.object);
    const base: Rec = {
      stage: "gcs_input",
      kind: "gcs_object",
      bucket: w.input.bucket,
      object: w.input.object,
      uri: w.input.uri,
      generation: w.input.generation,
      size: w.input.sizeBytes,
      updated: src ? src.updated : w.created_at,
      workflow_id: w.workflow_id,
      batch_id: w.batch_id,
      language: w.language,
      pipeline_job_id: w.pipeline_job_id,
      current_status: w.status,
      ref: null,
    };
    if (!w.replay_of && src) recs.push({ ...base, updated: src.timeCreated });
    const pub = e.getEvents(w.workflow_id).find((ev) => ev.name === "EVENT_PUBLISHED");
    if (pub && pub.ts <= now) {
      const p = pub.payload as Record<string, unknown>;
      recs.push({ ...base, stage: "event_bus", kind: "pubsub_message", updated: pub.ts, ref: String(p.ce_id ?? p.message_id ?? pub.event_id) });
    }
    recs.push({ ...base, stage: "ingress", kind: "firestore_doc", updated: w.validated_at ?? w.created_at, ref: `events/${w.event_id}` });
    if (w.queued_at != null) recs.push({ ...base, stage: "registry_queue", kind: "firestore_doc", updated: w.queued_at, ref: `workflows/${w.workflow_id}` });
    for (const r of resvByWf[w.workflow_id] ?? []) if (r.created_at <= now) recs.push({ ...base, stage: "scheduler", kind: "reservation", updated: r.created_at, ref: r.reservation_id });
    for (const a of w.attempts) {
      if (a.created_at > now) continue;
      recs.push({ ...base, stage: "workflows", kind: "execution", updated: a.created_at, pipeline_job_id: a.pipeline_job_id, ref: a.workflow_execution_id.split("/").pop() ?? a.workflow_execution_id });
      if (a.retry_at != null) recs.push({ ...base, stage: "retry", kind: "firestore_doc", updated: a.completed_at ?? a.created_at, pipeline_job_id: a.pipeline_job_id, ref: `workflows/${w.workflow_id}/attempts/${a.attempt}` });
    }
    for (const o of byWf[w.workflow_id] ?? []) recs.push(gcsRec(o.bucket === B.artifacts ? "vertex" : "results", o, w));
    if (w.dead_letter_id) {
      const dl = e.getDeadLetter(w.dead_letter_id);
      if (dl && dl.created_at <= now) recs.push({ ...base, stage: "dlq", kind: "dlq_entry", updated: dl.updated_at, pipeline_job_id: dl.last_pipeline_job_id, ref: dl.dead_letter_id });
    }
  }
  for (const o of byWf[""] ?? []) recs.push(gcsRec(o.bucket === B.artifacts ? "vertex" : "results", o, null));
  CACHE = { key, recs };
  return recs;
}

function ranges(hay: string, needle: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (!needle) return out;
  const h = hay.toLowerCase();
  let i = h.indexOf(needle);
  while (i >= 0 && out.length < 8) {
    out.push({ start: i, end: i + needle.length });
    i = h.indexOf(needle, i + needle.length);
  }
  return out;
}

/** Match a record by object name, workflow_id or batch_id (case-insensitive substring). */
export function matchRecord(r: Rec, needle: string): FileSearchHit | null {
  if (!needle) return { ...r, match_ranges: [] };
  const mr: FileSearchHit["match_ranges"] = [];
  for (const x of ranges(r.object, needle)) mr.push({ field: "object", ...x });
  if (r.workflow_id) for (const x of ranges(r.workflow_id, needle)) mr.push({ field: "workflow_id", ...x });
  if (r.batch_id) for (const x of ranges(r.batch_id, needle)) mr.push({ field: "batch_id", ...x });
  return mr.length ? { ...r, match_ranges: mr } : null;
}

export function searchRecords(opts: { q: string; range: ResolvedRange; stage?: StageId[]; bucket?: string; language?: string[]; workflowIds?: Set<string> }): FileSearchHit[] {
  const needle = opts.q.trim().toLowerCase();
  const out: FileSearchHit[] = [];
  for (const r of allRecords()) {
    if (r.updated < opts.range.from || r.updated > opts.range.to) continue;
    if (opts.stage && !opts.stage.includes(r.stage)) continue;
    if (opts.bucket && r.bucket !== opts.bucket) continue;
    if (opts.language && (!r.language || !opts.language.includes(r.language))) continue;
    if (opts.workflowIds && (!r.workflow_id || !opts.workflowIds.has(r.workflow_id))) continue;
    const m = matchRecord(r, needle);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.updated - a.updated || (a.object < b.object ? -1 : 1));
  return out;
}

export function fileSearch(req: NextRequest): FileSearchResult {
  const q = Query.of(req);
  const range = readRange(req);
  const text = q.str("q") ?? "";
  const stage = q.enumList("stage", STAGE_IDS);
  const bucket = q.str("bucket");
  const e = getEngine();
  if (bucket && !e.gcs.buckets.some((b) => b.name === bucket)) throw badRequest(`알 수 없는 버킷입니다: ${bucket}`, { allowed: e.gcs.buckets.map((b) => b.name) });
  const language = q.enumList("language", LANG_CODES);
  const limit = q.int("limit", { min: 1, max: 1000, def: 100 })!;
  const all = searchRecords({ q: text, range, stage, bucket, language });
  const byStage: FileSearchResult["byStage"] = {};
  for (const h of all) byStage[h.stage] = (byStage[h.stage] || 0) + 1;
  return { q: text, items: all.slice(0, limit), total: all.length, limit, byStage, range };
}
