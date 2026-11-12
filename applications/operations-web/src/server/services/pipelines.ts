import type { NextRequest } from "next/server";
import { LANG_CODES } from "@/lib/catalog";
import type {
  Attempt,
  DurationStats,
  JobStatus,
  NodeAggregate,
  PipelineDefinition,
  PipelineDetail,
  PipelineJobDetail,
  PipelineJobRef,
  PipelineJobTree,
  PipelineRun,
  PipelineRunsPage,
  PipelineSummary,
  ResolvedRange,
  Workflow,
} from "@/lib/types";
import { Query, notFound, paginate } from "../http";
import { getEngine } from "../mock/runtime";
import { avg, countBy, pctl, round4, wfOverlaps } from "../mock/projections";
import { readRange } from "../range";

const JOB_STATUSES: JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "SKIPPED"];

// ───────────────────────────────────────── definitions ──
let DEF_CACHE: { key: unknown; defs: PipelineDefinition[] } | null = null;
export function definitions(): PipelineDefinition[] {
  const e = getEngine();
  if (DEF_CACHE && DEF_CACHE.key === e.pipelines.registry) return DEF_CACHE.defs;
  const reg = e.pipelines.registry;
  const comps = e.pipelines.components;
  const usedBy: Record<string, Set<string>> = {};
  const walk = (root: string, pid: string, ver: string) => {
    const v = e.pipelines.get(pid, ver);
    if (!v) return;
    for (const n of v.nodes)
      if (n.kind === "subpipeline") {
        (usedBy[n.ref.pipeline] ||= new Set()).add(root);
        walk(root, n.ref.pipeline, n.ref.version);
      }
  };
  for (const p of reg) if (p.kind === "root") for (const v of p.versions) walk(p.id, p.id, v.version);
  const defs: PipelineDefinition[] = reg.map((p) => ({
    id: p.id,
    label: p.label,
    labelKo: p.labelKo,
    kind: p.kind,
    description: p.description,
    usedBy: [...(usedBy[p.id] ?? [])],
    versions: p.versions.map((v) => ({
      version: v.version,
      status: v.status,
      releasedAt: (v as { releasedTs?: number }).releasedTs ?? Date.parse(v.releasedAt),
      notes: v.notes,
      nodes: v.nodes.map((n) => {
        if (n.kind === "component") return { ...n, label: n.label ?? comps[n.component].label, labelKo: comps[n.component].labelKo };
        const sp = reg.find((x) => x.id === n.ref.pipeline)!;
        return { ...n, label: n.label ?? sp.label, labelKo: sp.labelKo };
      }),
      edges: v.nodes.flatMap((n) => n.deps.map((d) => ({ from: d, to: n.id }))),
      leafComponents: e.pipelines.leafComponents(p.id, v.version),
      subpipelines: v.nodes.filter((n) => n.kind === "subpipeline").map((n) => (n.kind === "subpipeline" ? `${n.ref.pipeline}@${n.ref.version}` : "")),
      templateUri: `gs://${e.config.buckets.artifacts}/${e.pipelines.templateObject(p.id, v.version)}`,
    })),
  }));
  DEF_CACHE = { key: reg, defs };
  return defs;
}
export function definitionOr404(id: string): PipelineDefinition {
  const d = definitions().find((x) => x.id === id);
  if (!d) throw notFound(`Pipeline을 찾을 수 없습니다: ${id}`);
  return d;
}

// ───────────────────────────────────────── runs ──
interface JobHit {
  job: PipelineJobTree;
  w: Workflow;
  a: Attempt;
}
function flat(t: PipelineJobTree, out: PipelineJobTree[] = []): PipelineJobTree[] {
  out.push(t);
  for (const c of t.children) flat(c, out);
  return out;
}
/** Every job (root + child) whose window overlaps the range. */
export function jobsInRange(r: ResolvedRange, pipelineId?: string): JobHit[] {
  const e = getEngine();
  const now = e.now();
  const out: JobHit[] = [];
  for (const w of e.workflows) {
    if (!wfOverlaps(w, r)) continue;
    for (const a of w.attempts) {
      if (pipelineId) {
        const plan = e.pipelines.plan(a.pipeline_job_id);
        if (plan && a.pipeline_id !== pipelineId && !plan.all.some((n) => n.kind === "subpipeline" && n.pipePath.split("/").pop() === pipelineId)) continue;
      }
      const tree = e.pipelines.jobTree(w, a, now);
      for (const j of flat(tree)) {
        if (pipelineId && j.pipeline_id !== pipelineId) continue;
        const s = j.start_at ?? a.created_at;
        const en = j.end_at ?? (j.status === "RUNNING" || j.status === "PENDING" ? now : s);
        if (s <= r.to && en >= r.from) out.push({ job: j, w, a });
      }
    }
  }
  return out;
}
function toRun(h: JobHit): PipelineRun {
  const j = h.job;
  const errNode = j.error ? j.error : null;
  return {
    job_id: j.job_id,
    root_job_id: j.root_job_id,
    parent_job_id: j.parent_job_id,
    workflow_id: h.w.workflow_id,
    attempt: h.a.attempt,
    language: h.w.language,
    pipeline_id: j.pipeline_id,
    pipeline_version: j.pipeline_version,
    model_version: h.w.model_version,
    status: j.status,
    start_at: j.start_at,
    end_at: j.end_at,
    duration_ms: j.duration_ms,
    error:
      j.status === "FAILED"
        ? { code: errNode?.code ?? h.a.error_code ?? "UNKNOWN", category: errNode?.category ?? h.a.error_category ?? "PIPELINE_EXECUTION", path: errNode?.path ?? h.a.failed_path, message: errNode?.message ?? h.a.error_message ?? "" }
        : null,
  };
}
function durStats(a: number[]): DurationStats {
  return { n: a.length, avgMs: Math.round(avg(a)), p50Ms: pctl(a, 0.5), p95Ms: pctl(a, 0.95) };
}
function summarize(def: PipelineDefinition, hits: JobHit[]): PipelineSummary {
  const by = (s: JobStatus) => hits.filter((h) => h.job.status === s).length;
  const succ = hits.filter((h) => h.job.status === "SUCCEEDED");
  const failed = by("FAILED");
  const durs = succ.map((h) => h.job.duration_ms ?? 0);
  const byVersion: PipelineSummary["byVersion"] = {};
  for (const h of hits) {
    const v = (byVersion[h.job.pipeline_version] ||= { runs: 0, succeeded: 0, failed: 0, successRate: null });
    v.runs++;
    if (h.job.status === "SUCCEEDED") v.succeeded++;
    if (h.job.status === "FAILED") v.failed++;
  }
  for (const v of Object.values(byVersion)) v.successRate = v.succeeded + v.failed ? round4(v.succeeded / (v.succeeded + v.failed)) : null;
  const latest = [...def.versions].reverse().find((v) => v.status !== "DEPRECATED") ?? def.versions[def.versions.length - 1];
  return {
    id: def.id,
    label: def.label,
    labelKo: def.labelKo,
    kind: def.kind,
    versions: def.versions.map((v) => v.version),
    latestVersion: latest.version,
    runs: hits.length,
    running: by("RUNNING"),
    succeeded: succ.length,
    failed,
    cancelled: by("CANCELLED"),
    successRate: succ.length + failed ? round4(succ.length / (succ.length + failed)) : null,
    avgDurationMs: Math.round(avg(durs)),
    p95DurationMs: pctl(durs, 0.95),
    byVersion,
    lastRunAt: hits.reduce<number | null>((m, h) => (h.job.start_at != null && (m == null || h.job.start_at > m) ? h.job.start_at : m), null),
  };
}
export function pipelineSummaries(r: ResolvedRange): PipelineSummary[] {
  const all = jobsInRange(r);
  const byP: Record<string, JobHit[]> = {};
  for (const h of all) (byP[h.job.pipeline_id] ||= []).push(h);
  return definitions().map((d) => summarize(d, byP[d.id] ?? []));
}

export function listPipelines(req: NextRequest) {
  const range = readRange(req);
  const kind = Query.of(req).enumOne("kind", ["root", "sub"] as const);
  const defs = definitions();
  const items = pipelineSummaries(range)
    .filter((s) => !kind || s.kind === kind)
    .map((s) => ({ ...s, definition: defs.find((d) => d.id === s.id)! }));
  return { items, total: items.length, range };
}

export function pipelineDetail(id: string, req: NextRequest): PipelineDetail {
  const def = definitionOr404(id);
  const q = Query.of(req);
  const range = readRange(req);
  const version = q.str("version") ?? [...def.versions].reverse().find((v) => v.status !== "DEPRECATED")?.version ?? def.versions[def.versions.length - 1].version;
  const ver = def.versions.find((v) => v.version === version);
  if (!ver) throw notFound(`Pipeline 버전을 찾을 수 없습니다: ${id}@${version}`);
  const all = jobsInRange(range, id);
  const hits = all.filter((h) => h.job.pipeline_version === version);
  const nodeStats: NodeAggregate[] = ver.nodes.map((n) => {
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
    const durs: number[] = [];
    const errs: Record<string, { code: string; count: number; path: string | null }> = {};
    for (const h of hits) {
      const jn = h.job.nodes.find((x) => x.id === n.id);
      if (!jn) continue;
      counts[jn.status]++;
      if (jn.status === "SUCCEEDED" && jn.duration_ms != null) durs.push(jn.duration_ms);
      if (jn.status === "FAILED" && jn.error) {
        const k = jn.error.code + "|" + (jn.error.path ?? "");
        (errs[k] ||= { code: jn.error.code, count: 0, path: jn.error.path }).count++;
      }
    }
    const top = Object.values(errs).sort((a, b) => b.count - a.count)[0] ?? null;
    return {
      node_id: n.id,
      kind: n.kind,
      component: n.kind === "component" ? n.component : null,
      ref: n.kind === "subpipeline" ? { pipeline_id: n.ref.pipeline, version: n.ref.version } : null,
      label: n.label,
      labelKo: n.labelKo,
      deps: n.deps,
      counts,
      duration: durStats(durs),
      topError: top,
    };
  });
  const recentRuns = hits
    .map(toRun)
    .sort((a, b) => (b.start_at ?? 0) - (a.start_at ?? 0))
    .slice(0, 20);
  return { definition: def, version, nodes: ver.nodes, edges: ver.edges, nodeStats, summary: summarize(def, all), recentRuns, range };
}

export function pipelineRuns(id: string, req: NextRequest): PipelineRunsPage {
  definitionOr404(id);
  const q = Query.of(req);
  const range = readRange(req);
  const st = q.enumList("status", JOB_STATUSES);
  const vers = q.list("version");
  const langs = q.enumList("language", LANG_CODES);
  const wid = q.str("workflow_id");
  const sort = q.enumOne("sort", ["start_desc", "start_asc", "duration_desc"] as const, "start_desc")!;
  let runs = jobsInRange(range, id).map(toRun);
  runs = runs.filter((r) => (!st || st.includes(r.status)) && (!vers || vers.includes(r.pipeline_version)) && (!langs || langs.includes(r.language)) && (!wid || r.workflow_id.includes(wid)));
  const sorters = {
    start_desc: (a: PipelineRun, b: PipelineRun) => (b.start_at ?? 0) - (a.start_at ?? 0),
    start_asc: (a: PipelineRun, b: PipelineRun) => (a.start_at ?? 0) - (b.start_at ?? 0),
    duration_desc: (a: PipelineRun, b: PipelineRun) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0),
  };
  runs.sort(sorters[sort]);
  const { page, pageSize } = q.page(50, 500);
  return {
    ...paginate(runs, page, pageSize),
    range,
    facets: {
      status: countBy(runs, (r) => r.status) as PipelineRunsPage["facets"]["status"],
      version: countBy(runs, (r) => r.pipeline_version),
      language: countBy(runs, (r) => r.language) as PipelineRunsPage["facets"]["language"],
    },
  };
}

// ───────────────────────────────────────── job detail ──
function refOf(j: PipelineJobTree): PipelineJobRef {
  return { job_id: j.job_id, pipeline_id: j.pipeline_id, pipeline_version: j.pipeline_version, node_id: j.parent_node_id ?? "", status: j.status };
}
export function findJob(jobId: string): { w: Workflow; a: Attempt; tree: PipelineJobTree; job: PipelineJobTree; path: PipelineJobTree[] } {
  const e = getEngine();
  const rootId = jobId.split(".")[0];
  const m = /^(.*)-cycle-\d+-attempt-\d+$/.exec(rootId);
  const w = m ? e.getWorkflow(m[1]) : null;
  const a = w?.attempts.find((x) => x.pipeline_job_id === rootId);
  if (!w || !a) throw notFound(`PipelineJob을 찾을 수 없습니다: ${jobId}`);
  const tree = e.pipelines.jobTree(w, a, e.now());
  const path: PipelineJobTree[] = [];
  const dfs = (t: PipelineJobTree): PipelineJobTree | null => {
    path.push(t);
    if (t.job_id === jobId) return t;
    for (const c of t.children) {
      const r = dfs(c);
      if (r) return r;
    }
    path.pop();
    return null;
  };
  const job = dfs(tree);
  if (!job) throw notFound(`PipelineJob을 찾을 수 없습니다: ${jobId}`);
  return { w, a, tree, job, path };
}

export function pipelineJobDetail(jobId: string, req: NextRequest): PipelineJobDetail {
  const e = getEngine();
  const { w, job, path } = findJob(jobId);
  const q = Query.of(req);
  const scope = q.enumOne("job_scope", ["self", "tree"] as const, "self")!;
  const limit = q.int("limit", { min: 1, max: 1000, def: 100 })!;
  const { children, ...rest } = job;
  const logs = e.getLogs(w.workflow_id, { pipeline_job_id: jobId, job_scope: scope });
  const events = e.getEvents(w.workflow_id).filter((ev) => ev.ts <= e.now() && (ev.pipeline_job_id === jobId || (scope === "tree" && !!ev.pipeline_job_id && ev.pipeline_job_id.startsWith(jobId + "."))));
  return {
    ...rest,
    children: children.map(refOf),
    filters: { logs: { pipeline_job_id: jobId, job_scope: scope }, events: { pipeline_job_id: jobId, job_scope: scope } },
    recentLogs: logs.slice(-limit),
    recentEvents: events.slice(-limit),
    ancestors: path.slice(0, -1).map(refOf),
  };
}
