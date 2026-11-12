"use client";
/**
 * P-02 · Pipeline status (/pipelines/[id]?version=&path=&node=&run=): pick a pipeline + version and
 * see its DAG with live aggregated status over the URL range — per-node Running / Succeeded / Failed /
 * Pending counts, p50/p95, top error and a hotspot heat. Sub-pipeline nodes drill in (breadcrumb,
 * `path` in the URL) or expand inline; each links to its own /pipelines/[sub]. Side panel: node
 * detail + recent runs (paged, ranged); a run opens that job's DAG in a drawer. Live via SSE `job`.
 */
import clsx from "clsx";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Flame, Layers, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LangBadge, StatusPill } from "@/components/shared";
import { statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { api, parseAsInt, parseAsString, useApi, useQueryStates, useTimeRange } from "@/lib/client";
import type { JobStatus, NodeAggregate, PipelineDetail, PipelineRun } from "@/lib/types";
import { DagView } from "../dag/dag-view";
import { RangeEmpty, RangeTag, useRangeHref } from "../time-range";
import { Empty, ErrorNote, Plate, Sheet, SheetHead, Skeleton, useReducedMotionSafe } from "../ui";
import { MixedRunning, pipeColor, usePipelineList } from "./common";
import { FailPath, JobExplorer } from "./job-explorer";
import { aggregateVM, failRate, nodeTitles, refOf } from "./model";
import "@/styles/atlas-pipelines.css";

const PARSERS = { version: parseAsString, path: parseAsString, node: parseAsString, run: parseAsString, rp: parseAsInt, rs: parseAsString };
const STATUSES: JobStatus[] = ["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "PENDING", "SKIPPED"];
const RUN_FILTERS = ["", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
const PAGE = 12;

/** workflow id from a root job id ({wf}-cycle-c-attempt-a) */
const wfOfJob = (jobId: string) => jobId.split(".")[0].replace(/-cycle-\d+-attempt-\d+$/, "");

function NodeStatsPanel({ s, detail, onDrill }: { s: NodeAggregate | undefined; detail: PipelineDetail; onDrill: (id: string) => void }) {
  const t = useT("pipelines");
  const f = useFmt();
  const locale = useLocale();
  const rh = useRangeHref();
  if (!s)
    return (
      <div className="empty">
        <b>{t("status.pickNode")}</b>
        {t("status.pickNodeHint")}
      </div>
    );
  const tt = nodeTitles(s, locale);
  const total = STATUSES.reduce((a, k) => a + (s.counts[k] ?? 0), 0);
  const fr = failRate(s.counts);
  const def = detail.nodes.find((n) => n.id === s.node_id);
  return (
    <div className="pl-np">
      <div className="pl-np-h">
        {s.kind === "subpipeline" ? <Layers aria-hidden /> : null}
        <b>{tt.title}</b>
        {tt.subtitle ? <span className="muted">{tt.subtitle}</span> : null}
        <span className="mono muted" style={{ fontSize: 11 }}>
          {s.kind === "subpipeline" && s.ref ? `${s.ref.pipeline_id}@${s.ref.version}` : s.component}
        </span>
      </div>
      {s.kind === "component" && s.component ? <p className="muted pl-np-desc">{t.dynamic(`components.${s.component}`, undefined, "")}</p> : null}
      <div className="pl-counts" role="list" aria-label={t("status.countsLabel")}>
        {STATUSES.map((k) => (
          <div key={k} role="listitem" className={clsx(!(s.counts[k] ?? 0) && "zero")}>
            <StatusPill kind="node" status={k} size="xs" />
            <b className="mono">{s.counts[k] ?? 0}</b>
            <span className="bar">
              <i style={{ width: `${total ? ((s.counts[k] ?? 0) / total) * 100 : 0}%`, background: `var(--st-${k === "SUCCEEDED" ? "success" : k === "RUNNING" ? "running" : k === "FAILED" ? "failed" : k === "CANCELLED" ? "cancelled" : "queued"})` }} />
            </span>
          </div>
        ))}
      </div>
      <dl className="kv">
        <dt>{t("status.failRate")}</dt>
        <dd className={clsx("mono", fr != null && fr >= 0.15 && "sev-ERROR")}>{fr == null ? "—" : f.pct(fr, 1)}</dd>
        <dt>{t("status.durations")}</dt>
        <dd className="mono">
          {s.duration.n
            ? `n=${s.duration.n} · avg ${f.duration(s.duration.avgMs, { style: "short" })} · p50 ${f.duration(s.duration.p50Ms, { style: "short" })} · p95 ${f.duration(s.duration.p95Ms, { style: "short" })}`
            : "—"}
        </dd>
        <dt>{t("job.deps")}</dt>
        <dd className="mono">{s.deps.length ? s.deps.join(", ") : t("job.source")}</dd>
      </dl>
      {s.topError ? (
        <div className="note bad">
          <div>
            <span className="muted">{t("status.topError")}</span> <b className="mono">{s.topError.code}</b> ×{s.topError.count}
          </div>
          {s.topError.path ? (
            <div style={{ marginTop: 4 }}>
              <FailPath path={s.topError.path} />
            </div>
          ) : null}
        </div>
      ) : null}
      {s.kind === "subpipeline" && s.ref ? (
        <div className="pl-acts">
          <button type="button" className="btn sm primary" onClick={() => onDrill(s.node_id)}>
            <Layers />
            {t("status.drillIn")}
          </button>
          <Link className="btn sm" href={rh(`/pipelines/${encodeURIComponent(s.ref.pipeline_id)}?version=${encodeURIComponent(s.ref.version)}`)}>
            <ArrowUpRight />
            {t("status.openSub", { id: s.ref.pipeline_id })}
          </Link>
        </div>
      ) : null}
      {def && def.kind === "subpipeline" ? <p className="muted pl-note-sm">{t("status.subStatsNote")}</p> : null}
    </div>
  );
}

function RunRow({ r, onOpen, sel }: { r: PipelineRun; onOpen: () => void; sel: boolean }) {
  const t = useT("pipelines");
  const f = useFmt();
  return (
    <li>
      <button type="button" className={clsx("pl-run", sel && "on")} onClick={onOpen} aria-label={t("status.openRun", { id: r.job_id })}>
        <StatusPill kind="node" status={r.status} size="xs" />
        <span className="pl-run-id mono" title={r.job_id}>
          {r.workflow_id}
          {r.parent_job_id ? <span className="muted">.{r.job_id.split(".").slice(1).join(".")}</span> : null}
        </span>
        <span className="pl-run-m mono muted">
          <LangBadge lang={r.language} /> {r.pipeline_version} · att {r.attempt}
        </span>
        <span className="pl-run-r mono">
          {r.start_at ? f.time(r.start_at) : "—"}
          <br />
          <span className="muted">{r.duration_ms ? f.duration(r.duration_ms, { style: "short" }) : "—"}</span>
        </span>
        {r.error ? (
          <span className="pl-run-err mono">
            {r.error.code}
            {r.error.path ? ` · ${r.error.path}` : ""}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function RunDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const t = useT("pipelines");
  const rh = useRangeHref();
  const reduced = useReducedMotionSafe();
  const rootId = jobId.split(".")[0];
  const wfId = wfOfJob(jobId);
  const q = useApi(["pipelines", "run-tree", wfId], () => api.workflowPipelineRuns(wfId), { revalidateOn: ["job"], throttleMs: 2000 });
  const att = q.data?.attempts.find((a) => a.root.job_id === rootId);
  const [job, setJob] = useState<string | null>(jobId === rootId ? null : jobId);
  const [node, setNode] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const failedNodePath = att?.root.error ? (att.root.nodes.length ? findFailPath(att.root) : null) : null;
  return (
    <motion.aside
      className="pl-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={t("status.runDrawer", { id: jobId })}
      initial={reduced ? false : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <header>
        <div style={{ minWidth: 0 }}>
          <span className="dwg">{t("status.runDrawerDwg")}</span>
          <h2 className="mono">{jobId}</h2>
        </div>
        <Link className="btn sm" href={rh(`/workflows/${encodeURIComponent(wfId)}?attempt=${att?.attempt ?? ""}${job ? `&job=${encodeURIComponent(job)}` : ""}`)}>
          <ArrowUpRight />
          {t("status.openWorkflow")}
        </Link>
        <button type="button" className="btn icon" onClick={onClose} aria-label={t("status.closeDrawer")} autoFocus>
          <X />
        </button>
      </header>
      <div className="pl-drawer-b">
        {q.error ? <ErrorNote error={q.error} /> : null}
        {att ? (
          <JobExplorer root={att.root} jobId={job} onGo={(j, n) => (setJob(j), setNode(n))} nodeId={node} onNode={setNode} failedNodePath={failedNodePath} failedJobId={failedNodePath ? deepestFailedJob(att.root) : null} height={320} attemptLabel={<StatusPill kind="attempt" status={att.status} size="xs" />} />
        ) : q.data ? (
          <Empty title={t("status.runMissing")} />
        ) : (
          <Skeleton rows={6} />
        )}
      </div>
    </motion.aside>
  );
}

/** node_path of the deepest FAILED leaf in a job tree */
function findFailPath(root: { nodes: { status: string; kind: string; node_path: string; child_job_id: string | null }[]; children: unknown[] }): string | null {
  type J = { nodes: { status: string; kind: string; node_path: string; child_job_id: string | null }[]; children: J[]; job_id?: string };
  const walk = (j: J): string | null => {
    for (const n of j.nodes) {
      if (n.status !== "FAILED") continue;
      if (n.kind === "component") return n.node_path;
      const c = j.children.find((x) => x.job_id === n.child_job_id);
      const deeper = c ? walk(c) : null;
      return deeper ?? n.node_path;
    }
    return null;
  };
  return walk(root as J);
}
function deepestFailedJob(root: { job_id: string; status: string; children: unknown[] }): string {
  type J = { job_id: string; status: string; children: J[] };
  let cur = root as J;
  for (;;) {
    const c = cur.children.find((x) => x.status === "FAILED");
    if (!c) return cur.job_id;
    cur = c;
  }
}

export function PipelineStatus() {
  const t = useT("pipelines");
  const f = useFmt();
  const locale = useLocale();
  const router = useRouter();
  const rh = useRangeHref();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const tr = useTimeRange();
  const [q, setQ] = useQueryStates(PARSERS);
  const path = useMemo(() => (q.path ? q.path.split("/").filter(Boolean) : []), [q.path]);
  const list = usePipelineList(tr.params, tr.key);
  const items = list.data?.items;
  const def = items?.find((i) => i.id === id)?.definition;

  const chainQ = useApi(
    ["pipelines", "chain", id, q.version ?? "", q.path ?? "", tr.key],
    async () => {
      const levels: PipelineDetail[] = [];
      let d = await api.pipeline(id, { ...tr.params, version: q.version ?? undefined });
      levels.push(d);
      for (const seg of path) {
        const n = d.nodes.find((x) => x.id === seg);
        const ref = n ? refOf(n) : null;
        if (!ref) break;
        d = await api.pipeline(ref.pipeline_id, { ...tr.params, version: ref.version });
        levels.push(d);
      }
      return levels;
    },
    { revalidateOn: ["job"], throttleMs: 2000, refreshInterval: 12000 },
  );
  const levels = chainQ.data && chainQ.data[0]?.definition.id === id ? chainQ.data : undefined;
  const cur = levels?.[levels.length - 1];
  const top = levels?.[0];

  // inline expand: preload stats of every nested sub-pipeline below the current level
  const [inline, setInline] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const curKey = cur ? `${cur.definition.id}@${cur.version}` : "";
  const nestedQ = useApi(
    inline && cur ? ["pipelines", "nested", curKey, tr.key] : null,
    async () => {
      const out: Record<string, PipelineDetail> = {};
      const visit = async (d: PipelineDetail, depth: number) => {
        if (depth > 3) return;
        await Promise.all(
          d.nodes.map(async (n) => {
            const ref = refOf(n);
            if (!ref) return;
            const k = `${ref.pipeline_id}@${ref.version}`;
            if (out[k]) return;
            const sub = await api.pipeline(ref.pipeline_id, { ...tr.params, version: ref.version });
            out[k] = sub;
            await visit(sub, depth + 1);
          }),
        );
      };
      await visit(cur!, 0);
      return out;
    },
    { revalidateOn: ["job"], throttleMs: 3000 },
  );
  const vm = useMemo(() => (cur ? aggregateVM(cur.nodes, cur.nodeStats, locale, f) : { nodes: [] }), [cur, locale, f]);
  const resolveChild = useCallback(
    (p: string) => {
      if (!cur) return null;
      let d: PipelineDetail | undefined = cur;
      for (const seg of p.split("/")) {
        const n: PipelineDetail["nodes"][number] | undefined = d?.nodes.find((x) => x.id === seg);
        const ref: { pipeline_id: string; version: string } | null = n ? refOf(n) : null;
        d = ref ? nestedQ.data?.[`${ref.pipeline_id}@${ref.version}`] : undefined;
        if (!d) return null;
      }
      return d ? aggregateVM(d.nodes, d.nodeStats, locale, f) : null;
    },
    [cur, nestedQ.data, locale, f],
  );
  const setInlineMode = (on: boolean) => {
    setInline(on);
    setCollapsed(new Set());
  };
  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  // selected node (may be nested when inline: "safety_check/pii_scan")
  const selStats = useMemo(() => {
    if (!cur || !q.node) return { s: undefined, owner: cur };
    const segs = q.node.split("/");
    let d: PipelineDetail | undefined = cur;
    for (const seg of segs.slice(0, -1)) {
      const n: PipelineDetail["nodes"][number] | undefined = d?.nodes.find((x) => x.id === seg);
      const ref: { pipeline_id: string; version: string } | null = n ? refOf(n) : null;
      d = ref ? nestedQ.data?.[`${ref.pipeline_id}@${ref.version}`] : undefined;
    }
    return { s: d?.nodeStats.find((x) => x.node_id === segs[segs.length - 1]), owner: d ?? cur };
  }, [cur, q.node, nestedQ.data]);

  const drill = (nodePath: string) => {
    setQ({ path: [...path, ...nodePath.split("/")].join("/"), node: null, rp: null }, { history: "push" });
    setInline(false);
  };
  const onDrill = (p: string) => drill(p);
  const goLevel = (i: number) => setQ({ path: path.slice(0, i).join("/") || null, node: path[i] ?? null, rp: null }, { history: "push" });

  // runs of the current level
  const runPipe = cur?.definition.id ?? id;
  const runVer = cur?.version;
  const page = q.rp ?? 1;
  const runsQ = useApi(
    cur ? ["pipelines", "runs", runPipe, runVer ?? "", tr.key, page, q.rs ?? ""] : null,
    () => api.pipelineRuns(runPipe, { ...tr.params, version: runVer, page, pageSize: PAGE, status: q.rs ?? undefined, sort: "start_desc" }),
    { revalidateOn: ["job"], throttleMs: 2500 },
  );
  const runs = runsQ.data;
  const pages = runs ? Math.max(1, Math.ceil(runs.total / PAGE)) : 1;

  const sum = cur?.summary;
  const isNested = path.length > 0;
  const hot = cur ? [...cur.nodeStats].filter((s) => (failRate(s.counts) ?? 0) > 0).sort((a, b) => (failRate(b.counts) ?? 0) - (failRate(a.counts) ?? 0)).slice(0, 3) : [];

  if (list.data && !def)
    return (
      <Sheet>
        <SheetHead dwg="SHEET P-02 · PIPELINE STATUS" title={t("status.notFound")} desc={<span className="mono">{id}</span>} acts={<Link className="btn" href={rh("/pipelines")}>{t("status.backToCatalog")}</Link>} />
      </Sheet>
    );

  return (
    <Sheet>
      <nav className="crumbs" aria-label={t("status.crumbs")}>
        <Link href={rh("/pipelines")}>
          <ChevronLeft size={14} aria-hidden /> Pipelines
        </Link>
        <span className="sep">/</span>
        {(levels ?? [{ definition: { id } } as PipelineDetail]).map((l, i, arr) => (
          <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {i ? <span className="sep">›</span> : null}
            {i === arr.length - 1 ? (
              <span className="cur" aria-current="location">
                {l.definition.id}
                {l.version ? <span className="muted">@{l.version}</span> : null}
              </span>
            ) : (
              <button type="button" onClick={() => goLevel(i)}>
                {l.definition.id}
              </button>
            )}
          </span>
        ))}
      </nav>
      <SheetHead
        dwg="SHEET P-02 · PIPELINE STATUS"
        title={
          <span className="pl-title" style={{ ["--pc" as string]: pipeColor(id) }}>
            <i aria-hidden />
            {def?.label ?? id}
            {locale === "ko" && def && def.labelKo !== def.label ? <small> · {def.labelKo}</small> : null}
          </span>
        }
        desc={def ? t.dynamic(`defs.${id}`, undefined, def.description) : null}
        acts={
          <>
            <RangeTag />
            <label className="field pl-pick">
              <span className="sr">{t("status.pickPipeline")}</span>
              <select className="in" value={id} onChange={(e) => router.push(rh(`/pipelines/${encodeURIComponent(e.target.value)}`))} aria-label={t("status.pickPipeline")}>
                <optgroup label={t("catalog.roots")}>
                  {(items ?? []).filter((i) => i.kind === "root").map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.id}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("catalog.subs")}>
                  {(items ?? []).filter((i) => i.kind === "sub").map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.id}
                    </option>
                  ))}
                </optgroup>
                {!items ? <option value={id}>{id}</option> : null}
              </select>
            </label>
          </>
        }
      />
      {def ? (
        <div className="pl-vers" role="group" aria-label={t("status.versionGroup")}>
          <span className="k">Version</span>
          {def.versions.map((v) => {
            const on = (top?.version ?? q.version) === v.version;
            const bv = items?.find((i) => i.id === id)?.byVersion[v.version];
            return (
              <button key={v.version} type="button" aria-pressed={on} onClick={() => setQ({ version: v.version, path: null, node: null, rp: null }, { history: "push" })}>
                <b className="mono">{v.version}</b>
                <span className={clsx("pl-vst", v.status.toLowerCase())}>{statusLabel("version", v.status, locale)}</span>
                <span className="mono muted">{bv ? t("status.versionRuns", { count: bv.runs }) : "—"}</span>
              </button>
            );
          })}
          {def.kind === "sub" && def.usedBy.length ? (
            <span className="pl-usedby">
              <span className="k">{t("catalog.calledBy")}</span>
              {def.usedBy.map((u) => (
                <Link key={u} className="chip" href={rh(`/pipelines/${encodeURIComponent(u)}`)}>
                  {u}
                </Link>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}

      <MixedRunning items={items} current={id} />

      {chainQ.error && !levels ? <ErrorNote error={chainQ.error} /> : null}

      <div className="kpis pl-kpis" aria-live="polite">
        {[
          { k: t("kpi.runs"), v: sum ? f.number(sum.runs) : "—" },
          { k: t("kpi.running"), v: sum ? f.number(sum.running) : "—", tone: sum?.running ? "running" : undefined },
          { k: t("kpi.succeeded"), v: sum ? f.number(sum.succeeded) : "—", tone: "success" },
          { k: t("kpi.failed"), v: sum ? f.number(sum.failed) : "—", tone: sum?.failed ? "failed" : undefined },
          { k: t("kpi.successRate"), v: sum?.successRate == null ? "—" : f.pct(sum.successRate, 1), tone: sum?.successRate != null && sum.successRate < 0.8 ? "retry" : undefined },
          { k: "p95", v: sum?.p95DurationMs ? f.duration(sum.p95DurationMs, { style: "short" }) : "—", s: sum?.avgDurationMs ? t("kpi.avg", { v: f.duration(sum.avgDurationMs, { style: "short" }) }) : undefined },
        ].map((x) => (
          <div key={x.k} className={clsx("kpi", x.tone && `tone-${x.tone}`)} data-tone={x.tone}>
            <div className="k">{x.k}</div>
            <div className="v">{x.v}</div>
            {x.s ? <div className="s">{x.s}</div> : isNested ? <div className="s">{cur?.definition.id}</div> : null}
          </div>
        ))}
      </div>

      <div className="split s-73">
        <Plate
          flush
          title={
            <>
              {isNested ? (
                <button type="button" className="btn sm ghost" onClick={() => goLevel(path.length - 1)} aria-label={t("job.back")}>
                  <ArrowLeft />
                </button>
              ) : null}
              {t("status.dagTitle")}
              <span className="mono muted pl-h-ref">{cur ? `${cur.definition.id}@${cur.version}` : ""}</span>
            </>
          }
          right={<span className="ref">{t("status.aggregatedOver")}</span>}
        >
          {levels && cur ? (
            <>
              {sum && !sum.runs ? <RangeEmpty title={t("status.noRuns")} /> : null}
              <DagView
                model={vm}
                label={t("dag.label", { pipeline: `${cur.definition.id}@${cur.version}` })}
                selected={q.node}
                onSelect={(p) => setQ({ node: p })}
                onDrill={onDrill}
                inline={inline}
                onInlineChange={setInlineMode}
                collapsed={collapsed}
                onToggleExpand={toggle}
                resolveChild={resolveChild}
                height={430}
                footer={
                  <span className="pl-legend">
                    <span className="sw heat" aria-hidden />
                    {t("status.heatLegend")}
                    <span className="sw hot" aria-hidden>
                      HOT
                    </span>
                    {t("status.hotLegend")}
                  </span>
                }
              />
              {hot.length ? (
                <div className="pl-hot">
                  <Flame aria-hidden />
                  <span className="k">{t("status.hotspots")}</span>
                  {hot.map((h) => (
                    <button key={h.node_id} type="button" className="chip" onClick={() => setQ({ node: h.node_id })}>
                      {h.node_id} · {f.pct(failRate(h.counts) ?? 0, 0)}
                      {h.topError ? ` · ${h.topError.code}` : ""}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <Skeleton rows={7} />
          )}
        </Plate>
        <div className="pl-side">
          <Plate title={t("status.nodePanel")}>{cur ? <NodeStatsPanel s={selStats.s} detail={selStats.owner ?? cur} onDrill={() => q.node && drill(q.node)} /> : <Skeleton rows={4} />}</Plate>
          <Plate
            flush
            title={t("status.recentRuns")}
            right={
              <select className="in pl-rs" value={q.rs ?? ""} onChange={(e) => setQ({ rs: e.target.value || null, rp: null })} aria-label={t("status.runFilter")}>
                {RUN_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s ? statusLabel("node", s, locale) : t("status.allStatuses")}
                    {s && runs?.facets.status[s as JobStatus] != null ? ` (${runs.facets.status[s as JobStatus]})` : ""}
                  </option>
                ))}
              </select>
            }
          >
            {runs ? (
              runs.items.length ? (
                <>
                  <ol className="pl-runs">
                    {runs.items.map((r) => (
                      <RunRow key={r.job_id} r={r} sel={q.run === r.job_id} onOpen={() => setQ({ run: r.job_id }, { history: "push" })} />
                    ))}
                  </ol>
                  <div className="pl-pager">
                    <span className="mono muted">{t("status.runsTotal", { from: (page - 1) * PAGE + 1, to: Math.min(runs.total, page * PAGE), total: runs.total })}</span>
                    <button type="button" className="btn sm icon" disabled={page <= 1} onClick={() => setQ({ rp: page - 1 })} aria-label={t("status.prevPage")}>
                      <ChevronLeft />
                    </button>
                    <span className="mono">
                      {page}/{pages}
                    </span>
                    <button type="button" className="btn sm icon" disabled={page >= pages} onClick={() => setQ({ rp: page + 1 })} aria-label={t("status.nextPage")}>
                      <ChevronRight />
                    </button>
                  </div>
                </>
              ) : (
                <RangeEmpty title={t("status.noRunsList")} />
              )
            ) : (
              <Skeleton rows={5} />
            )}
          </Plate>
        </div>
      </div>
      <AnimatePresence>{q.run ? <RunDrawer key={q.run} jobId={q.run} onClose={() => setQ({ run: null })} /> : null}</AnimatePresence>
    </Sheet>
  );
}
