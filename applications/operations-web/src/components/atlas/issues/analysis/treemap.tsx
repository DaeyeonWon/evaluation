"use client";
/**
 * Analysis — treemap of FAIL volume over a selectable 3-level hierarchy (`tree=dim,dim,dim`; levels from
 * MATRIX_DIMS + intent), e.g. Division → Agent function → failure reason. Area = FAILs, leaf colour =
 * the worst impact level (영향도) of the issues inside, with its legend. Built from the scored issue list:
 * each issue is filed under its dominant value per row dim, so every issue lands in exactly one leaf.
 * Click a block → node brush (narrows the bubble, patterns and ledger); click it again to clear.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { useT } from "@/i18n/client";
import type { Issue, IssueSeverity } from "@/lib/types";
import { opt, tooltip } from "../../chart";
import { useDimLabel } from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";
import { SEVERITIES, TREE_DIMS, TREE_PRESETS, brushActive, issueValue, matchesBrush, matchesNode, type LabBrush, type LabDim, type TreeNode } from "./lab";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Leaf {
  path: string[];
  count: number;
  sev: IssueSeverity;
  issues: number;
  lit: boolean;
}
type Levels = [LabDim, LabDim, LabDim];
interface Branch {
  value: string;
  count: number;
  /** worst impact level inside (colour when the branch is too small to show its leaves) */
  sev: IssueSeverity;
  children: Map<string, Branch>;
  leaf?: Leaf;
}

/** parse #rgb / #rrggbb / rgb(a)() into [r, g, b] */
function rgb(c: string): [number, number, number] | null {
  const h = c.trim();
  if (h.startsWith("#")) {
    const x = h.length === 4 ? h.slice(1).split("").map((d) => d + d).join("") : h.slice(1, 7);
    const n = parseInt(x, 16);
    return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = h.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
  return [r, g, b];
}
/** `a` mixed over `bg` at weight w (0..1): a dimmed mark that stays opaque (treemap ignores item alpha) */
function mix(a: string, bg: string, w: number): string {
  const x = rgb(a);
  const y = rgb(bg);
  if (!x || !y) return a;
  return `rgb(${x.map((v, i) => Math.round(v * w + y[i] * (1 - w))).join(",")})`;
}

const sameNode = (a: TreeNode | null, b: TreeNode) => !!a && a.length === b.length && a.every((p, i) => p.dim === b[i].dim && p.value === b[i].value);

export function Treemap({
  issues,
  brush,
  vCut,
  levels,
  setLevels,
  node,
  setNode,
}: {
  issues: Issue[];
  brush: LabBrush;
  vCut: number;
  levels: Levels;
  setLevels: (l: Levels) => void;
  node: TreeNode | null;
  setNode: (n: TreeNode | null) => void;
}) {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const dl = useDimLabel();
  const reduced = useReducedMotionSafe();
  const brushing = brushActive({ ...brush, node: null });
  const box = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState(680 * 460);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setArea(Math.max(1, e.contentRect.width) * 420));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dimName = useCallback((d: LabDim) => (d === "intent" ? s("column.intent") : dl.dim(d)), [s, dl]);
  const valName = useCallback((d: LabDim, v: string) => (d === "intent" ? v : dl.value(d, v)), [dl]);

  const root = useMemo(() => {
    const top = new Map<string, Branch>();
    for (const i of issues) {
      const path = levels.map((d) => issueValue(i, d) || "—");
      // lit = passes every brush except the node brush (the node brush is shown as the ring, not a dim)
      const lit = !brushing || matchesBrush(i, brush, vCut, "node");
      let m = top;
      let b: Branch | undefined;
      for (const v of path) {
        b = m.get(v);
        if (!b) m.set(v, (b = { value: v, count: 0, sev: i.severity, children: new Map() }));
        b.count += i.count;
        if (SEVERITIES.indexOf(i.severity) < SEVERITIES.indexOf(b.sev)) b.sev = i.severity;
        m = b.children;
      }
      const l = b!.leaf;
      if (l) {
        l.count += i.count;
        l.issues++;
        l.lit ||= lit;
        if (SEVERITIES.indexOf(i.severity) < SEVERITIES.indexOf(l.sev)) l.sev = i.severity;
      } else b!.leaf = { path, count: i.count, sev: i.severity, issues: 1, lit };
    }
    return top;
  }, [issues, levels, brush, brushing, vCut]);

  const total = issues.reduce((a, i) => a + i.count, 0);
  const px = useCallback((n: number) => (total ? (n / total) * area * 0.78 : 0), [total, area]);
  const nodeOf = useCallback((path: string[]): TreeNode => path.map((v, k) => ({ dim: levels[k], value: v })), [levels]);

  const option = useCallback(
    (tk: ChartTokens) => {
      const sev = (sv: IssueSeverity) => tk.read(`--sev-${sv.toLowerCase()}`);
      const sheet = tk.read("--sheet");
      const ink = tk.read("--ink");
      const inNode = (path: string[]) => !node || node.every((p, k) => path[k] === p.value);
      const build = (m: Map<string, Branch>, depth: number, prefix: string[]): unknown[] =>
        [...m.values()]
          .sort((a, b) => b.count - a.count)
          .map((b) => {
            const path = [...prefix, b.value];
            const name = valName(levels[depth], b.value);
            if (depth === 2 && b.leaf) {
              const l = b.leaf;
              const on = l.lit && inNode(path);
              const ring = sameNode(node, nodeOf(path));
              return {
                name,
                value: l.count,
                path,
                leaf: l,
                itemStyle: { color: on ? sev(l.sev) : mix(sev(l.sev), sheet, 0.16), borderColor: ring ? ink : undefined, borderWidth: ring ? 2 : undefined },
                label: { color: l.sev === "P2" || !on ? tk.text : "#fff", show: px(l.count) >= 900, formatter: px(l.count) >= 3600 ? "{b}\n{n|{c}}" : "{n|{c}}" },
              };
            }
            return { name, path, itemStyle: { color: inNode(path) ? sev(b.sev) : mix(sev(b.sev), sheet, 0.16) }, children: build(b.children, depth + 1, path) };
          });
      const data = build(root, 0, []);
      return opt({
        animationDuration: reduced ? 0 : 600,
        animationDurationUpdate: reduced ? 0 : 450,
        textStyle: { fontFamily: tk.font },
        tooltip: tooltip(tk, {
          trigger: "item",
          formatter: (p: { data?: { path?: string[]; leaf?: Leaf }; value?: number }) => {
            const d = p.data;
            if (!d?.path) return "";
            const share = total ? (((p.value as number) ?? 0) / total) * 100 : 0;
            const head = d.path.map((v, k) => `<span style="opacity:.7">${esc(dimName(levels[k]))}</span> ${esc(valName(levels[k], v))}`).join(" › ");
            const l = d.leaf;
            return `<div style="max-width:320px;white-space:normal">${head}<br/><span style="font-family:${tk.mono};font-size:11px">FAIL ${p.value} · ${share.toFixed(1)}%${l ? ` · ${esc(t("tree.issues", { n: l.issues }))} · <b style="color:${sev(l.sev)}">■</b> ${l.sev} ${esc(s(`impactLevel.${l.sev}`))}` : ""}</span><br/><span style="font-size:10.5px;opacity:.75">${esc(t("tree.hint"))}</span></div>`;
          },
        }),
        series: [
          {
            type: "treemap",
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            top: 4,
            left: 2,
            right: 2,
            bottom: 2,
            squareRatio: 0.9,
            visibleMin: 60,
            data,
            label: { show: true, color: "#fff", fontSize: 10.5, fontFamily: tk.font, overflow: "truncate", ellipsis: "…", rich: { n: { fontFamily: tk.mono, fontSize: 10, fontWeight: 600, opacity: 0.9 } } },
            upperLabel: { show: true, height: 18, color: tk.text, fontSize: 10.5, fontWeight: 700, fontFamily: tk.font, overflow: "truncate" },
            itemStyle: { borderColor: sheet, gapWidth: 2, borderWidth: 0 },
            levels: [
              { itemStyle: { borderColor: tk.read("--rule"), borderWidth: 0, gapWidth: 3 }, upperLabel: { show: false } },
              { itemStyle: { borderColor: tk.read("--sheet-2"), borderWidth: 3, gapWidth: 2 }, upperLabel: { show: true, color: tk.text, backgroundColor: tk.read("--sheet-2") } },
              { itemStyle: { borderColor: sheet, borderWidth: 1, gapWidth: 1 }, upperLabel: { show: true, color: tk.muted, fontWeight: 500, fontFamily: tk.mono, fontSize: 9.5, height: 14, backgroundColor: sheet } },
              { itemStyle: { borderWidth: 0 } },
            ],
          },
        ],
      });
    },
    [root, levels, node, nodeOf, reduced, total, t, s, px, dimName, valName],
  );

  const presetOn = TREE_PRESETS.find((p) => p.levels.join() === levels.join())?.id ?? null;
  const setLevel = (k: number, d: LabDim) => {
    const next = [...levels] as Levels;
    const clash = next.indexOf(d);
    if (clash >= 0 && clash !== k) next[clash] = next[k];
    next[k] = d;
    setLevels(next);
  };
  const nodeIssues = node ? issues.filter((i) => matchesNode(i, node)).length : 0;

  return (
    <div className="lab-tree" ref={box}>
      <div className="lab-hm-presets" role="group" aria-label={t("tree.presets")}>
        {TREE_PRESETS.map((p) => (
          <button key={p.id} type="button" className="lab-preset" aria-pressed={presetOn === p.id} onClick={() => setLevels(p.levels)}>
            {t(`tree.preset.${p.id}`)}
          </button>
        ))}
      </div>
      <div className="lab-viewbar lab-tree-lv">
        {levels.map((d, k) => (
          <label key={k} className="lab-axis">
            <span className="mono">L{k + 1}</span>
            <select className="in" value={d} onChange={(e) => setLevel(k, e.target.value as LabDim)} aria-label={t("tree.level", { n: k + 1 })}>
              {TREE_DIMS.map((x) => (
                <option key={x} value={x}>
                  {dimName(x)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {issues.length ? (
        <EChart
          className="lab-tree-chart"
          option={option}
          ariaLabel={t("tree.aria", { path: levels.map(dimName).join(" → ") })}
          onEvents={{
            click: (p) => {
              const path = (p as { data?: { path?: string[] } }).data?.path;
              if (!path) return;
              const n = nodeOf(path);
              setNode(sameNode(node, n) ? null : n);
            },
          }}
        />
      ) : (
        <div className="empty">{s("empty.issues")}</div>
      )}
      <div className="lab-legend-row">
        {SEVERITIES.map((sv) => (
          <span key={sv}>
            <span className="iss-sev" data-sev={sv}>
              {sv}
            </span>{" "}
            {s(`impactLevel.${sv}`)}
          </span>
        ))}
        <span className="muted mono">{t("tree.area")}</span>
        {node ? <span className="mono muted">{t("tree.nodeIssues", { n: nodeIssues })}</span> : null}
      </div>
    </div>
  );
}
