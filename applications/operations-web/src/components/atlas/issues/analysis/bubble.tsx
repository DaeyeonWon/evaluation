"use client";
/**
 * Signal Lab — issue-cluster bubble chart. x = FAIL volume (log), y = trend z-score vs baseline,
 * size = market reach, colour = severity (legend + badge in the tooltip). Quadrant overlay:
 * act now (high volume · spiking) / emerging (low volume · spiking) / watch / noise.
 * Click a bubble → open the issue; click a quadrant chip → lab brush `quad`.
 */
import clsx from "clsx";
import { useCallback, useMemo } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { useT } from "@/i18n/client";
import type { Issue, IssueSeverity } from "@/lib/types";
import { opt, tooltip } from "../../chart";
import { useIssueFormat } from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";
import { QUADRANTS, SEVERITIES, Z_CUT, matchesBrush, quadrantOf, reachValue, trendZ, type LabBrush, type Quadrant } from "./lab";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function Bubble({
  issues,
  vCut,
  brush,
  setQuad,
  selected,
  onSelect,
}: {
  issues: Issue[];
  vCut: number;
  brush: LabBrush;
  setQuad: (q: Quadrant | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT("issuesAnalysis");
  const fx = useIssueFormat();
  const reduced = useReducedMotionSafe();
  const counts = useMemo(() => {
    const c: Record<Quadrant, number> = { act: 0, watch: 0, emerging: 0, noise: 0 };
    for (const i of issues) c[quadrantOf(i, vCut)]++;
    return c;
  }, [issues, vCut]);
  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  const topIds = useMemo(() => new Set([...issues].sort((a, b) => b.score - a.score).slice(0, 4).map((i) => i.id)), [issues]);
  const maxX = Math.max(vCut * 2, ...issues.map((i) => i.count)) * 1.35;
  const zs = issues.map(trendZ);
  const zCap = 12;
  const maxY = Math.min(zCap, Math.max(Z_CUT * 2.2, ...zs)) * 1.1;
  const minY = Math.min(-1, ...zs) - 0.6;
  const brushing = !!(brush.quad || brush.pattern);

  const option = useCallback(
    (tk: ChartTokens) => {
      const sev = (s: IssueSeverity) => tk.read(`--sev-${s.toLowerCase()}`);
      const ink = tk.read("--ink");
      const sheet = tk.read("--sheet");
      const axis = {
        axisLine: { lineStyle: { color: tk.read("--rule") } },
        axisTick: { show: false },
        axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono },
        nameTextStyle: { color: tk.muted, fontSize: 10.5, fontFamily: tk.font },
      };
      const top = Math.ceil(maxY);
      const bottom = Math.floor(minY);
      const right = Math.ceil(maxX);
      // a label band above the data so the quadrant names never sit under the pinned ▲ markers
      const yMax = top + Math.max(1, (top - bottom) * 0.09);
      const xFrac = (n: number) => Math.log(Math.max(1, n)) / Math.log(Math.max(2, right));
      return opt({
        animationDuration: reduced ? 0 : 700,
        animationDurationUpdate: reduced ? 0 : 450,
        textStyle: { fontFamily: tk.font, color: tk.muted },
        grid: { left: 40, right: 16, top: 30, bottom: 40 },
        legend: { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, data: SEVERITIES, textStyle: { color: tk.muted, fontSize: 11, fontFamily: tk.mono } },
        xAxis: { type: "log", min: 1, max: right, name: t("bubble.x"), nameLocation: "middle", nameGap: 26, splitLine: { show: false }, ...axis, axisLabel: { ...axis.axisLabel, showMaxLabel: false } },
        yAxis: { type: "value", min: bottom, max: yMax, name: t("bubble.y"), nameGap: 10, splitLine: { lineStyle: { color: tk.grid } }, ...axis, axisLabel: { ...axis.axisLabel, showMaxLabel: false } },
        tooltip: tooltip(tk, {
          trigger: "item",
          formatter: (p: { data?: { id?: string } }) => {
            const i = p.data?.id ? byId.get(p.data.id) : null;
            if (!i) return "";
            const q = quadrantOf(i, vCut);
            return `<div style="max-width:280px;white-space:normal"><b style="color:${sev(i.severity)}">\u25A0</b> <b>${i.severity}</b> · ${esc(fx.cls(i.severity_class))} · ${esc(t(`quad.${q}`))}<br/><b>${esc(fx.text(i.title))}</b><br/><span style="font-family:${tk.mono};font-size:11px">FAIL ${i.count} · z ${trendZ(i).toFixed(1)} · ${esc(t("bubble.reach"))} ${i.markets.length}/${i.devices.length}/${i.languages.length} · ${esc(t("bubble.score"))} ${Math.round(i.score)}</span></div>`;
          },
        }),
        series: SEVERITIES.map((sv, si) => ({
          type: "scatter",
          name: sv,
          color: sev(sv),
          z: 10 - si,
          label: { color: tk.text, fontFamily: tk.mono },
          emphasis: { focus: "self", scale: 1.15 },
          labelLayout: { hideOverlap: true },
          data: issues
            .filter((i) => i.severity === sv)
            .map((i) => {
              const on = !brushing || matchesBrush(i, brush, vCut);
              const isSel = i.id === selected;
              const z = trendZ(i);
              const capped = z > zCap;
              return {
                value: [Math.max(1, i.count), capped ? top - 0.6 : z, reachValue(i)],
                symbol: capped ? "triangle" : "circle",
                id: i.id,
                symbolSize: 7 + reachValue(i) * 30,
                itemStyle: { opacity: on ? (sv === "P3" ? 0.4 : 0.86) : 0.07, borderWidth: isSel ? 3 : 1.5, borderColor: isSel ? ink : sheet },
                label:
                  topIds.has(i.id) && on
                    ? {
                        show: true,
                        formatter: i.signature.intent_expected.split(".").pop() + (capped ? ` · z ${Math.round(z)}↑` : ""),
                        // right-half marks label to the left so the text never runs off the plot
                        position: capped ? "bottom" : xFrac(i.count) > 0.55 ? "left" : "right",
                        distance: 6,
                        fontSize: 10.5,
                        backgroundColor: sheet,
                        padding: [1, 3],
                        borderRadius: 2,
                      }
                    : { show: false },
              };
            }),
          ...(si === 0
            ? {
                markLine: { silent: true, symbol: "none", lineStyle: { type: "dashed", width: 1, color: tk.read("--ink-3") }, label: { show: false }, data: [{ xAxis: vCut }, { yAxis: Z_CUT }] },
                markArea: {
                  silent: true,
                  label: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, position: "insideTopLeft", fontWeight: 600 },
                  data: [
                    [{ xAxis: vCut, yAxis: Z_CUT, name: t("quad.act").toUpperCase(), itemStyle: { color: tk.read("--sev-p0"), opacity: 0.08 } }, { xAxis: right, yAxis: yMax }],
                    [{ xAxis: 1, yAxis: Z_CUT, name: t("quad.emerging").toUpperCase(), itemStyle: { color: tk.read("--iss-new"), opacity: 0.06 } }, { xAxis: vCut, yAxis: yMax }],
                    [{ xAxis: vCut, yAxis: bottom, name: t("quad.watch").toUpperCase(), itemStyle: { color: tk.read("--ink-3"), opacity: 0.05 }, label: { position: "insideBottomLeft" } }, { xAxis: right, yAxis: Z_CUT }],
                    [{ xAxis: 1, yAxis: bottom, name: t("quad.noise").toUpperCase(), itemStyle: { color: tk.read("--ink-3"), opacity: 0 }, label: { position: "insideBottomLeft" } }, { xAxis: vCut, yAxis: Z_CUT }],
                  ],
                },
              }
            : {}),
        })),
      });
    },
    [issues, brush, brushing, vCut, selected, topIds, maxX, maxY, minY, reduced, t, fx, byId],
  );

  return (
    <div className="lab-bub">
      <div className="lab-quads" role="group" aria-label={t("quad.aria")}>
        {QUADRANTS.map((q) => (
          <button key={q} type="button" className={clsx("lab-quad", "q-" + q)} aria-pressed={brush.quad === q} onClick={() => setQuad(brush.quad === q ? null : q)} title={t(`quad.${q}Help`)}>
            <span className="lab-quad-k">{t(`quad.${q}`)}</span>
            <b className="mono">{counts[q]}</b>
          </button>
        ))}
      </div>
      <EChart
        className="lab-bub-chart"
        ariaLabel={t("bubble.aria")}
        option={option}
        onEvents={{
          click: (p) => {
            const id = (p as { data?: { id?: string } }).data?.id;
            if (id) onSelect(id);
          },
        }}
      />
      <p className="lab-cap">{t("bubble.caption", { v: vCut, z: Z_CUT })} {zs.some((z) => z > zCap) ? t("bubble.capped", { cap: zCap }) : null}</p>
    </div>
  );
}
