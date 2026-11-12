/**
 * View-model builders: registry definitions / aggregated node stats / concrete PipelineJobs → DagVM
 * (the reusable renderer's input). Pure (no hooks); the locale and a formatter are passed in.
 */
import type { Locale } from "@/i18n";
import type { LocaleFmt } from "@/lib/format";
import type { JobNode, JobStatus, NodeAggregate, PipelineDefinition, PipelineJob, PipelineJobTree } from "@/lib/types";
import type { DagNodeVM, DagVM } from "../dag/dag-view";

export type PipelineVersionDefn = PipelineDefinition["versions"][number];
export type DefNode = PipelineVersionDefn["nodes"][number];

export const refOf = (n: DefNode) => (n.kind === "subpipeline" ? { pipeline_id: n.ref.pipeline, version: n.ref.version } : null);
export const refLabel = (r: { pipeline_id: string; version: string } | null | undefined) => (r ? `${r.pipeline_id}@${r.version}` : undefined);

/** Glossary: DAG task names stay English in both locales; ko gets the Korean name as a subtitle. */
export function nodeTitles(n: { label: string; labelKo: string }, locale: Locale): { title: string; subtitle?: string } {
  return locale === "ko" && n.labelKo && n.labelKo !== n.label ? { title: n.label, subtitle: n.labelKo } : { title: n.label };
}

export function findVersion(def: PipelineDefinition | undefined, version: string | null | undefined): PipelineVersionDefn | undefined {
  if (!def) return undefined;
  return def.versions.find((v) => v.version === version) ?? def.versions.find((v) => v.status !== "DEPRECATED") ?? def.versions[0];
}

/** Latest non-deprecated version (server default for /pipelines/[id]). */
export function defaultVersion(def: PipelineDefinition | undefined): string | undefined {
  if (!def) return undefined;
  const live = def.versions.filter((v) => v.status !== "DEPRECATED");
  return (live[live.length - 1] ?? def.versions[def.versions.length - 1])?.version;
}

const sumCounts = (c: Partial<Record<JobStatus, number>>) => Object.values(c).reduce((s, v) => s + (v ?? 0), 0);

/** failure share of finished runs; null when nothing finished */
export function failRate(c: Partial<Record<JobStatus, number>>): number | null {
  const done = (c.SUCCEEDED ?? 0) + (c.FAILED ?? 0);
  return done ? (c.FAILED ?? 0) / done : null;
}

/** Aggregate (status view): per-node counts + p50/p95 + top error; heat = relative failure rate. */
export function aggregateVM(nodes: DefNode[], stats: NodeAggregate[], locale: Locale, f: LocaleFmt): DagVM {
  const by = new Map(stats.map((s) => [s.node_id, s]));
  const rates = stats.map((s) => failRate(s.counts) ?? 0);
  const maxRate = Math.max(0.0001, ...rates);
  return {
    nodes: nodes.map((n): DagNodeVM => {
      const s = by.get(n.id);
      const r = s ? (failRate(s.counts) ?? 0) : 0;
      const heat = r > 0 ? Math.min(1, r / Math.max(maxRate, 0.25)) : 0;
      const ref = refOf(n);
      return {
        id: n.id,
        kind: n.kind,
        deps: n.deps,
        ...nodeTitles(n, locale),
        meta: n.kind === "component" ? n.component : undefined,
        refLabel: refLabel(ref),
        counts: s?.counts ?? {},
        readout: s && s.duration.n ? `p50 ${f.duration(s.duration.p50Ms, { style: "short" })} · p95 ${f.duration(s.duration.p95Ms, { style: "short" })}` : "—",
        errorCode: s?.topError ? `${s.topError.code} ×${s.topError.count}` : null,
        heat,
        hot: r >= 0.15 && (s?.counts.FAILED ?? 0) >= 2 && r === maxRate,
      };
    }),
  };
}

/** Aggregate VM straight from a definition (no stats yet / inline fallback). */
export function definitionVM(nodes: DefNode[], locale: Locale): DagVM {
  return {
    nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, deps: n.deps, ...nodeTitles(n, locale), meta: n.kind === "component" ? n.component : undefined, refLabel: refLabel(refOf(n)) })),
  };
}

/** node ids (inside this job) on the failure chain: the failing leaf or the sub-pipeline node that contains it */
export function failChainIds(job: Pick<PipelineJob, "job_id" | "nodes">, failedNodePath: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!failedNodePath) return out;
  for (const n of job.nodes) if (failedNodePath === n.node_path || failedNodePath.startsWith(n.node_path + "/")) out.add(n.id);
  return out;
}

/** Job mode: concrete statuses, durations, progress. */
export function jobVM(job: Pick<PipelineJob, "job_id" | "nodes">, locale: Locale, f: LocaleFmt, failedNodePath?: string | null): DagVM {
  const chain = failChainIds(job, failedNodePath);
  return {
    nodes: job.nodes.map((n: JobNode): DagNodeVM => ({
      id: n.id,
      kind: n.kind,
      deps: n.deps,
      ...nodeTitles(n, locale),
      meta: n.kind === "component" ? `${n.component ?? n.id} · ${n.resources.machineType}${n.resources.gpu ? ` · L4×${n.resources.gpu.count}` : ""}` : undefined,
      refLabel: refLabel(n.ref),
      status: n.status,
      readout: n.duration_ms ? f.duration(n.duration_ms, { style: "short" }) : n.status === "RUNNING" ? f.pct(n.progress?.pct ?? 0, 0) : "—",
      progress: n.progress?.pct ?? 0,
      errorCode: n.error ? n.error.code : null,
      onFailPath: chain.has(n.id),
    })),
  };
}

/** Index a job tree by job id (root + descendants). */
export function indexTree(root: PipelineJobTree | null | undefined): Map<string, PipelineJobTree> {
  const m = new Map<string, PipelineJobTree>();
  const walk = (j: PipelineJobTree) => {
    m.set(j.job_id, j);
    j.children.forEach(walk);
  };
  if (root) walk(root);
  return m;
}

/** job ids from the root down to `jobId` (inclusive). */
export function jobChain(jobId: string): string[] {
  const parts = jobId.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

export const totalOf = sumCounts;
