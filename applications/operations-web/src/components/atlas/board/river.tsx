"use client";
/**
 * Time river — a Gantt above the board spanning the global time range.
 *   span ≤ 26h → one bar per Workflow (queue · run · Retry backoff), packed into rows per lane
 *                 (capped at MAX_ROWS rows per lane; the rest is counted as "+n hidden").
 *   span > 26h → per-lane aggregate from /capacity/history (1h / 6h buckets): active Slots as bars,
 *                 queued as a hatched cap on top, the configured limit as a dashed line.
 */
import { Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { languageName, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { LANG_CODES } from "@/lib/catalog";
import { api, useApi } from "@/lib/client";
import type { RangeSpec } from "@/lib/time-range";
import type { CapacityHistory, LangCode, WorkflowSummary } from "@/lib/types";
import { shortPipe } from "./model";

const DETAIL_MAX = 26 * 3600_000;
const MAX_ROWS = 9;
const LW = 104;
const R = 18;
const AX = 22;

interface Seg {
  a: number;
  b: number;
  k: "queued" | "running" | "success" | "failed" | "retry" | "cancelled";
  t: string;
}

function useHostWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1100);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function ticksFor(from: number, to: number, f: ReturnType<typeof useFmt>) {
  const span = to - from;
  const H = 3600_000;
  const steps = [
    5 * 60_000,
    15 * 60_000,
    30 * 60_000,
    H,
    2 * H,
    3 * H,
    6 * H,
    12 * H,
    24 * H,
    2 * 24 * H,
    5 * 24 * H,
  ];
  const step = steps.find((s) => span / s <= 9) ?? 7 * 24 * H;
  const KST = 9 * H;
  const out: { t: number; l: string }[] = [];
  const start = Math.ceil((from + KST) / step) * step - KST;
  for (let t = start; t <= to; t += step)
    out.push({
      t,
      l:
        step >= 24 * H
          ? f.date(t).slice(5)
          : step >= 6 * H && f.hm(t) === "00:00"
            ? f.date(t).slice(5)
            : f.hm(t),
    });
  return out;
}

export function River({
  summaries,
  from,
  to,
  now,
  spec,
  rangeLabel,
  pipeline,
  matchIds,
  wfHref,
}: {
  summaries: WorkflowSummary[];
  from: number;
  to: number;
  now: number;
  spec: RangeSpec;
  rangeLabel: string;
  pipeline: string | null;
  matchIds: Set<string> | null;
  wfHref: (id: string) => string;
}) {
  const t = useT("board");
  const detail = to - from <= DETAIL_MAX;
  return (
    <section className="plate bd-river">
      <header>
        <h2>
          <Activity aria-hidden /> {t("river.title")}
          <span className="bd-river-sub">{detail ? t("river.sub") : null}</span>
        </h2>
        <span className="ref">{rangeLabel}</span>
      </header>
      <div className="body">
        {detail ? (
          <Spans
            summaries={summaries}
            from={from}
            to={to}
            now={now}
            rangeLabel={rangeLabel}
            pipeline={pipeline}
            matchIds={matchIds}
            wfHref={wfHref}
          />
        ) : (
          <Aggregate spec={spec} from={from} to={to} rangeLabel={rangeLabel} />
        )}
      </div>
    </section>
  );
}

function Spans({
  summaries,
  from,
  to,
  now,
  rangeLabel,
  pipeline,
  matchIds,
  wfHref,
}: {
  summaries: WorkflowSummary[];
  from: number;
  to: number;
  now: number;
  rangeLabel: string;
  pipeline: string | null;
  matchIds: Set<string> | null;
  wfHref: (id: string) => string;
}) {
  const t = useT("board");
  const f = useFmt();
  const locale = useLocale();
  const router = useRouter();
  const [hostRef, hostW] = useHostWidth();
  const W = Math.max(720, hostW);
  const end = Math.min(to, now);
  const span = Math.max(60_000, end - from);
  const x = (ts: number) =>
    LW + ((Math.max(from, Math.min(end, ts)) - from) / span) * (W - LW - R);
  const live = to >= now - 90_000;
  const RH = 5;
  const GAP = 2;
  const PAD = 7;

  const lanes = useMemo(
    () =>
      LANG_CODES.map((code) => {
        const items: {
          w: WorkflowSummary;
          start: number;
          end: number;
          segs: Seg[];
          row: number;
        }[] = [];
        summaries.forEach((w) => {
          if (w.language !== code) return;
          if (pipeline && w.pipeline_id !== pipeline) return;
          const start = w.queued_at ?? w.created_at;
          const stop = w.completed_at ?? end;
          if (stop < from || start > end) return;
          const segs: Seg[] = [];
          const runStart = w.started_at;
          if (w.queued_at) {
            const qEnd =
              runStart ??
              (["QUEUED", "RESERVED", "RECEIVED", "VALIDATED"].includes(
                w.status,
              )
                ? end
                : w.queued_at + (w.waitMs ?? 0));
            segs.push({
              a: w.queued_at,
              b: qEnd,
              k: "queued",
              t: t("river.queue"),
            });
          }
          if (runStart) {
            if (w.status === "RETRY_WAIT") {
              segs.push({
                a: runStart,
                b: w.updated_at,
                k: "failed",
                t: `${t("river.attempts", { n: w.attempt })}${w.lastErrorCode ? " · " + w.lastErrorCode : ""}`,
              });
              segs.push({
                a: w.updated_at,
                b: w.retry_at ? Math.min(end, w.retry_at) : end,
                k: "retry",
                t: t("river.backoff", {
                  at: w.retry_at ? f.hm(w.retry_at) : "",
                }),
              });
            } else {
              const k: Seg["k"] =
                w.status === "SUCCEEDED"
                  ? "success"
                  : w.status === "DEAD_LETTERED" || w.status === "TIMED_OUT"
                    ? "failed"
                    : w.status === "CANCELLED"
                      ? "cancelled"
                      : "running";
              segs.push({
                a: runStart,
                b: w.completed_at ?? end,
                k,
                t: `${t("river.run")} · Attempt ×${Math.max(1, w.attemptsCount)} · ${statusLabel("workflow", w.status, locale)}${w.lastErrorCode ? " · " + w.lastErrorCode : ""}`,
              });
            }
          }
          items.push({ w, start, end: stop, segs, row: 0 });
        });
        items.sort((a, b) => a.start - b.start);
        const rowsEnd: number[] = [];
        let hidden = 0;
        const gapMs = span / 400;
        const shown = items.filter((it) => {
          let r = rowsEnd.findIndex((e) => e < it.start - gapMs);
          if (r < 0) {
            if (rowsEnd.length >= MAX_ROWS) {
              hidden++;
              return false;
            }
            r = rowsEnd.length;
            rowsEnd.push(0);
          }
          rowsEnd[r] = it.end;
          it.row = r;
          return true;
        });
        return {
          code,
          items: shown,
          total: items.length,
          hidden,
          rows: Math.max(1, rowsEnd.length),
        };
      }),
    [summaries, pipeline, from, end, span, t, f, locale],
  );

  let y = AX;
  const laneEls = lanes.map((ln) => {
    const h = Math.max(36, ln.rows * (RH + GAP) + PAD * 2 - GAP);
    const g = (
      <g
        key={ln.code}
        transform={`translate(0,${y})`}
        className={`lg-${ln.code}`}
      >
        <rect x={0} y={4} width={2.5} height={h - 8} fill="var(--lc)" />
        <text
          className="bd-rv-lane"
          x={10}
          y={h / 2 - 2}
          dominantBaseline="middle"
        >
          {languageName(ln.code, locale)}
        </text>
        <text
          className="bd-rv-ax"
          x={10}
          y={h / 2 + 11}
          dominantBaseline="middle"
        >
          {t("river.wf", { count: ln.total })}
          {ln.hidden ? ` · ${t("river.hidden", { count: ln.hidden })}` : ""}
        </text>
        {ln.items.map((it) => {
          const yy = PAD + it.row * (RH + GAP);
          const dim = matchIds && !matchIds.has(it.w.workflow_id);
          return (
            <g
              key={it.w.workflow_id}
              className={
                dim
                  ? "bd-rv-span dim"
                  : matchIds
                    ? "bd-rv-span hit"
                    : "bd-rv-span"
              }
              onClick={() => router.push(wfHref(it.w.workflow_id))}
            >
              {it.segs.map((s, i) => {
                if (s.b < from) return null;
                const x1 = x(s.a);
                const x2 = Math.max(x1 + 1.5, x(s.b));
                return (
                  <rect
                    key={i}
                    x={x1.toFixed(1)}
                    y={yy}
                    width={(x2 - x1).toFixed(1)}
                    height={RH}
                    fill={`var(--st-${s.k})`}
                    opacity={s.k === "queued" ? 0.42 : 1}
                    fillOpacity={s.k === "retry" ? 0.3 : undefined}
                    stroke={s.k === "retry" ? "var(--st-retry)" : undefined}
                    strokeDasharray={s.k === "retry" ? "2 1" : undefined}
                  >
                    <title>{`${it.w.workflow_id} · ${shortPipe(it.w.pipeline_id)}\n${statusLabel("workflow", it.w.status, locale)} · attempt ${it.w.attempt}\n${s.t} · ${f.hm(s.a)}–${s.b >= now - 1 ? t("river.inProgress") : f.hm(s.b)} (${f.duration(s.b - s.a, { style: "short" })})`}</title>
                  </rect>
                );
              })}
              {it.w.status === "DEAD_LETTERED" &&
              it.w.completed_at &&
              it.w.completed_at >= from ? (
                <path
                  d={`M${x(it.w.completed_at)},${yy - 1.5} l3.5,3.5 l-3.5,3.5 l-3.5,-3.5z`}
                  fill="var(--st-dlq)"
                />
              ) : null}
            </g>
          );
        })}
        <line className="bd-rv-grid" x1={0} x2={W} y1={h} y2={h} />
      </g>
    );
    y += h;
    return g;
  });
  const H = y + 4;
  const ticks = ticksFor(from, end, f);
  const nowX = x(now);
  const nowEnd = nowX > W - 90;
  const anyItems = lanes.some((l) => l.total > 0);
  return (
    <div className="bd-scroll-x" ref={hostRef}>
      {anyItems ? (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("river.aria", { range: rangeLabel })}
          className="bd-rv"
        >
          {ticks.map(({ t: ts, l }) => (
            <g key={ts}>
              <line
                className="bd-rv-grid"
                x1={x(ts)}
                x2={x(ts)}
                y1={AX - 4}
                y2={H}
                strokeDasharray="2 3"
              />
              {!(live && Math.abs(x(ts) - nowX) < 70) ? (
                <text className="bd-rv-ax" x={x(ts)} y={12} textAnchor="middle">
                  {l}
                </text>
              ) : null}
            </g>
          ))}
          {laneEls}
          {live ? (
            <>
              <line
                className="bd-rv-now"
                x1={nowX}
                x2={nowX}
                y1={AX - 6}
                y2={H}
              />
              <text
                className="bd-rv-nowl"
                x={nowX + (nowEnd ? -4 : 4)}
                y={12}
                textAnchor={nowEnd ? "end" : "start"}
              >
                {t("river.now")} {f.hm(now)}
              </text>
            </>
          ) : null}
        </svg>
      ) : (
        <div className="empty">
          <b>{t("river.empty")}</b>
        </div>
      )}
      <RiverLegend />
    </div>
  );
}

function RiverLegend() {
  const t = useT("board");
  return (
    <div className="bd-rv-legend" aria-hidden>
      <span>
        <i className="q" /> {t("river.legendQueue")}
      </span>
      <span>
        <i className="r" /> {t("river.legendRun")}
      </span>
      <span>
        <i className="b" /> {t("river.legendBackoff")}
      </span>
      <span>
        <i className="d" /> {t("river.legendDlq")}
      </span>
    </div>
  );
}

function Aggregate({
  spec,
  from,
  to,
  rangeLabel,
}: {
  spec: RangeSpec;
  from: number;
  to: number;
  rangeLabel: string;
}) {
  const t = useT("board");
  const f = useFmt();
  const locale = useLocale();
  const [hostRef, hostW] = useHostWidth();
  void spec;
  const q = useApi(
    ["board-cap-history", from, to],
    () =>
      api.capacityHistory({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        granularity: "auto",
      }),
    {
      revalidateOn: ["tick"],
      throttleMs: 20000,
      revalidateOnFocus: false,
    },
  );
  const d: CapacityHistory | undefined = q.data;
  const W = Math.max(720, hostW);
  if (!d)
    return (
      <div className="bd-scroll-x" ref={hostRef}>
        <div className="skel" style={{ height: 220, margin: 14 }} />
      </div>
    );
  const n = d.ts.length;
  const bw = (W - LW - R) / Math.max(1, n);
  const x = (i: number) => LW + i * bw;
  const LH = 52;
  const gran =
    d.granularity === "6h" ? "6h" : d.granularity === "1h" ? "1h" : "5m";
  let y = AX;
  const lanes = LANG_CODES.map((code: LangCode) => {
    const act = d.active[code] ?? [];
    const que = d.queue[code] ?? [];
    const lim = d.limit[code] ?? 1;
    const peak = Math.max(lim, ...act.map((a, i) => a + (que[i] ?? 0)));
    const sy = (v: number) => LH - 6 - (v / peak) * (LH - 12);
    const g = (
      <g key={code} transform={`translate(0,${y})`} className={`lg-${code}`}>
        <rect x={0} y={4} width={2.5} height={LH - 8} fill="var(--lc)" />
        <text
          className="bd-rv-lane"
          x={10}
          y={LH / 2 - 4}
          dominantBaseline="middle"
        >
          {languageName(code, locale)}
        </text>
        <text
          className="bd-rv-ax"
          x={10}
          y={LH / 2 + 9}
          dominantBaseline="middle"
        >
          {t("river.peak", { n: Math.max(0, ...act) })} / {lim}
        </text>
        {act.map((a, i) => {
          const qv = que[i] ?? 0;
          const top = sy(a);
          const qtop = sy(a + qv);
          return (
            <g key={i}>
              <rect
                x={x(i) + 0.5}
                y={top}
                width={Math.max(0.8, bw - 1)}
                height={LH - 6 - top}
                fill="var(--lc)"
                opacity={0.85}
              />
              {qv > 0 ? (
                <rect
                  x={x(i) + 0.5}
                  y={qtop}
                  width={Math.max(0.8, bw - 1)}
                  height={top - qtop}
                  className="bd-rv-q"
                />
              ) : null}
              <title>{`${languageName(code, locale)} · ${f.dateTimeLabel(d.ts[i])}\n${t("river.active")} ${a} · ${t("river.queued")} ${qv} · ${t("river.limit")} ${lim}`}</title>
            </g>
          );
        })}
        <line
          className="bd-rv-lim"
          x1={LW}
          x2={W - R}
          y1={sy(lim)}
          y2={sy(lim)}
        />
        <line className="bd-rv-grid" x1={0} x2={W} y1={LH} y2={LH} />
      </g>
    );
    y += LH;
    return g;
  });
  const H = y + 4;
  const ticks = ticksFor(from, to, f);
  const xt = (ts: number) =>
    LW +
    ((ts - d.ts[0]) /
      Math.max(1, (d.ts[n - 1] ?? to) - d.ts[0] + (d.ts[1] - d.ts[0] || 0))) *
      (W - LW - R);
  return (
    <div className="bd-scroll-x" ref={hostRef}>
      <div className="bd-rv-aggnote">{t("river.subAgg", { gran })}</div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("river.ariaAgg", { range: rangeLabel })}
        className="bd-rv"
      >
        {ticks.map(({ t: ts, l }) => (
          <g key={ts}>
            <line
              className="bd-rv-grid"
              x1={xt(ts)}
              x2={xt(ts)}
              y1={AX - 4}
              y2={H}
              strokeDasharray="2 3"
            />
            <text className="bd-rv-ax" x={xt(ts)} y={12} textAnchor="middle">
              {l}
            </text>
          </g>
        ))}
        {lanes}
      </svg>
    </div>
  );
}
