"use client";
/**
 * Signal Lab — treemap of FAIL volume: Agent function → Intent → failure reason (area = FAILs,
 * leaf colour = worst severity of the issues inside, with the severity legend). Built from the
 * scored issue list (every issue in range). Click a block → filter to that function / intent / reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { useT } from "@/i18n/client";
import type { Issue, IssueSeverity } from "@/lib/types";
import { opt, tooltip } from "../../chart";
import { useIssueFormat, type IssueFiltersApi } from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";
import { SEVERITIES, matchesBrush, type LabBrush } from "./lab";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "smartthings.door_unlock" → "door_unlock" (the function header already names the domain) */
const short = (intent: string) => intent.split(".").slice(1).join(".") || intent;

interface Leaf {
  fn: string;
  intent: string;
  reason: string;
  count: number;
  sev: IssueSeverity;
  issues: number;
  lit: boolean;
}

export function Treemap({ issues, f, brush, vCut }: { issues: Issue[]; f: IssueFiltersApi; brush: LabBrush; vCut: number }) {
  const t = useT("issuesAnalysis");
  const fx = useIssueFormat();
  const reduced = useReducedMotionSafe();
  const brushing = !!(brush.quad || brush.pattern);
  // plot area in px² — a leaf gets a text label only when its share of the area can hold one
  const box = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState(680 * 460);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setArea(Math.max(1, e.contentRect.width) * 460));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tree = useMemo(() => {
    const leaves = new Map<string, Leaf>();
    for (const i of issues) {
      const s = i.signature;
      const k = `${s.agent_function}|${s.intent_expected}|${s.failure_reason}`;
      const cur = leaves.get(k);
      const lit = !brushing || matchesBrush(i, brush, vCut);
      if (cur) {
        cur.count += i.count;
        cur.issues++;
        cur.lit ||= lit;
        if (SEVERITIES.indexOf(i.severity) < SEVERITIES.indexOf(cur.sev)) cur.sev = i.severity;
      } else leaves.set(k, { fn: s.agent_function, intent: s.intent_expected, reason: s.failure_reason, count: i.count, sev: i.severity, issues: 1, lit });
    }
    const fns = new Map<string, Map<string, Leaf[]>>();
    for (const l of leaves.values()) {
      if (!fns.has(l.fn)) fns.set(l.fn, new Map());
      const m = fns.get(l.fn)!;
      if (!m.has(l.intent)) m.set(l.intent, []);
      m.get(l.intent)!.push(l);
    }
    return fns;
  }, [issues, brush, brushing, vCut]);

  const total = issues.reduce((a, i) => a + i.count, 0);
  /** px² a leaf of `n` FAILs gets (≈, ignoring gaps / headers) */
  const px = useCallback((n: number) => (total ? (n / total) * area * 0.78 : 0), [total, area]);

  const option = useCallback(
    (tk: ChartTokens) => {
      const sev = (s: IssueSeverity) => tk.read(`--sev-${s.toLowerCase()}`);
      const sheet = tk.read("--sheet");
      const data = [...tree.entries()].map(([fn, intents]) => ({
        name: fx.fn(fn),
        path: { fn },
        children: [...intents.entries()].map(([intent, ls]) => ({
          name: short(intent),
          path: { fn, intent },
          children: ls.map((l) => ({
            name: fx.reason(l.reason),
            value: l.count,
            path: { fn, intent, reason: l.reason },
            leaf: l,
            itemStyle: { color: sev(l.sev), opacity: l.lit ? (l.sev === "P3" ? 0.78 : 0.92) : 0.12 },
            // name + count when the cell can hold ~2 lines of 7 chars, count only when small, nothing when tiny
            label: { color: l.sev === "P2" || !l.lit ? tk.text : "#fff", show: px(l.count) >= 900, formatter: px(l.count) >= 3600 ? "{b}\n{n|{c}}" : "{n|{c}}" },
          })),
        })),
      }));
      return opt({
        animationDuration: reduced ? 0 : 600,
        animationDurationUpdate: reduced ? 0 : 450,
        textStyle: { fontFamily: tk.font },
        tooltip: tooltip(tk, {
          trigger: "item",
          formatter: (p: { data?: { path?: { fn: string; intent?: string; reason?: string }; leaf?: Leaf }; value?: number; treePathInfo?: unknown[] }) => {
            const d = p.data;
            if (!d?.path) return "";
            const share = total ? (((p.value as number) ?? 0) / total) * 100 : 0;
            const head = [fx.fn(d.path.fn), d.path.intent, d.path.reason ? fx.reason(d.path.reason) : null].filter(Boolean).map((x) => esc(String(x))).join(" › ");
            const l = d.leaf;
            return `<div style="max-width:300px;white-space:normal"><b>${head}</b><br/><span style="font-family:${tk.mono};font-size:11px">FAIL ${p.value} · ${share.toFixed(1)}%${l ? ` · ${esc(t("tree.issues", { n: l.issues }))} · <b style="color:${sev(l.sev)}">■</b> ${l.sev}` : ""}</span><br/><span style="font-size:10.5px;opacity:.75">${esc(t("tree.hint"))}</span></div>`;
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
    [tree, fx, reduced, total, t, px],
  );

  return (
    <div className="lab-tree" ref={box}>
      <EChart
        className="lab-tree-chart"
        option={option}
        ariaLabel={t("tree.aria")}
        onEvents={{
          click: (p) => {
            const path = (p as { data?: { path?: { fn: string; intent?: string; reason?: string } } }).data?.path;
            if (!path) return;
            f.set({ agent_function: [path.fn], intent: path.intent ? [path.intent] : [], failure_reason: path.reason ? [path.reason] : [] });
          },
        }}
      />
      <div className="lab-legend-row" aria-hidden>
        {SEVERITIES.map((s) => (
          <span key={s}>
            <span className="iss-sev" data-sev={s}>
              {s}
            </span>{" "}
            {fx.severityHelp(s).split(" — ")[0]}
          </span>
        ))}
        <span className="muted mono">{t("tree.area")}</span>
      </div>
    </div>
  );
}
