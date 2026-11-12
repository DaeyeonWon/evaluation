"use client";
/**
 * State-flow rail across the top of the board: one node per column (measured from the column
 * headers), the main path, the SUCCESS / FAILURE / DLQ / Manual Replay arcs as blueprint
 * annotations, and a token that runs along the matching edge for every SSE transition.
 */
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useT } from "@/i18n/client";
import { useStreamEvent } from "@/lib/client";
import type { TransitionMessage, WorkflowStatus } from "@/lib/types";
import { useReducedMotionSafe } from "../ui";
import { COLS, COL_OF, toneOf } from "./model";

interface Geo {
  X: number[];
  Y: number;
}

const bz = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a +
  3 * (1 - t) ** 2 * t * b +
  3 * (1 - t) * t * t * c +
  t ** 3 * d;
function yOnCurve(x0: number, x1: number, ya: number, yb: number, tx: number) {
  let best = { d: 1e9, y: ya };
  for (let t = 0; t <= 1; t += 0.02) {
    const x = bz(x0, x0, x1, x1, t);
    const y = bz(ya, yb, yb, ya, t);
    if (Math.abs(x - tx) < best.d) best = { d: Math.abs(x - tx), y };
  }
  return best.y;
}
function railPaths({ X, Y }: Geo) {
  const arc = (a: number, b: number, h: number) =>
    `M${X[a]},${Y} C${X[a]},${Y - h} ${X[b]},${Y - h} ${X[b]},${Y}`;
  const main = [0, 1, 2, 3, 4].map(
    (i) => `M${X[i] + 8},${Y} L${X[i + 1] - 8},${Y}`,
  );
  const succLx = (X[3] + X[5]) / 2;
  const todLx = X[5] + (X[6] - X[5]) * 0.5;
  const repLx = X[2] + (X[3] - X[2]) * 0.55;
  return {
    main,
    succ: {
      d: arc(3, 5, 46),
      lx: succLx,
      ly: yOnCurve(X[3], X[5], Y, Y - 46, succLx) - 5,
    },
    loop: `M${X[4] - 6},${Y + 4} C${X[4] - 6},${Y + 16} ${X[3] + 6},${Y + 16} ${X[3] + 6},${Y + 4}`,
    tod: {
      d: arc(4, 6, 24),
      lx: todLx,
      ly: yOnCurve(X[4], X[6], Y, Y - 24, todLx) - 6,
    },
    rep: {
      d: `M${X[6]},${Y - 3} C${X[6]},${-10} ${X[1]},${-10} ${X[1]},${Y - 3}`,
      lx: repLx,
      ly: yOnCurve(X[6], X[1], Y - 3, -10, repLx) + 12,
    },
  };
}
function pathFor(
  { X, Y }: Geo,
  from: WorkflowStatus,
  to: WorkflowStatus,
): string | null {
  const a = COL_OF[from];
  const b = COL_OF[to];
  if (a == null || b == null || a === b) return null;
  const arc = (p: number, q: number, h: number) =>
    `M${X[p]},${Y} C${X[p]},${Y - h} ${X[q]},${Y - h} ${X[q]},${Y}`;
  if (a === 3 && b === 5) return arc(3, 5, 46);
  if (a === 4 && b === 3)
    return `M${X[4] - 6},${Y + 4} C${X[4] - 6},${Y + 16} ${X[3] + 6},${Y + 16} ${X[3] + 6},${Y + 4}`;
  if (b === 6 && a === 4) return arc(4, 6, 24);
  if (b === 6 && a === 3)
    return `M${X[3]},${Y} L${X[4]},${Y} C${X[4]},${Y - 24} ${X[6]},${Y - 24} ${X[6]},${Y}`;
  if (b === 6)
    return `M${X[a]},${Y} C${X[a]},${Y - 30} ${X[6]},${Y - 30} ${X[6]},${Y}`;
  if (a === 6 && b === 1)
    return `M${X[6]},${Y - 3} C${X[6]},${-10} ${X[1]},${-10} ${X[1]},${Y - 3}`;
  if (b > a) return `M${X[a]},${Y} L${X[b]},${Y}`;
  return null;
}

export function FlowRail({
  boardRef,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT("board");
  const [geo, setGeo] = useState<Geo | null>(null);
  const geoRef = useRef<Geo | null>(null);
  const tokRef = useRef<SVGGElement>(null);
  const live = useRef(0);
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const br = board.getBoundingClientRect();
      const xs = [
        ...board.querySelectorAll<HTMLElement>(".bd-colh[data-col]"),
      ].map((h) => {
        const r = h.getBoundingClientRect();
        return r.left - br.left + r.width / 2;
      });
      if (xs.length < COLS.length) return;
      const g = { X: xs, Y: 58 };
      geoRef.current = g;
      setGeo(g);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    return () => ro.disconnect();
  }, [boardRef]);

  const paths = useMemo(() => (geo ? railPaths(geo) : null), [geo]);

  useStreamEvent("transition", (m: TransitionMessage) => {
    if (reduced || !m.from) return;
    const g = geoRef.current;
    const host = tokRef.current;
    if (!g || !host || live.current > 28 || document.hidden) return;
    const d = pathFor(g, m.from, m.to);
    if (!d) return;
    const ns = "http://www.w3.org/2000/svg";
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    const color = `var(--st-${toneOf(m.to)})`;
    const halo = document.createElementNS(ns, "circle");
    halo.setAttribute("r", "8");
    halo.setAttribute("fill", "none");
    halo.setAttribute("stroke", color);
    halo.setAttribute("stroke-width", "1");
    halo.setAttribute("stroke-dasharray", "2 2");
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("r", "3.6");
    c.setAttribute("fill", color);
    c.setAttribute("stroke", "var(--sheet)");
    c.setAttribute("stroke-width", "1.2");
    host.append(p, halo, c);
    live.current++;
    const len = p.getTotalLength();
    const t0 = performance.now();
    const D = 900 + Math.min(900, len * 1.4) + Math.random() * 200;
    const step = (nowT: number) => {
      const k = Math.min(1, (nowT - t0) / D);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = p.getPointAtLength(e * len);
      c.setAttribute("cx", String(pt.x));
      c.setAttribute("cy", String(pt.y));
      halo.setAttribute("cx", String(pt.x));
      halo.setAttribute("cy", String(pt.y));
      if (k < 1) requestAnimationFrame(step);
      else {
        p.remove();
        c.remove();
        halo.remove();
        live.current--;
      }
    };
    requestAnimationFrame(step);
  });

  return (
    <div className="bd-rail" aria-hidden>
      <span className="bd-rail-lbl">{t("rail.label")}</span>
      <svg>
        {geo && paths ? (
          <>
            {paths.main.map((d, i) => (
              <g key={i}>
                <path className={clsx("bd-e", i === 3 && "rt")} d={d} />
                <path
                  d={`M${geo.X[i + 1] - 13},${geo.Y - 3.5} L${geo.X[i + 1] - 8},${geo.Y} L${geo.X[i + 1] - 13},${geo.Y + 3.5}`}
                  className="bd-e-arrow"
                />
              </g>
            ))}
            <path className="bd-e ok" d={paths.succ.d} />
            <path className="bd-e rt" d={paths.loop} />
            <path className="bd-e dl" d={paths.tod.d} />
            <path className="bd-e rp" d={paths.rep.d} />
            <text
              className="bd-e-lbl ok"
              x={paths.succ.lx}
              y={paths.succ.ly}
              textAnchor="middle"
            >
              {t("rail.success")}
            </text>
            <text
              className="bd-e-lbl dl"
              x={paths.tod.lx}
              y={paths.tod.ly}
              textAnchor="middle"
            >
              {t("rail.toDlq")}
            </text>
            <text
              className="bd-e-lbl rp"
              x={paths.rep.lx}
              y={paths.rep.ly}
              textAnchor="middle"
            >
              {t("rail.replay")}
            </text>
            <text
              className="bd-e-lbl fl"
              x={(geo.X[3] + geo.X[4]) / 2}
              y={geo.Y - 6}
              textAnchor="middle"
            >
              {t("rail.failure")}
            </text>
            <text
              className="bd-e-lbl rt"
              x={(geo.X[3] + geo.X[4]) / 2}
              y={geo.Y + 24}
              textAnchor="middle"
            >
              {t("rail.retryCond")}
            </text>
            {COLS.map((c, i) => (
              <g key={c.id} className={`tone-${c.tone}`}>
                <rect
                  x={geo.X[i] - 4.5}
                  y={geo.Y - 4.5}
                  width={9}
                  height={9}
                  className="bd-rn"
                  transform={`rotate(45 ${geo.X[i]} ${geo.Y})`}
                />
                <text
                  className="bd-rn-lbl"
                  x={geo.X[i]}
                  y={geo.Y + 22}
                  textAnchor="middle"
                >
                  {t(`cols.${c.id}.t`)}
                </text>
                <text
                  className="bd-e-lbl st"
                  x={geo.X[i]}
                  y={geo.Y + 33}
                  textAnchor="middle"
                >
                  {c.states.slice(0, 2).join("·")}
                  {c.states.length > 2 ? "…" : ""}
                </text>
              </g>
            ))}
          </>
        ) : null}
        <g ref={tokRef} />
      </svg>
    </div>
  );
}
