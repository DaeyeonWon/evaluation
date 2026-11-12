"use client";
/**
 * Blueprint node bodies (SVG). Three levels of detail driven by zoom:
 *  - lod 0 (far):   title + one oversized readout per node, so a fit-all overview stays legible
 *  - lod 1 (normal): the full instrument panel (prototype parity, larger type)
 *  - lod 2 (near):  + per-language breakdowns, token IDs (rendered by the token layer)
 */
import { memo, type ReactNode } from "react";
import { CatalogIcon, fmt } from "@/components/shared";
import { DAG_TEMPLATE, FAILURE_CATEGORY_META, LANG_CODES, STAGE_BY_ID } from "@/lib/catalog";
import type { CapacitySnapshot, ComponentId, DeadLetter, Replay, ResultFileMeta, StageId, Tone } from "@/lib/types";
import { dagLayout, LANE_H, LANE_Y0, ROW, type Layout, type NodeBox, type NodeId } from "./geometry";

export type Metrics = Partial<Record<StageId, Record<string, unknown>>>;

export interface NodeData {
  metrics: Metrics;
  capacity: CapacitySnapshot | null;
  replays: Replay[] | undefined;
  pending: DeadLetter[] | undefined;
  resultFile: ResultFileMeta | undefined;
  now: number;
  stageCounts: Partial<Record<StageId, number>> | undefined;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/* ───────────── svg atoms ───────────── */
function T({ x, y, c = "n-txt", a, children, style }: { x: number; y: number; c?: string; a?: "start" | "middle" | "end"; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <text className={c} x={x} y={y} textAnchor={a} style={style}>
      {children}
    </text>
  );
}
const textW = (t: string) => 12 + [...t].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 11 : 6.6), 0);
function Badge({ xr, y, text, tone }: { xr: number; y: number; text: string; tone?: Tone | null }) {
  const w = textW(text);
  const c = tone ? `var(--st-${tone})` : "var(--ink)";
  return (
    <g transform={`translate(${xr - w},${y})`}>
      {y < 0 ? <path d={`M${w - 8},18 L${w - 8},22`} stroke={c} /> : null}
      <rect width={w} height={18} rx={2} fill={`color-mix(in srgb, ${c} 14%, var(--sheet))`} stroke={c} strokeWidth={1} />
      <text x={w / 2} y={12.8} textAnchor="middle" style={{ font: "500 10.5px var(--f-mono)", fill: c }}>
        {text}
      </text>
    </g>
  );
}
function KV({ y, k, v, w, tone }: { y: number; k: string; v: ReactNode; w: number; tone?: Tone | null }) {
  return (
    <>
      <T x={12} y={y}>
        {k}
      </T>
      <text className="n-val" x={w - 12} y={y} textAnchor="end" style={tone ? { fill: `var(--st-${tone})` } : undefined}>
        {v}
      </text>
    </>
  );
}
const Line = ({ y, w }: { y: number; w: number }) => <path d={`M12,${y} L${w - 12},${y}`} stroke="var(--rule-2)" />;

function Header({ n, stage, badge, icon, svc }: { n: NodeBox; stage: StageId; badge?: { text: string; tone?: Tone | null } | null; icon?: string; svc?: string }) {
  const st = STAGE_BY_ID[stage];
  return (
    <>
      <CatalogIcon name={icon ?? st.icon} x={12} y={13} width={17} height={17} strokeWidth={1.8} style={{ color: "var(--ink)" }} aria-hidden />
      <T x={37} y={27} c="n-title">
        {n.title}
      </T>
      <T x={37} y={42} c="n-svc">
        {(svc ?? st.gcpService).toUpperCase()}
      </T>
      {badge ? <Badge xr={n.w} y={-22} text={badge.text} tone={badge.tone} /> : null}
    </>
  );
}

/** lod-0 body: one big readout */
function Far({ n, value, label, tone }: { n: NodeBox; value: ReactNode; label: string; tone?: Tone | null }) {
  return (
    <>
      <text x={14} y={Math.min(n.h - 30, 104)} className="n-big" style={{ fontSize: 46, fill: tone ? `var(--st-${tone})` : "var(--ink)" }}>
        {value}
      </text>
      <T x={14} y={Math.min(n.h - 10, 130)} style={{ fontSize: 17, fontWeight: 600 }}>
        {label}
      </T>
    </>
  );
}

/* ───────────── per-node bodies ───────────── */
function body(id: NodeId, n: NodeBox, d: NodeData, lod: number, expanded: boolean, toggle: () => void): ReactNode {
  const m = (s: StageId) => d.metrics[s] ?? {};
  const W = n.w;
  switch (id) {
    case "gcs_input": {
      const x = m("gcs_input");
      const by = (x.byLanguage ?? {}) as Record<string, number>;
      if (lod === 0) return <><Header n={n} stage="gcs_input" /><Far n={n} value={fmt.number(num(x.objectsToday))} label="오늘 업로드 객체" /></>;
      return (
        <>
          <Header n={n} stage="gcs_input" badge={{ text: "+" + num(x.objectsToday) }} />
          {(
            [
              ["GCS", "Object Finalized", "upload-cloud"],
              ["API", "POST /events", "send"],
              ["Scheduler", "cron", "clock"],
            ] as const
          ).map((p, i) => (
            <g key={p[0]} transform={`translate(12,${54 + i * 25})`}>
              <rect width={W - 24} height={21} fill="var(--sheet-2)" stroke="var(--rule-2)" />
              <CatalogIcon name={p[2]} x={5} y={3.5} width={14} height={14} style={{ color: "var(--ink-2)" }} aria-hidden />
              <text className="n-txt" x={24} y={15} style={{ fontWeight: 700, fill: "var(--ink)", fontSize: 12.5 }}>
                {p[0]}
              </text>
              <text className="n-mono" x={W - 30} y={15} textAnchor="end" style={{ fontSize: 11 }}>
                {p[1]}
              </text>
            </g>
          ))}
          <Line y={136} w={W} />
          <KV y={156} k="오늘 업로드" v={`${fmt.number(num(x.objectsToday))} obj`} w={W} />
          <KV y={156 + ROW} k="실발화" v={fmt.number(num(x.utterancesToday))} w={W} />
          <KV y={156 + ROW * 2} k="최근 업로드" v={x.lastUploadAt ? fmt.relative(num(x.lastUploadAt), d.now) : "—"} w={W} />
          {lod === 2 ? (
            <T x={12} y={n.h + 16} c="n-lod">
              {LANG_CODES.map((c) => `${c.toUpperCase()} ${by[c] ?? 0}`).join(" · ")}
            </T>
          ) : null}
        </>
      );
    }
    case "event_bus": {
      const x = m("event_bus");
      const re = num(x.redeliveriesToday);
      if (lod === 0) return <><Header n={n} stage="event_bus" /><Far n={n} value={fmt.number(num(x.deliveredToday))} label="오늘 전달" /></>;
      return (
        <>
          <Header n={n} stage="event_bus" badge={re ? { text: "재전달 " + re, tone: "retry" } : null} />
          <T x={12} y={64} c="n-mono" style={{ fontSize: 11.5 }}>
            topic pipeline-batch-requested
          </T>
          <Line y={76} w={W} />
          <KV y={96} k="오늘 전달" v={fmt.number(num(x.deliveredToday))} w={W} />
          <KV y={96 + ROW} k="전달 p95" v={fmt.duration(num(x.p95DeliveryLatencyMs), { style: "short" })} w={W} />
          <KV y={96 + ROW * 2} k="구독 backlog" v={fmt.number(num(x.subscriptionBacklog))} w={W} />
          <KV y={96 + ROW * 3} k="DLT 메시지" v={fmt.number(num(x.deadLetterTopicMessages))} w={W} tone={num(x.deadLetterTopicMessages) ? "dlq" : null} />
        </>
      );
    }
    case "ingress": {
      const x = m("ingress");
      const k = d.stageCounts?.ingress ?? 0;
      if (lod === 0) return <><Header n={n} stage="ingress" /><Far n={n} value={k} label="수신·검증 처리 중" tone={k ? "running" : null} /></>;
      return (
        <>
          <Header n={n} stage="ingress" badge={{ text: `${k} 처리중`, tone: k ? "running" : null }} />
          {["Schema Validation", "Event Deduplication", "Idempotency Key"].map((s, i) => (
            <g key={s} transform={`translate(12,${54 + i * 19})`}>
              <CatalogIcon name="check" x={0} y={0} width={13} height={13} strokeWidth={2.4} style={{ color: "var(--st-success)" }} aria-hidden />
              <T x={19} y={11}>
                {s}
              </T>
            </g>
          ))}
          <T x={14} y={124} c="n-tag">
            RECEIVED · VALIDATED
          </T>
          <rect x={12} y={130} width={W - 24} height={32} className="slot" strokeDasharray="3 3" />
          <Line y={174} w={W} />
          <KV y={193} k="수신 / 검증" v={`${num(x.receivedToday)} / ${num(x.validatedToday)}`} w={W} />
          <KV y={193 + ROW} k="중복 무시" v={fmt.number(num(x.duplicatesIgnoredToday))} w={W} tone={num(x.duplicatesIgnoredToday) ? "queued" : null} />
          <KV y={193 + ROW * 2} k="등록 p95" v={fmt.duration(num(x.p95RegistrationLatencyMs), { style: "short" })} w={W} />
        </>
      );
    }
    case "registry_queue": {
      const x = m("registry_queue");
      const by = (x.byLanguage ?? {}) as Record<string, number>;
      const q = num(x.queued);
      if (lod === 0) return <><Header n={n} stage="registry_queue" /><Far n={n} value={q} label="언어별 대기열 QUEUED" tone={q ? "queued" : null} /></>;
      return (
        <>
          <Header n={n} stage="registry_queue" badge={{ text: `${q} QUEUED`, tone: q ? "queued" : null }} />
          <T x={12} y={60} c="n-mono" style={{ fontSize: 10.5 }}>
            event_registry · workflows/{"{id}"} · pending_jobs/{"{lang}"}
          </T>
          {LANG_CODES.map((c, i) => {
            const y = LANE_Y0 + i * LANE_H;
            const L = d.capacity?.languages.find((l) => l.code === c);
            const qn = by[c] ?? 0;
            return (
              <g key={c}>
                <rect x={12} y={y} width={W - 24} height={30} fill="var(--sheet-2)" stroke="var(--rule-2)" />
                <rect x={12} y={y} width={3} height={30} fill={`var(--lg-${c})`} />
                <text className="n-mono" x={21} y={y + 13} style={{ fontWeight: 600, fill: "var(--ink)" }}>
                  {c.toUpperCase()}
                </text>
                <text className="n-mono" x={21} y={y + 25} style={{ fontSize: 9.5 }}>
                  {qn} 대기{L?.paused ? " · 정지" : ""}
                </text>
                {L && qn >= L.backlogAlertThreshold ? <Badge xr={W - 14} y={y + 6} text={"임계 " + L.backlogAlertThreshold} tone="retry" /> : null}
              </g>
            );
          })}
          <Line y={222} w={W} />
          <KV y={241} k="최장 대기" v={x.oldestQueuedAt ? fmt.relative(num(x.oldestQueuedAt), d.now) : "대기 없음"} w={W} />
          <KV y={241 + ROW} k="대기 p95" v={fmt.duration(num(x.p95WaitSec) * 1000, { style: "short" })} w={W} tone={num(x.p95WaitSec) > 900 ? "retry" : null} />
        </>
      );
    }
    case "scheduler": {
      const x = m("scheduler");
      const cap = d.capacity;
      const g = cap?.global;
      if (lod === 0)
        return (
          <>
            <Header n={n} stage="scheduler" />
            <Far n={n} value={g ? `${g.active}/${g.max}` : "—"} label="Global Slot 사용" tone={g && g.utilization > 0.9 ? "retry" : null} />
          </>
        );
      return (
        <>
          <Header n={n} stage="scheduler" badge={g ? { text: `${g.active}/${g.max}`, tone: g.utilization > 0.9 ? "retry" : null } : null} />
          <T x={12} y={60} c="n-mono" style={{ fontSize: 10.5 }}>
            Admission · Per-language · Global · Priority
          </T>
          {(cap?.languages ?? []).map((L, i) => {
            const y = LANE_Y0 + i * LANE_H;
            const u = Math.min(1, L.active / Math.max(1, L.max));
            const tone: Tone | null = L.status === "SATURATED" || L.status === "BACKLOGGED" ? "retry" : L.status === "PAUSED" || L.status === "DISABLED" ? "cancelled" : null;
            const bw = W - 24 - 80;
            return (
              <g key={L.code}>
                <rect x={12} y={y} width={W - 24} height={30} fill="var(--sheet-2)" stroke="var(--rule-2)" />
                <circle cx={W - 12} cy={y + 15} r={4} fill={`var(--lg-${L.code})`} stroke="var(--sheet)" strokeWidth={1.5} />
                <text className="n-mono" x={18} y={y + 13} style={{ fontWeight: 600, fill: "var(--ink)" }}>
                  {L.code.toUpperCase()}
                </text>
                <text className="n-mono" x={76} y={y + 13} textAnchor="end" style={{ fontSize: 11, fontWeight: 600, fill: tone ? `var(--st-${tone})` : "var(--ink)" }}>
                  {L.active}/{L.max}
                </text>
                <rect className="port-bar" x={18} y={y + 19} width={56} height={4} />
                <rect className="port-fill" x={18} y={y + 19} width={56 * u} height={4} fill={tone ? `var(--st-${tone})` : `var(--lg-${L.code})`} />
                <rect x={80} y={y + 4} width={bw - 4} height={22} className="slot" strokeDasharray="2 3" />
                {L.status !== "OK" ? (
                  <text className="n-tag" x={80 + bw - 8} y={y + 28} textAnchor="end" style={{ fill: tone ? `var(--st-${tone})` : "var(--ink-3)", fontSize: 8 }}>
                    {L.status}
                  </text>
                ) : null}
              </g>
            );
          })}
          <Line y={222} w={W} />
          <KV y={241} k="Global Active" v={g ? `${g.active} / ${g.max} (${fmt.pct(g.utilization, 0)})` : "—"} w={W} />
          <KV y={241 + ROW} k="최근 1h 승인 · Orphan" v={`${num(x.admissionsLastHour)} · ${num(x.reservationsOrphaned)}`} w={W} tone={num(x.reservationsOrphaned) ? "failed" : null} />
        </>
      );
    }
    case "workflows": {
      const x = m("workflows");
      const disp = num(x.dispatching);
      if (lod === 0) return <><Header n={n} stage="workflows" /><Far n={n} value={fmt.number(num(x.executionsToday))} label="오늘 Execution" /></>;
      return (
        <>
          <Header n={n} stage="workflows" badge={disp ? { text: `${disp} DISPATCH`, tone: "running" } : null} />
          {["Pipeline Start", "Completion Monitor", "Error Handling", "Failure Routing"].map((s, i) => (
            <T key={s} x={12 + (i % 2) * 126} y={62 + Math.floor(i / 2) * 16} style={{ fontSize: 11 }}>
              · {s}
            </T>
          ))}
          <T x={14} y={98} c="n-tag">
            DISPATCHING
          </T>
          <rect x={12} y={102} width={W - 24} height={32} className="slot" strokeDasharray="3 3" />
          <Line y={146} w={W} />
          <KV y={165} k="오늘 실행" v={fmt.number(num(x.executionsToday))} w={W} />
          <KV y={165 + ROW} k="취소 · Timeout(7d)" v={`${num(x.cancelledToday)} · ${num(x.timedOut7d)}`} w={W} tone={num(x.timedOut7d) ? "failed" : null} />
          <KV y={165 + ROW * 2} k="시작 지연 p95" v={fmt.duration(num(x.p95StartLatencyMs), { style: "short" })} w={W} />
        </>
      );
    }
    case "vertex": {
      const x = m("vertex");
      const rbc = (x.runningByComponent ?? {}) as Record<ComponentId, number>;
      const running = num(x.running);
      const rr = num(d.metrics.retry?.retryRate);
      const toggleEl = (
        <g
          data-toggle="vertex"
          role="button"
          tabIndex={0}
          aria-label={expanded ? "DAG 접기" : "DAG 펼치기"}
          style={{ cursor: "pointer" }}
          transform={`translate(${W - 92},14)`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              toggle();
            }
          }}
        >
          <rect width={80} height={20} rx={2} fill="var(--sheet-2)" stroke="var(--rule)" />
          <text x={40} y={14} textAnchor="middle" style={{ font: "500 10.5px var(--f-mono)", fill: "var(--accent)" }}>
            {expanded ? "DAG 접기" : "DAG 펼치기"}
          </text>
        </g>
      );
      if (lod === 0)
        return (
          <>
            <Header n={n} stage="vertex" />
            <Far n={n} value={running} label="PipelineJob 실행 중" tone="running" />
          </>
        );
      const by = n.h - 18;
      return (
        <>
          <Header n={n} stage="vertex" badge={{ text: `${running} RUNNING`, tone: "running" }} />
          <Badge xr={W - textW(`${running} RUNNING`) - 6} y={-22} text={"Retry율 " + fmt.pct(rr, 1)} tone={rr > 0.12 ? "failed" : null} />
          {toggleEl}
          {expanded ? (
            <DagGroup n={n} rbc={rbc} lod={lod} />
          ) : (
            <>
              <rect x={12} y={58} width={W - 24} height={64} className="slot" strokeDasharray="3 3" />
              {DAG_TEMPLATE.map((t, i) => {
                const cx = 12 + i * ((W - 24) / 6);
                return (
                  <g key={t.id}>
                    <text className="n-mono" x={cx + 2} y={142} style={{ fontSize: 9.5 }}>
                      {t.id.replace("_eval", "").replace("_check", "")}
                    </text>
                    <text className="n-val" x={cx + 2} y={160}>
                      {rbc[t.id] ?? 0}
                    </text>
                  </g>
                );
              })}
            </>
          )}
          <Line y={by - 18} w={W} />
          <T x={12} y={by} c="n-mono">
            GPU {num(x.gpuInUse)}/{num(x.gpuQuota)} L4 · 평가 중 실발화 {fmt.number(num(x.utterancesInFlight))} · 평균 {fmt.duration(num(x.avgDurationSec) * 1000, { style: "short" })}
          </T>
        </>
      );
    }
    case "results": {
      const x = m("results");
      const pr = num(x.passRateToday);
      const s = num(x.succeededToday);
      if (lod === 0) return <><Header n={n} stage="results" /><Far n={n} value={s} label={`오늘 성공 · pass ${fmt.pct(pr, 1)}`} tone="success" /></>;
      return (
        <>
          <Header n={n} stage="results" badge={{ text: "+" + s, tone: "success" }} />
          <T x={12} y={62} c="n-tag">
            SUCCEEDED · 오늘
          </T>
          <text className="n-big" x={12} y={94} style={{ fill: "var(--st-success)" }}>
            {s}
          </text>
          <T x={W - 12} y={76} c="n-mono" a="end">
            pass rate
          </T>
          <text className="n-val" x={W - 12} y={94} textAnchor="end" style={{ fontSize: 16 }}>
            {fmt.pct(pr, 1)}
          </text>
          <rect x={12} y={104} width={W - 24} height={6} fill="var(--paper-2)" />
          <rect x={12} y={104} width={(W - 24) * pr} height={6} fill="var(--st-success)" />
          <rect x={12 + (W - 24) * pr} y={104} width={(W - 24) * (1 - pr)} height={6} fill="var(--st-failed)" opacity={0.75} />
          <Line y={124} w={W} />
          <KV y={143} k="기록 행" v={fmt.number(num(x.rowsWrittenToday))} w={W} />
          <KV y={143 + ROW} k="CSV 용량" v={fmt.bytes(num(x.csvBytesToday))} w={W} />
          <T x={12} y={186} c="n-mono" style={{ fill: "var(--st-success)", fontSize: 10.5 }}>
            → Completion Event · WORKFLOW_COMPLETED
          </T>
        </>
      );
    }
    case "res_csv": {
      const f = d.resultFile?.file;
      return (
        <>
          <T x={10} y={22} c="n-title" style={{ fontSize: 13 }}>
            GCS · results.csv
          </T>
          <T x={10} y={38} c="n-svc">
            gs://bixby-eval-results
          </T>
          <T x={10} y={60} c="n-val">
            {f ? `${fmt.number(f.rowCount)} rows` : "—"}
          </T>
          <T x={10} y={78} c="n-mono">
            {f ? fmt.bytes(f.sizeBytes) : ""}
          </T>
        </>
      );
    }
    case "res_bq": {
      const b = d.resultFile?.bigquery;
      return (
        <>
          <T x={10} y={22} c="n-title" style={{ fontSize: 13 }}>
            BigQuery
          </T>
          <T x={10} y={38} c="n-svc">
            bixby_eval.utterance_results
          </T>
          <T x={10} y={60} c="n-val">
            {b ? `${fmt.number(b.rows)} rows` : "—"}
          </T>
          <T x={10} y={78} c="n-mono">
            streaming insert
          </T>
        </>
      );
    }
    case "retry": {
      const x = m("retry");
      const rw = num(x.retryWait);
      const pol = (x.policy ?? {}) as { backoffSeconds?: number[] };
      const bo = pol.backoffSeconds?.length ? pol.backoffSeconds.map((s) => s + "s").join(" → ") : "60s → 300s";
      if (lod === 0) return <><Header n={n} stage="retry" /><Far n={n} value={rw} label="RETRY_WAIT" tone={rw ? "retry" : null} /></>;
      return (
        <>
          <Header n={n} stage="retry" badge={{ text: `${rw} WAIT`, tone: rw ? "retry" : null }} />
          <T x={12} y={62} c="n-mono">
            Attempts &lt; 3 ? Re-run : DLQ
          </T>
          <rect x={12} y={74} width={W - 24} height={42} className="slot" strokeDasharray="3 3" />
          <T x={14} y={130} c="n-tag">
            RETRY_WAIT · backoff {bo}
          </T>
          <Line y={140} w={W} />
          <KV y={159} k="오늘 재시도" v={fmt.number(num(x.retriesToday))} w={W} />
          <KV y={159 + ROW} k="Retry 비율" v={fmt.pct(num(x.retryRate), 1)} w={W} tone={num(x.retryRate) > 0.12 ? "retry" : null} />
          <KV y={159 + ROW * 2} k="다음 재시도" v={x.nextRetryAt ? fmt.relative(num(x.nextRetryAt), d.now) : "—"} w={W} />
        </>
      );
    }
    case "dlq": {
      const x = m("dlq");
      const pend = num(x.pendingReview);
      const cats = Object.entries((x.byCategory ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
      if (lod === 0) return <><Header n={n} stage="dlq" /><Far n={n} value={pend} label="DLQ 검토 대기" tone={pend ? "dlq" : null} /></>;
      return (
        <>
          <Header n={n} stage="dlq" badge={{ text: "검토 " + pend, tone: pend ? "dlq" : null }} />
          <T x={12} y={62} c="n-mono">
            topic pipeline-dead-letter
          </T>
          <rect x={12} y={74} width={W - 24} height={42} className="slot" strokeDasharray="3 3" />
          <Line y={128} w={W} />
          <KV y={147} k="누적 / 검토 대기" v={`${num(x.total)} / ${pend}`} w={W} tone={pend ? "dlq" : null} />
          {cats.slice(0, 3).map(([c, v], i) => (
            <KV key={c} y={147 + ROW * (i + 1)} k={FAILURE_CATEGORY_META[c as keyof typeof FAILURE_CATEGORY_META]?.label ?? c} v={v} w={W} />
          ))}
        </>
      );
    }
    case "dlq_mgr": {
      const x = m("dlq");
      const bs = (x.byStatus ?? {}) as Record<string, number>;
      const pend = d.pending ?? [];
      const assigned = pend.filter((p) => p.assigned_operator).length;
      if (lod === 0) return <><Header n={n} stage="dlq" svc="Cloud Run · dlq-manager" /><Far n={n} value={bs.REPLAYING ?? 0} label="Replay 진행" tone="running" /></>;
      return (
        <>
          <Header n={n} stage="dlq" svc="Cloud Run · dlq-manager" />
          <T x={12} y={64}>
            영구 실패 → 종료 · 설정 오류 → 수정
          </T>
          <T x={12} y={82}>
            일시 장애 → 수동 Replay
          </T>
          <Line y={94} w={W} />
          <KV y={113} k="검토 대기 · 배정됨" v={`${pend.length} · ${assigned}`} w={W} tone={pend.length ? "dlq" : null} />
          <KV y={113 + ROW} k="종료(CLOSED)" v={bs.CLOSED ?? 0} w={W} />
          <KV y={113 + ROW * 2} k="Replay 진행" v={bs.REPLAYING ?? 0} w={W} tone="running" />
        </>
      );
    }
    case "replay": {
      const r = d.replays ?? [];
      const last = r[0];
      if (lod === 0)
        return (
          <>
            <Header n={n} stage="dlq" icon="refresh-cw" svc="Pub/Sub · replay.requested" />
            <Far n={n} value={r.length} label="Replay 누적" tone="retry" />
          </>
        );
      return (
        <>
          <Header n={n} stage="dlq" icon="refresh-cw" svc="Pub/Sub · replay.requested" badge={{ text: `${r.length} 회`, tone: "retry" }} />
          <KV y={68} k="성공 / 실패" v={`${r.filter((x) => x.status === "SUCCEEDED").length} / ${r.filter((x) => x.status === "FAILED").length}`} w={W} />
          <KV y={68 + ROW} k="진행 중" v={r.filter((x) => ["APPROVED", "QUEUED", "RUNNING"].includes(x.status)).length} w={W} tone="running" />
          {last ? (
            <T x={12} y={110} c="n-mono" style={{ fontSize: 11 }}>
              최근 {last.replay_id} · {last.pipeline_version_from}→{last.pipeline_version_to}
            </T>
          ) : null}
        </>
      );
    }
  }
}

function DagGroup({ n, rbc, lod }: { n: NodeBox; rbc: Record<ComponentId, number>; lod: number }) {
  const L = dagLayout(n);
  return (
    <>
      <rect x={12} y={54} width={n.w - 24} height={n.h - 108} fill="none" stroke="var(--rule)" strokeDasharray="4 3" />
      <T x={18} y={68} c="n-tag" style={{ fontSize: 9 }}>
        PipelineJob DAG · bixby-eval
      </T>
      {DAG_TEMPLATE.flatMap((t) =>
        t.deps.map((p) => {
          const a = L[p];
          const b = L[t.id];
          const ax = a.x + a.w;
          const ay = a.y + a.h / 2;
          const bx = b.x;
          const by = b.y + b.h / 2;
          const on = (rbc[t.id] ?? 0) > 0;
          return <path key={p + t.id} className={on ? "dedge on" : "dedge"} d={`M${ax},${ay} C${ax + 20},${ay} ${bx - 20},${by} ${bx},${by}`} />;
        }),
      )}
      {DAG_TEMPLATE.map((t) => {
        const b = L[t.id];
        const k = rbc[t.id] ?? 0;
        return (
          <g key={t.id}>
            <rect className={k ? "dagn on" : "dagn"} x={b.x} y={b.y} width={b.w} height={b.h} />
            <text x={b.x + 7} y={b.y + 16} style={{ font: "700 12.5px var(--f-ui)", fill: "var(--ink)", letterSpacing: "-0.02em" }}>
              {t.labelKo.replace(" (LLM Judge)", "")}
            </text>
            <text x={b.x + 7} y={b.y + 29} style={{ font: "400 9.5px var(--f-mono)", fill: "var(--ink-3)" }}>
              {t.machineType}
              {t.gpu ? " · L4" : ""}
            </text>
            <text x={b.x + b.w - 6} y={b.y + 16} textAnchor="end" style={{ font: "600 12px var(--f-mono)", fill: k ? "var(--st-running)" : "var(--ink-3)" }}>
              {k}
            </text>
            {lod === 2 ? (
              <text x={b.x + 7} y={b.y + b.h + 11} style={{ font: "400 8px var(--f-mono)", fill: "var(--ink-3)" }}>
                {t.image}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
}

export const NodeShell = memo(function NodeShell({
  id,
  n,
  selected,
  data,
  lod,
  expanded,
  onToggle,
}: {
  id: NodeId;
  n: NodeBox;
  selected: boolean;
  data: NodeData;
  lod: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const st = STAGE_BY_ID[n.stage];
  return (
    <g
      className={selected ? "node sel" : "node"}
      data-node={id}
      data-stage={n.stage}
      tabIndex={0}
      role="button"
      aria-label={`${st.label.ko} (${n.title}) 상세 열기`}
      aria-pressed={selected}
      transform={`translate(${n.x},${n.y})`}
      style={{ ["--i" as string]: n.i }}
    >
      <rect className="sel-ring" x={-6} y={-6} width={n.w + 12} height={n.h + 12} />
      <rect className={n.sub ? "n-box sub" : "n-box main"} width={n.w} height={n.h} />
      {n.sub ? null : <rect x={0} y={0} width={n.w} height={3} className="n-head" />}
      {body(id, n, data, lod, expanded, onToggle)}
    </g>
  );
});

export type { Layout };
