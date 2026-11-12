"use client";
import clsx from "clsx";
import type { KeyboardEvent } from "react";
import { CatalogIcon } from "@/components/shared";
import { NODE_STATUS_META } from "@/lib/catalog";
import type { ComponentId, DagNode } from "@/lib/types";
import { dur } from "../ui";

const DAGPOS: Record<ComponentId, [number, number]> = {
  preprocess: [14, 113],
  intent_eval: [232, 20],
  response_eval: [232, 113],
  latency_check: [232, 206],
  aggregate: [450, 113],
  persist: [668, 113],
};
const DW = 170;
const DH = 74;

export function DagView({ nodes, selected, onSelect, now }: { nodes: DagNode[]; selected: string | null; onSelect: (id: ComponentId) => void; now: number }) {
  const by = Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<ComponentId, DagNode>;
  const edges = nodes.flatMap((n) =>
    n.deps.map((d) => {
      const [x1, y1] = DAGPOS[d];
      const [x2, y2] = DAGPOS[n.id];
      const a = x1 + DW;
      const b = y1 + DH / 2;
      const c = x2;
      const e = y2 + DH / 2;
      const m = (a + c) / 2;
      const cls = by[d]?.status === "SUCCEEDED" && n.status === "RUNNING" ? "live" : by[d]?.status === "SUCCEEDED" && ["SUCCEEDED", "RUNNING", "FAILED"].includes(n.status) ? "on" : "";
      return <path key={`${d}-${n.id}`} className={clsx("dedge", cls)} d={`M${a},${b} C${m},${b} ${m},${e} ${c},${e}`} />;
    }),
  );
  return (
    <svg className="dag-svg" viewBox="0 0 852 300" role="group" aria-label="Pipeline DAG">
      {edges}
      {nodes.map((n) => {
        const [x, y] = DAGPOS[n.id];
        const m = NODE_STATUS_META[n.status];
        const pct = n.status === "SUCCEEDED" ? 1 : n.progress?.pct ?? 0;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(n.id);
          }
        };
        return (
          <g
            key={n.id}
            className={clsx("dnode", `t-${m.tone}`, n.id === selected && "sel", n.status === "FAILED" && "failed")}
            tabIndex={0}
            role="button"
            aria-pressed={n.id === selected}
            aria-label={`${n.labelKo} ${m.label}`}
            onClick={() => onSelect(n.id)}
            onKeyDown={onKey}
          >
            {n.status === "FAILED" && <rect className="ring" x={x - 4} y={y - 4} width={DW + 8} height={DH + 8} rx={11} />}
            <rect className="b" x={x} y={y} width={DW} height={DH} rx={8} />
            <g transform={`translate(${x + 10},${y + 10})`} className="dic">
              <CatalogIcon name={m.icon} size={14} strokeWidth={2} className={n.status === "RUNNING" ? "spin" : undefined} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
            </g>
            <text className="dl" x={x + 30} y={y + 22}>
              {n.labelKo.replace(" (LLM Judge)", "")}
            </text>
            <text className="ds" x={x + 10} y={y + 40}>
              {n.id}
              {n.resources?.gpu ? " · " + n.resources.gpu.type.replace("NVIDIA_", "") : ""}
            </text>
            <text className="dt" x={x + 10} y={y + 57}>
              {m.label}
            </text>
            <text className="ds" x={x + DW - 10} y={y + 57} textAnchor="end">
              {n.duration_ms ? dur(n.duration_ms) : n.status === "RUNNING" && n.start_at ? dur(now - n.start_at) + "…" : "—"}
            </text>
            <rect className="pbg" x={x + 10} y={y + 63} width={DW - 20} height={3} rx={1.5} />
            <rect className="pfg" x={x + 10} y={y + 63} width={+((DW - 20) * pct).toFixed(1)} height={3} rx={1.5} />
            <title>{`${n.labelKo} · ${m.label}${n.deps.length ? ` · deps: ${n.deps.join(", ")}` : ""}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Node execution timeline (mini Gantt) under the DAG: shows where each component's time went and lets
 * the operator pick a node by its bar. Fills the DAG column so it balances the taller node-detail panel.
 */
export function DagGantt({ nodes, selected, onSelect, now }: { nodes: DagNode[]; selected: string | null; onSelect: (id: ComponentId) => void; now: number }) {
  const spans = nodes.map((n) => ({ n, s: n.start_at, e: n.end_at ?? (n.start_at && n.status === "RUNNING" ? now : null) }));
  const started = spans.filter((x) => x.s != null) as { n: DagNode; s: number; e: number | null }[];
  if (!started.length) return <div className="sub dag-gantt-empty">아직 시작된 노드가 없습니다 — preprocess 시작 후 실행 구간이 표시됩니다.</div>;
  const t0 = Math.min(...started.map((x) => x.s));
  const t1 = Math.max(...started.map((x) => x.e ?? x.s), t0 + 1);
  const span = t1 - t0;
  const pct = (v: number) => +(((v - t0) / span) * 100).toFixed(2);
  return (
    <div className="dag-gantt" role="group" aria-label="노드 실행 구간">
      <div className="dg-head">
        <span className="eyebrow">노드 실행 구간</span>
        <span className="sub mono">총 {dur(span)}</span>
      </div>
      {spans.map(({ n, s, e }) => {
        const m = NODE_STATUS_META[n.status];
        const left = s == null ? 0 : pct(s);
        const width = s == null ? 0 : Math.max(0.8, pct(e ?? s) - left);
        return (
          <button
            key={n.id}
            type="button"
            className={clsx("dg-row", `t-${m.tone}`, n.id === selected && "sel")}
            onClick={() => onSelect(n.id)}
            aria-pressed={n.id === selected}
            title={`${n.labelKo} · ${m.label}${n.duration_ms ? " · " + dur(n.duration_ms) : ""}`}
          >
            <span className="dg-l">{n.id}</span>
            <span className="dg-track">
              {s != null && <i className={clsx("dg-bar", n.status === "RUNNING" && "live")} style={{ left: `${left}%`, width: `${width}%` }} />}
            </span>
            <span className="dg-d mono">{n.duration_ms ? dur(n.duration_ms) : n.status === "RUNNING" && s ? dur(now - s) + "…" : m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
