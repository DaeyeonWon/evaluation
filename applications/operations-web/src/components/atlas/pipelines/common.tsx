"use client";
/**
 * Pieces shared by /pipelines and /pipelines/[id]: pipeline colors, sparkline, the "mixed running
 * now" strip (every pipeline executing right now, live via SSE `job`), and fetch helpers.
 */
import clsx from "clsx";
import { Activity, Layers } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useFmt, useT } from "@/i18n/client";
import { api, useApi, useSimNow } from "@/lib/client";
import type { PipelineListItem } from "@/lib/client/api";
import type { PipelineRun } from "@/lib/types";
import { useRangeHref } from "../time-range";
import "@/styles/atlas-pipelines.css";

/** registry order → a stable categorical color token */
const ORDER = ["bixby-eval-full", "bixby-eval-quick", "bixby-regression-nightly", "tts-quality", "asr-eval", "nlu-eval", "response-judge", "policy-guard"];
const COLORS = ["var(--cost-1)", "var(--cost-2)", "var(--cost-3)", "var(--cost-4)", "var(--cost-5)", "var(--cost-6)", "var(--accent-2)", "var(--cost-7)"];
export function pipeColor(id: string): string {
  const i = ORDER.indexOf(id);
  if (i >= 0) return COLORS[i];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** All registry definitions + live summaries for the URL range. */
export function usePipelineList(params: Record<string, string>, key: string) {
  return useApi(["pipelines", "list", key], () => api.pipelines(params), { revalidateOn: ["job"], throttleMs: 3000, refreshInterval: 15000 });
}

export function Sparkline({ runs, failed, label, w = 120, h = 28 }: { runs: number[]; failed: number[]; label: string; w?: number; h?: number }) {
  const max = Math.max(1, ...runs);
  const bw = w / Math.max(1, runs.length);
  return (
    <svg className="pl-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <path d={`M0,${h - 0.5} H${w}`} stroke="var(--rule-2)" />
      {runs.map((r, i) => {
        const rh = (r / max) * (h - 3);
        const fh = (Math.min(r, failed[i] ?? 0) / max) * (h - 3);
        return (
          <g key={i}>
            {r ? <rect x={i * bw + 0.5} y={h - rh} width={Math.max(1, bw - 1.2)} height={rh - fh} fill="var(--spark, var(--accent))" opacity={0.75} /> : null}
            {fh ? <rect x={i * bw + 0.5} y={h - fh} width={Math.max(1, bw - 1.2)} height={fh} fill="var(--st-failed)" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** bucket runs by start time over [from, to] */
export function bucketRuns(runs: PipelineRun[], from: number, to: number, n = 24) {
  const span = Math.max(1, to - from);
  const all = Array<number>(n).fill(0);
  const failed = Array<number>(n).fill(0);
  for (const r of runs) {
    const ts = r.start_at ?? r.end_at;
    if (ts == null) continue;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((ts - from) / span) * n)));
    all[i]++;
    if (r.status === "FAILED") failed[i]++;
  }
  return { all, failed };
}

/** Every run of a pipeline in the range (pages of 500, capped). */
export async function allRuns(id: string, params: Record<string, string>, cap = 3000) {
  const first = await api.pipelineRuns(id, { ...params, pageSize: 500, page: 1, sort: "start_asc" });
  const pages = Math.min(Math.ceil(first.total / 500), Math.ceil(cap / 500));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => api.pipelineRuns(id, { ...params, pageSize: 500, page: i + 2, sort: "start_asc" })));
  return { items: first.items.concat(...rest.map((r) => r.items)), total: first.total, range: first.range };
}

/** Currently running jobs of every pipeline (independent of the page range: "now"). */
export function useRunningNow(defs: { id: string; kind: "root" | "sub" }[] | undefined) {
  const ids = (defs ?? []).map((d) => d.id).join(",");
  return useApi(
    ids ? ["pipelines", "running-now", ids] : null,
    async () => {
      const lists = await Promise.all((defs ?? []).map((d) => api.pipelineRuns(d.id, { range: "1h", status: "RUNNING", pageSize: 200, sort: "start_desc" }).then((p) => ({ id: d.id, kind: d.kind, items: p.items, total: p.total }))));
      return lists;
    },
    { revalidateOn: ["job"], throttleMs: 1500, refreshInterval: 10000 },
  );
}

/** The mix of pipelines executing right now: proportional strip + per-pipeline chips + live root jobs. */
export function MixedRunning({ items, current }: { items: PipelineListItem[] | undefined; current?: string }) {
  const t = useT("pipelines");
  const f = useFmt();
  const now = useSimNow();
  const rh = useRangeHref();
  const defs = useMemo(() => (items ?? []).map((i) => ({ id: i.id, kind: i.kind })), [items]);
  const q = useRunningNow(defs);
  const lists = q.data ?? [];
  const roots = lists.filter((l) => l.kind === "root");
  const subs = lists.filter((l) => l.kind === "sub");
  const rootTotal = roots.reduce((s, l) => s + l.total, 0);
  const subTotal = subs.reduce((s, l) => s + l.total, 0);
  const jobs = roots
    .flatMap((l) => l.items)
    .sort((a, b) => (b.start_at ?? 0) - (a.start_at ?? 0))
    .slice(0, 14);
  return (
    <section className="pl-mix" aria-label={t("mix.title")}>
      <div className="pl-mix-h">
        <span className="pl-mix-t">
          <Activity aria-hidden />
          {t("mix.title")}
        </span>
        <span className="mono muted">{t("mix.summary", { roots: rootTotal, subs: subTotal })}</span>
      </div>
      <div className="pl-mix-bar" role="img" aria-label={roots.map((l) => `${l.id} ${l.total}`).join(", ") || t("mix.none")}>
        {rootTotal ? (
          roots
            .filter((l) => l.total)
            .map((l) => (
              <i key={l.id} style={{ flexGrow: l.total, background: pipeColor(l.id) }} title={`${l.id} · ${l.total}`} className={clsx(current === l.id && "cur")} />
            ))
        ) : (
          <i className="empty" style={{ flexGrow: 1 }} />
        )}
      </div>
      <div className="pl-mix-chips">
        {lists.map((l) => (
          <Link key={l.id} href={rh(`/pipelines/${encodeURIComponent(l.id)}`)} className={clsx("pl-chip", l.kind === "sub" && "sub", current === l.id && "cur", !l.total && "idle")} aria-current={current === l.id ? "page" : undefined}>
            <i style={{ background: pipeColor(l.id) }} aria-hidden />
            {l.kind === "sub" ? <Layers aria-hidden /> : null}
            <span>{l.id}</span>
            <b className="mono">{l.total}</b>
          </Link>
        ))}
        {q.isLoading && !lists.length ? <span className="muted mono">{t("loading")}</span> : null}
      </div>
      {jobs.length ? (
        <ol className="pl-mix-jobs" aria-label={t("mix.jobs")}>
          {jobs.map((j) => (
            <li key={j.job_id} style={{ ["--pc" as string]: pipeColor(j.pipeline_id) }}>
              <Link href={rh(`/workflows/${encodeURIComponent(j.workflow_id)}?attempt=${j.attempt}`)} title={j.job_id}>
                <i className="pulse" aria-hidden />
                <span className="mono">{j.workflow_id.replace(/^wf-\d{8}-/, "")}</span>
                <span className="muted mono">
                  {j.pipeline_id.replace("bixby-", "")}@{j.pipeline_version}
                </span>
                <span className="mono r">{j.start_at ? f.duration(Math.max(0, now - j.start_at), { style: "short" }) : "—"}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : lists.length ? (
        <div className="muted pl-mix-none">{t("mix.none")}</div>
      ) : null}
    </section>
  );
}
