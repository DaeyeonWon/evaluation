"use client";
/**
 * PipelineJob explorer: job tree (root + child jobs) · DAG of the selected job (drill-in or inline
 * expand) · breadcrumb · job meta (PipelineJob ID, status, timings, attempt) · node detail panel.
 * Used by the workflow detail (S-04) and by the run drawer of /pipelines/[id].
 */
import clsx from "clsx";
import { ArrowLeft, ArrowUpRight, Copy, CornerDownRight, GitBranch, Layers, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { StatusPill } from "@/components/shared";
import { failureCategoryLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { NODE_STATUS_META } from "@/lib/catalog";
import type { JobNode, PipelineJobTree } from "@/lib/types";
import { DagView, type DagNodeVM } from "../dag/dag-view";
import { useRangeHref } from "../time-range";
import { copyText, useToast } from "../ui";
import { indexTree, jobChain, jobVM, nodeTitles } from "./model";
import "@/styles/atlas-pipelines.css";

export interface LogScope {
  jobId: string;
  nodePath?: string | null;
}

function JobTreeList({ root, sel, onSel }: { root: PipelineJobTree; sel: string; onSel: (id: string) => void }) {
  const t = useT("pipelines");
  const f = useFmt();
  const rows: { j: PipelineJobTree; depth: number }[] = [];
  const walk = (j: PipelineJobTree, depth: number) => {
    rows.push({ j, depth });
    j.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return (
    <ul className="pl-tree" role="tree" aria-label={t("job.treeLabel")}>
      {rows.map(({ j, depth }) => {
        const tone = NODE_STATUS_META[j.status]?.tone ?? "queued";
        return (
          <li key={j.job_id} role="treeitem" aria-level={depth + 1} aria-selected={j.job_id === sel}>
            <button type="button" className={clsx(`tone-${tone}`, j.job_id === sel && "on")} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => onSel(j.job_id)} title={j.job_id}>
              {depth ? <CornerDownRight className="pl-tree-ind" aria-hidden /> : <GitBranch className="pl-tree-ind" aria-hidden />}
              <i className="dot" aria-hidden />
              <span className="pl-tree-main">
                <b>{j.pipeline_id}</b>
                <span className="mono muted">
                  @{j.pipeline_version}
                  {depth ? ` · ${j.parent_node_id}` : ` · ${t("job.root")}`}
                </span>
              </span>
              <span className="pl-tree-r mono">{j.duration_ms ? f.duration(j.duration_ms, { style: "short" }) : j.status === "RUNNING" ? f.pct(j.progress?.pct ?? 0, 0) : "—"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Artifacts({ title, items }: { title: string; items: JobNode["inputs"] }) {
  const t = useT("pipelines");
  const f = useFmt();
  return (
    <div>
      <div className="grp-t" style={{ padding: "0 0 4px" }}>
        {title}
      </div>
      {items.length ? (
        items.map((i) => (
          <div className="obj" key={i.name + i.uri}>
            <span className="on">
              {i.name} <span className="muted">{i.type}</span>{" "}
              {i.available === undefined ? null : i.available ? <StatusPill kind="node" status="SUCCEEDED" label={t("job.available")} size="xs" /> : <StatusPill kind="node" status="PENDING" label={t("job.notYet")} size="xs" showIcon={false} />}
            </span>
            <span className="om">
              <span>{i.uri}</span>
              {i.sizeBytes ? <span>{f.bytes(i.sizeBytes)}</span> : null}
            </span>
          </div>
        ))
      ) : (
        <span className="muted">—</span>
      )}
    </div>
  );
}

function NodePanel({
  job,
  node,
  child,
  onOpenJob,
  onLogs,
  extra,
}: {
  job: PipelineJobTree;
  node: JobNode | undefined;
  child: PipelineJobTree | undefined;
  onOpenJob: (id: string) => void;
  onLogs?: (s: LogScope) => void;
  extra?: (n: JobNode) => ReactNode;
}) {
  const t = useT("pipelines");
  const f = useFmt();
  const locale = useLocale();
  const rh = useRangeHref();
  if (!node)
    return (
      <div className="empty">
        <b>{t("job.pickNode")}</b>
        {t("job.pickNodeHint")}
      </div>
    );
  const r = node.resources;
  const tt = nodeTitles(node, locale);
  return (
    <div className="pl-np">
      <div className="pl-np-h">
        {node.kind === "subpipeline" ? <Layers aria-hidden /> : null}
        <b>{tt.title}</b>
        {tt.subtitle ? <span className="muted">{tt.subtitle}</span> : null}
        <StatusPill kind="node" status={node.status} />
        <span className="mono muted" style={{ fontSize: 11 }}>
          {node.node_path}
        </span>
      </div>
      {node.kind === "component" ? (
        <p className="muted pl-np-desc">{t.dynamic(`components.${node.component}`, undefined, node.description)}</p>
      ) : null}
      {node.error ? (
        <div className="note bad">
          <b className="mono">{node.error.code}</b> · {failureCategoryLabel(node.error.category, locale)}
          {node.error.path ? (
            <div className="pl-path" style={{ marginTop: 4 }}>
              <span className="muted">{t("job.errorPath")}</span> <FailPath path={node.error.path} />
            </div>
          ) : null}
          <div style={{ marginTop: 3 }}>{node.error.message}</div>
        </div>
      ) : null}
      {node.kind === "subpipeline" ? (
        <>
          <dl className="kv">
            <dt>{t("job.subPipeline")}</dt>
            <dd className="mono">{node.ref ? `${node.ref.pipeline_id}@${node.ref.version}` : "—"}</dd>
            <dt>{t("job.childJob")}</dt>
            <dd className="mono">{node.child_job_id ?? "—"}</dd>
            <dt>{t("job.childStatus")}</dt>
            <dd>{child ? <StatusPill kind="node" status={child.status} size="xs" /> : "—"}</dd>
            <dt>{t("job.duration")}</dt>
            <dd className="mono">{node.duration_ms ? f.duration(node.duration_ms) : "—"}</dd>
            <dt>{t("job.leaves")}</dt>
            <dd className="mono">{child ? child.nodes.map((n) => n.id).join(", ") : "—"}</dd>
          </dl>
          <div className="pl-acts">
            {node.child_job_id ? (
              <button type="button" className="btn sm primary" onClick={() => onOpenJob(node.child_job_id!)}>
                <Layers />
                {t("job.openChild")}
              </button>
            ) : null}
            {node.ref ? (
              <Link className="btn sm" href={rh(`/pipelines/${encodeURIComponent(node.ref.pipeline_id)}?version=${encodeURIComponent(node.ref.version)}`)}>
                <ArrowUpRight />
                {t("job.openInPipelines")}
              </Link>
            ) : null}
            {onLogs && node.child_job_id ? (
              <button type="button" className="btn sm" onClick={() => onLogs({ jobId: node.child_job_id!, nodePath: null })}>
                <Search />
                {t("job.logsForJob")}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <dl className="kv">
            <dt>{t("job.start")}</dt>
            <dd className="mono">{node.start_at ? f.dateTime(node.start_at) : "—"}</dd>
            <dt>{t("job.end")}</dt>
            <dd className="mono">{node.end_at ? f.dateTime(node.end_at) : "—"}</dd>
            <dt>{t("job.duration")}</dt>
            <dd className="mono">{node.duration_ms ? f.duration(node.duration_ms) : "—"}</dd>
            <dt>{t("job.progress")}</dt>
            <dd className="mono">
              {node.progress?.total ? `${node.progress.processed}/${node.progress.total} (${f.pct(node.progress.pct, 1)}) · pass ${node.progress.pass} · fail ${node.progress.fail}` : "—"}
            </dd>
            <dt>{t("job.deps")}</dt>
            <dd className="mono">{node.deps.length ? node.deps.join(", ") : t("job.source")}</dd>
            <dt>Task</dt>
            <dd className="mono">{node.task_id}</dd>
            <dt>Machine</dt>
            <dd className="mono">
              {r.machineType} · CPU {r.cpu.cores}c {r.cpu.utilPct}%{r.gpu ? ` · ${r.gpu.type}×${r.gpu.count} ${r.gpu.utilPct}%` : ""} · Mem {r.memory.usedGb}/{r.memory.limitGb} GB
            </dd>
            <dt>Image</dt>
            <dd className="mono">{node.image ?? "—"}</dd>
          </dl>
          <Artifacts title="Inputs" items={node.inputs} />
          <Artifacts title="Outputs" items={node.outputs} />
          {onLogs ? (
            <div className="pl-acts">
              <button type="button" className="btn sm" onClick={() => onLogs({ jobId: job.job_id, nodePath: node.node_path })}>
                <Search />
                {t("job.logsForNode", { node: node.id })}
              </button>
            </div>
          ) : null}
        </>
      )}
      {extra?.(node)}
    </div>
  );
}

/** response-judge › policy-guard › pii_scan, the leaf in the failed tone */
export function FailPath({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <span className="pl-fpath mono">
      {parts.map((p, i) => (
        <span key={i}>
          {i ? <span className="sep">›</span> : null}
          <span className={clsx(i === parts.length - 1 ? "leaf" : "seg")}>{p}</span>
        </span>
      ))}
    </span>
  );
}

export interface JobExplorerProps {
  root: PipelineJobTree;
  jobId: string | null;
  /** navigate to a job (null = root) and select a node in it, in ONE update */
  onGo: (jobId: string | null, nodeId: string | null) => void;
  nodeId: string | null;
  onNode: (id: string | null) => void;
  failedNodePath?: string | null;
  failedJobId?: string | null;
  failedComponent?: string | null;
  onLogs?: (s: LogScope) => void;
  height?: number;
  attemptLabel?: ReactNode;
}

export function JobExplorer({ root, jobId, onGo, nodeId, onNode, failedNodePath, failedJobId, failedComponent, onLogs, height = 360, attemptLabel }: JobExplorerProps) {
  const t = useT("pipelines");
  const f = useFmt();
  const locale = useLocale();
  const toast = useToast();
  const idx = useMemo(() => indexTree(root), [root]);
  const job = (jobId && idx.get(jobId)) || root;
  const [inline, setInline] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const vm = useMemo(() => jobVM(job, locale, f, failedNodePath), [job, locale, f, failedNodePath]);
  const resolveChild = useCallback(
    (path: string) => {
      const child = idx.get(job.job_id + "." + path.split("/").join("."));
      return child ? jobVM(child, locale, f, failedNodePath) : null;
    },
    [idx, job.job_id, locale, f, failedNodePath],
  );
  const toggle = (path: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  const setInlineMode = (on: boolean) => {
    setInline(on);
    setCollapsed(new Set());
  };

  // node selection: a path relative to the shown job ("safety_check/pii_scan" inside an inline group)
  const resolved = useMemo(() => {
    if (!nodeId) return null;
    const segs = nodeId.split("/");
    let owner: PipelineJobTree | undefined = job;
    for (const s of segs.slice(0, -1)) owner = owner ? idx.get(owner.job_id + "." + s) : undefined;
    const n = owner?.nodes.find((x) => x.id === segs[segs.length - 1]);
    return owner && n ? { owner, node: n } : null;
  }, [nodeId, job, idx]);
  const selPath = resolved ? nodeId : null;
  const node = resolved?.node;
  const onSelect = (path: string) => onNode(path);
  const onDrill = (_path: string, n: DagNodeVM) => {
    const jn = job.nodes.find((x) => x.id === n.id);
    if (jn?.child_job_id) {
      onGo(jn.child_job_id, null);
    }
  };
  const chain = jobChain(job.job_id);
  const parent = chain.length > 1 ? chain[chain.length - 2] : null;
  const childOfSel = node?.child_job_id ? idx.get(node.child_job_id) : undefined;
  const failedHere = failedJobId && failedJobId !== job.job_id && failedNodePath;

  return (
    <div className="pl-jx">
      <div className="pl-jx-side">
        <div className="grp-t">{t("job.tree")}</div>
        <JobTreeList root={root} sel={job.job_id} onSel={(id) => onGo(id === root.job_id ? null : id, null)} />
        {failedNodePath ? (
          <div className="pl-jx-fail">
            <div className="grp-t" style={{ padding: "0 0 4px" }}>
              {t("job.failureOrigin")}
            </div>
            <FailPath path={failedNodePath} />
            {failedJobId ? (
              <button type="button" className="btn sm danger" style={{ marginTop: 8 }} onClick={() => onGo(failedJobId === root.job_id ? null : failedJobId, failedComponent ?? failedNodePath.split("/").pop() ?? null)}>
                {t("job.goToFailure")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pl-jx-main">
        <nav className="crumbs pl-jx-crumbs" aria-label={t("job.breadcrumb")}>
          {parent ? (
            <button type="button" onClick={() => onGo(parent === root.job_id ? null : parent, job.parent_node_id)} aria-label={t("job.back")}>
              <ArrowLeft size={13} aria-hidden /> {t("job.back")}
            </button>
          ) : null}
          {chain.map((id, i) => {
            const j = idx.get(id);
            const last = i === chain.length - 1;
            return (
              <span key={id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {i ? <span className="sep">›</span> : null}
                {last ? (
                  <span className="cur" aria-current="location">
                    {j?.pipeline_id ?? id}
                  </span>
                ) : (
                  <button type="button" onClick={() => onGo(id === root.job_id ? null : id, null)}>
                    {j?.pipeline_id ?? id}
                  </button>
                )}
              </span>
            );
          })}
          {attemptLabel ? <span className="pl-jx-att">{attemptLabel}</span> : null}
        </nav>
        <div className="pl-jmeta">
          <div className="span2">
            <span className="k">PipelineJob ID</span>
            <span className="v mono">
              {job.job_id}
              <button
                type="button"
                className="btn icon sm ghost"
                aria-label={t("job.copyId")}
                title={t("job.copyId")}
                onClick={async () => {
                  if (await copyText(job.job_id)) toast.ok(t("job.copied"));
                }}
              >
                <Copy />
              </button>
            </span>
          </div>
          <div>
            <span className="k">{t("job.status")}</span>
            <span className="v">
              <StatusPill kind="node" status={job.status} />
            </span>
          </div>
          <div>
            <span className="k">Pipeline</span>
            <span className="v mono">
              {job.pipeline_id}@{job.pipeline_version}
            </span>
          </div>
          <div>
            <span className="k">Attempt · depth</span>
            <span className="v mono">
              {job.attempt} · {job.depth}
            </span>
          </div>
          <div>
            <span className="k">{t("job.start")}</span>
            <span className="v mono">{job.start_at ? f.dateTime(job.start_at) : "—"}</span>
          </div>
          <div>
            <span className="k">{t("job.end")}</span>
            <span className="v mono">{job.end_at ? f.dateTime(job.end_at) : job.status === "RUNNING" ? t("job.runningPct", { pct: f.pct(job.progress?.pct ?? 0, 0) }) : "—"}</span>
          </div>
          <div>
            <span className="k">{t("job.duration")}</span>
            <span className="v mono">{job.duration_ms ? f.duration(job.duration_ms, { style: "short" }) : "—"}</span>
          </div>
        </div>
        {job.error && failedHere ? (
          <div className="note bad pl-jx-note">
            <b className="mono">{job.error.code}</b> · {t("job.failedInside")} <FailPath path={job.error.path ?? failedNodePath!} />
          </div>
        ) : null}
        <DagView
          model={vm}
          label={t("dag.label", { pipeline: `${job.pipeline_id}@${job.pipeline_version}` })}
          selected={selPath}
          onSelect={onSelect}
          onDrill={onDrill}
          inline={inline}
          onInlineChange={setInlineMode}
          collapsed={collapsed}
          onToggleExpand={toggle}
          resolveChild={resolveChild}
          height={height}
        />
        <div className="pl-jx-node">
          <NodePanel job={resolved?.owner ?? job} node={node} child={childOfSel} onOpenJob={(id) => onGo(id, null)} onLogs={onLogs} />
        </div>
      </div>
    </div>
  );
}
