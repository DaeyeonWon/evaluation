"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Ban,
  Bell,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Eye,
  Gauge,
  History,
  Loader,
  Pause,
  Radio,
  RotateCcw,
  ShieldCheck,
  XOctagon,
  ArchiveX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { FAILURE_CATEGORY_META, LANG_CODES, STATES, STATUS_META, OPERATORS } from "@/lib/catalog";
import {
  api,
  parseAsString,
  revalidateKey,
  useApi,
  useLiveStream,
  useQueryStates,
  useSimNow,
  useStreamEvent,
} from "@/lib/client";
import { fmt } from "@/lib/format";
import type { Alert, CapacitySnapshot, LangCode, StageId, TickSnapshot, WorkflowEvent } from "@/lib/types";
import { accent, axX, axY, baseOpt, itemTooltip } from "../chart";
import { wfHref } from "../nav-store";
import { Empty, Lang, Panel, Skel, TweenNum, useApiErrorToast, useToast } from "../ui";
import { StageInspector, type InspectorTab } from "./inspector";
import { ALL_STAGES, OrchestrationRail, type DockToken } from "./rail";

const SEV_TONE: Record<string, string> = { DEBUG: "cancelled", INFO: "running", NOTICE: "success", WARNING: "retry", ERROR: "failed", CRITICAL: "failed" };
const opName = (id: string | null | undefined) => OPERATORS.find((o) => o.id === id)?.name ?? id ?? "-";

/** Stage occupancy as drawn on the rail (same definitions as the prototype). */
function computeCounts(s: TickSnapshot | null, gcsToday: number, busToday: number): Record<StageId, number> {
  const c = s?.counts;
  return {
    gcs_input: gcsToday,
    event_bus: busToday,
    ingress: (c?.RECEIVED ?? 0) + (c?.VALIDATED ?? 0),
    registry_queue: c?.QUEUED ?? 0,
    scheduler: c?.RESERVED ?? 0,
    workflows: c?.DISPATCHING ?? 0,
    vertex: c?.RUNNING ?? 0,
    results: s?.kpis.completedToday ?? 0,
    retry: c?.RETRY_WAIT ?? 0,
    dlq: s?.kpis.dlqPendingReview ?? 0,
  };
}

const INSPECTOR_PARSERS = { stage: parseAsString, tab: parseAsString };

export function OrchestrationHome() {
  const router = useRouter();
  const { snapshot } = useLiveStream();
  const now = useSimNow();
  const [q, setQ] = useQueryStates(INSPECTOR_PARSERS);
  const activeStage = (ALL_STAGES as string[]).includes(q.stage ?? "") ? (q.stage as StageId) : null;

  // transit-stage counters (stages without workflow states)
  const gcs = useApi(["stage-metric", "gcs_input"], () => api.stage("gcs_input", { limit: 1 }), { revalidateOn: ["tick"], throttleMs: 6000 });
  const bus = useApi(["stage-metric", "event_bus"], () => api.stage("event_bus", { limit: 1 }), { revalidateOn: ["tick"], throttleMs: 6000 });
  const gcsToday = Number(gcs.data?.metrics.objectsToday ?? 0);
  const busToday = Number(bus.data?.metrics.deliveredToday ?? 0);
  const counts = useMemo(() => computeCounts(snapshot, gcsToday, busToday), [snapshot, gcsToday, busToday]);

  // sparkline history: seeded from the 5-minute series, then one sample per tick
  const fm = useApi(["throughput", "5m"], () => api.throughput({ granularity: "5m" }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const seed = useMemo(() => {
    const out = {} as Record<StageId, number[]>;
    const s = fm.data;
    const take = 36;
    const n = s?.ts.length ?? 0;
    const sum = (obj: Record<LangCode, number[]> | undefined, i: number) => (obj ? LANG_CODES.reduce((a, l) => a + (obj[l]?.[i] ?? 0), 0) : 0);
    for (const id of ALL_STAGES) {
      const arr: number[] = [];
      for (let k = take; k > 0; k--) {
        const i = Math.max(0, n - k);
        let v: number;
        if (s && id === "registry_queue" && s.queueDepth) v = sum(s.queueDepth, i);
        else if (s && id === "vertex" && s.active) v = sum(s.active, i) * 0.75;
        else if (s && (id === "gcs_input" || id === "event_bus")) v = sum(s.byLanguage, i) / 100;
        else if (s && id === "results") v = s.total[i] ?? 0;
        else v = Math.max(0, Math.round(Math.sin(k * 0.32 + id.length) * 1.4 + Math.sin(k * 0.11) * 0.8 + 2));
        arr.push(v);
      }
      out[id] = arr;
    }
    return out;
  }, [fm.data]);
  const countsRef = useRef(counts);
  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);
  const [tail, setTail] = useState<Record<StageId, number>[]>([]);
  useStreamEvent("tick", () => setTail((xs) => [...xs.slice(-36), countsRef.current]));
  const hist = useMemo(() => {
    const out = {} as Record<StageId, number[]>;
    for (const id of ALL_STAGES) out[id] = [...seed[id], ...tail.map((t) => t[id]), counts[id]].slice(-37);
    return out;
  }, [seed, tail, counts]);

  // docks
  const recent = useApi(["workflows", "rail-succeeded"], () => api.workflows({ status: ["SUCCEEDED"], sort: "updated_desc", pageSize: 30 }), {
    revalidateOn: ["transition"],
    throttleMs: 4000,
  });
  const dlqDock = useApi(["dead-letters", "rail"], () => api.deadLetters({ status: ["PENDING_REVIEW", "REPLAYING"], pageSize: 100 }), { revalidateOn: ["dlq"] });
  const docks = useMemo(() => {
    const d = Object.fromEntries(ALL_STAGES.map((s) => [s, [] as DockToken[]])) as Record<StageId, DockToken[]>;
    for (const w of snapshot?.active ?? []) {
      const stage: StageId | null =
        w.status === "RECEIVED" || w.status === "VALIDATED"
          ? "ingress"
          : w.status === "QUEUED"
            ? "registry_queue"
            : w.status === "RESERVED"
              ? "scheduler"
              : w.status === "DISPATCHING"
                ? "workflows"
                : w.status === "RUNNING"
                  ? "vertex"
                  : w.status === "RETRY_WAIT"
                    ? "retry"
                    : null;
      if (stage) d[stage].push({ workflow_id: w.workflow_id, language: w.language, status: w.status, retry: w.status === "RETRY_WAIT" || w.attempt > 1, pct: w.pct });
    }
    d.results = (recent.data?.items ?? [])
      .filter((w) => w.completed_at != null && w.completed_at >= now - 25 * 60e3)
      .map((w) => ({ workflow_id: w.workflow_id, language: w.language, status: w.status, retry: w.attempt > 1 }));
    d.dlq = (dlqDock.data?.items ?? []).map((x) => ({ workflow_id: x.workflow_id, language: x.language, status: "DEAD_LETTERED" as const, retry: false }));
    return d;
  }, [snapshot, recent.data, dlqDock.data, now]);

  // boot choreography (rail draws in, then the rest)
  const [boot, setBoot] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setBoot(false), 1800);
    return () => clearTimeout(t);
  }, []);

  const openStage = useCallback((id: StageId) => setQ({ stage: id, tab: null }, { history: "push" }), [setQ]);
  const closeStage = useCallback(() => setQ({ stage: null, tab: null }), [setQ]);

  return (
    <div className={clsx("screen enter", boot && "boot")}>
      <OrchestrationRail counts={counts} hist={hist} docks={docks} activeStage={activeStage} onOpenStage={openStage} speed={snapshot?.speed ?? 1} />
      <KpiBand snapshot={snapshot} />
      <div className="grid g-7-5 boot-late">
        <div className="home-left">
          <Panel
            title="언어별 Capacity"
            icon={<Gauge aria-hidden />}
            right={
              <Link className="btn sm ghost" href="/flowline/capacity">
                Capacity 관리 <ChevronRight aria-hidden />
              </Link>
            }
          >
            {snapshot ? <CapBars cap={snapshot.capacity} /> : <Skel h={180} />}
            <div className="sub cap-legend">
              <span>
                <i className="slot on lc-ko" /> 실행 중
              </span>
              <span>
                <i className="slot rsv lc-ko" /> 예약·요청 중
              </span>
              <span>
                <i className="slot q lc-ko" /> 대기열
              </span>
            </div>
          </Panel>
          <Panel
            className="feed-panel"
            title="최근 이벤트"
            icon={<Radio aria-hidden />}
            right={
              <span className="live" style={{ fontSize: 10 }}>
                <i />
                STREAM
              </span>
            }
          >
            <EventFeed onOpen={(id) => router.push(wfHref(id, { screen: "orch" }))} />
          </Panel>
        </div>
        <AlertsPanel openAlerts={snapshot?.kpis.openAlerts} />
      </div>
      <div className="grid g2 boot-late">
        <ThroughputChart />
        <LangTrendChart data={fm.data} />
      </div>
      <div className="grid g2 boot-late">
        <StateChart counts={snapshot?.counts} total={snapshot?.totalWorkflows} />
        <ErrorChart />
      </div>
      <StageInspector
        stageId={activeStage}
        tab={(q.tab as InspectorTab) ?? null}
        onTab={(t) => setQ({ tab: t })}
        onClose={closeStage}
        onJump={(id, tab) => setQ({ stage: id, tab: tab ?? null })}
        hist={activeStage ? hist[activeStage] : []}
      />
    </div>
  );
}

// ───────────────────────────── KPI band ──
interface KpiDef {
  k: keyof TickSnapshot["kpis"];
  l: string;
  icon: ReactNode;
  t: string;
  href: string;
  f?: (v: number) => string;
  s: (s: TickSnapshot) => string;
}
const KPI_DEF: KpiDef[] = [
  { k: "running", l: "Running", icon: <Loader className="spin" aria-hidden />, t: "running", href: "/flowline/explorer?preset=running", s: (s) => `Dispatching ${s.counts.DISPATCHING ?? 0}` },
  { k: "pending", l: "Pending", icon: <Clock aria-hidden />, t: "queued", href: "/flowline/explorer?preset=pending", s: (s) => `Queued ${s.kpis.queued} · 접수 ${s.kpis.pending - s.kpis.queued}` },
  { k: "completedToday", l: "Completed (오늘)", icon: <CheckCircle aria-hidden />, t: "success", href: "/flowline/explorer?preset=completed", s: (s) => `${fmt.number(s.kpis.utterancesEvaluatedToday)} 발화 평가` },
  { k: "failedToday", l: "Failed (오늘)", icon: <XOctagon aria-hidden />, t: "failed", href: "/flowline/explorer?preset=failed", s: (s) => `DLQ·Timeout · 취소 ${s.kpis.cancelledToday} 별도` },
  { k: "retryWaiting", l: "Retry Waiting", icon: <RotateCcw aria-hidden />, t: "retry", href: "/flowline/explorer?preset=retry", s: () => "backoff 60s / 300s" },
  { k: "dlqPendingReview", l: "DLQ 검토 대기", icon: <ArchiveX aria-hidden />, t: "dlq", href: "/flowline/dlq?status=PENDING_REVIEW", s: (s) => `누적 ${s.kpis.dlqTotal}건` },
  { k: "successRateToday", l: "Success Rate", icon: <ShieldCheck aria-hidden />, t: "success", href: "/flowline/analytics", f: (v) => fmt.pct(v, 1), s: (s) => `7일 ${fmt.pct(s.kpis.successRate7d, 1)}` },
  { k: "avgProcessingMs", l: "Avg / p95 처리시간", icon: <History aria-hidden />, t: "accent", href: "/flowline/analytics", f: (v) => fmt.duration(v, { style: "short" }), s: (s) => `p95 ${fmt.duration(s.kpis.p95ProcessingMs, { style: "short" })}` },
];

function KpiBand({ snapshot }: { snapshot: TickSnapshot | null }) {
  return (
    <div className="kpis">
      {KPI_DEF.map((d) => {
        const v = snapshot ? (snapshot.kpis[d.k] as number | null) : null;
        return (
          <Link key={d.k} href={d.href} className={`kpi t-${d.t}`}>
            <span className="k-l">
              {d.icon}
              {d.l}
            </span>
            <span className="k-v">{v == null ? "-" : <TweenNum value={v} format={d.f} decimals={d.f ? 4 : 0} />}</span>
            <span className="k-s">{snapshot ? d.s(snapshot) : " "}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ───────────────────────────── capacity bars ──
const CAP_TONE: Record<string, string> = { OK: "success", SATURATED: "retry", BACKLOGGED: "failed", PAUSED: "cancelled", DISABLED: "cancelled" };
const CAP_META: Record<string, [ReactNode, string]> = {
  OK: [<CheckCircle key="i" aria-hidden />, "여유"],
  SATURATED: [<Gauge key="i" aria-hidden />, "포화"],
  BACKLOGGED: [<AlertTriangle key="i" aria-hidden />, "적체"],
  PAUSED: [<Pause key="i" aria-hidden />, "일시 중지"],
  DISABLED: [<Ban key="i" aria-hidden />, "비활성"],
};
export function CapChip({ status }: { status: string }) {
  const m = CAP_META[status] ?? [null, status];
  return (
    <span className={`pill sm t-${CAP_TONE[status] ?? "queued"}`} title={status}>
      {m[0]}
      {m[1]}{" "}
      <span className="mono" style={{ fontSize: 9.5, opacity: 0.8, letterSpacing: "0.04em" }}>
        {status}
      </span>
    </span>
  );
}

function CapBars({ cap }: { cap: CapacitySnapshot }) {
  return (
    <div className="caps">
      {cap.languages.map((l) => {
        const cells: string[] = [];
        for (let i = 0; i < l.max; i++) cells.push(i < l.running ? "on" : i < l.running + l.reserved + l.dispatching ? "rsv" : "");
        const qn = Math.min(l.backlog, 12);
        return (
          <div className={`cap-row lc-${l.code}`} key={l.code}>
            <div className="lname">
              <b>{l.name}</b>
              <Lang code={l.code} />
            </div>
            <div className="slots" aria-label={`${l.name} Active ${l.active}/${l.max}`}>
              {cells.map((c, i) => (
                <i key={i} className={clsx("slot", c)} />
              ))}
              {Array.from({ length: qn }, (_, i) => (
                <i key={`q${i}`} className="slot q" />
              ))}
              {l.backlog > 12 && <span className="kbd">+{l.backlog - 12}</span>}
            </div>
            <div className="cap-meta">
              <b>
                {l.active}/{l.max}
              </b>{" "}
              active <CapChip status={l.status} />
              <br />
              backlog {l.backlog} · p95{" "}
              <span style={{ color: l.p95WaitSec > l.p95WaitSloSec ? "var(--st-failed)" : "inherit" }}>{fmt.duration(l.p95WaitSec * 1000, { style: "short" })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────── event feed ──
function EventFeed({ onOpen }: { onOpen: (wf: string) => void }) {
  const now = useSimNow();
  const { data } = useApi(["events", "home"], () => api.events({ limit: 30 }));
  const [live, setLive] = useState<WorkflowEvent[]>([]);
  useStreamEvent("event", (e) => setLive((xs) => [e, ...xs].slice(0, 40)));
  const list = useMemo(() => {
    const seen = new Set<string>();
    const all = [...live.filter((e) => e.ts <= now), ...(data ?? [])].sort((a, b) => b.ts - a.ts);
    const out: WorkflowEvent[] = [];
    for (const e of all) {
      if (seen.has(e.event_id)) continue;
      seen.add(e.event_id);
      out.push(e);
      if (out.length >= 30) break;
    }
    return out;
  }, [live, data, now]);
  if (!data && !live.length) return <Skel h={260} />;
  return (
    <div className="feed fade">
      <AnimatePresence initial={false}>
        {list.map((e) => (
          <motion.button
            type="button"
            key={e.event_id}
            layout="position"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className={clsx("feed-row", e.workflow_id && "link")}
            onClick={() => e.workflow_id && onOpen(e.workflow_id)}
            disabled={!e.workflow_id}
          >
            <span className="ft">{fmt.time(e.ts)}</span>
            <span className={`sev-dot t-${SEV_TONE[e.severity] ?? "running"}`} title={e.severity} />
            <span className="fn">
              {e.name}
              <small>
                {e.label}
                {e.workflow_id ? " · " + e.workflow_id.replace("wf-", "") : ""}
              </small>
            </span>
            {e.language ? <Lang code={e.language} /> : <span />}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────── alerts & incidents ──
function AlertsPanel({ openAlerts }: { openAlerts?: number }) {
  const now = useSimNow();
  const toast = useToast();
  const onErr = useApiErrorToast();
  const alerts = useApi(["alerts", "home"], () => api.alerts(), { revalidateOn: ["alert"] });
  const inc = useApi(["incidents"], () => api.incidents());
  const [busy, setBusy] = useState<string | null>(null);
  const open = (alerts.data ?? []).filter((a) => a.status !== "RESOLVED").slice(0, 6);
  const ack = async (a: Alert) => {
    setBusy(a.alert_id);
    try {
      await api.ackAlert(a.alert_id, { note: "관제 화면에서 확인" });
      toast(`${a.alert_id} 알림을 확인 처리했습니다 · 감사 로그 기록`, "success");
      revalidateKey("alerts");
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="시스템 알림 · 장애" icon={<Bell aria-hidden />} right={<span className="sub">{openAlerts ?? open.length}건 열림</span>}>
      <div className="eyebrow" style={{ margin: "2px 0 4px" }}>
        Incidents
      </div>
      {(inc.data ?? []).map((i) => {
        const ok = i.status === "RESOLVED";
        return (
          <div key={i.incident_id} className={`alert-row t-${ok ? "success" : "retry"}`}>
            <span className="bar" />
            <div>
              <b>
                {i.incident_id} · {i.title}
              </b>
              <p>
                {i.severity} · {ok ? "해결됨" : "모니터링 중"} · 지휘 {opName(i.commander)} · {fmt.relative(i.started_at, now)}
              </p>
            </div>
            <span className={`pill sm t-${ok ? "success" : "retry"}`}>
              {ok ? <CheckCircle aria-hidden /> : <Eye aria-hidden />}
              {i.status}
            </span>
          </div>
        );
      })}
      <div className="eyebrow" style={{ margin: "12px 0 4px" }}>
        열린 알림 {open.length}
      </div>
      {!alerts.data ? (
        <Skel h={160} />
      ) : open.length ? (
        <AnimatePresence initial={false}>
          {open.map((a) => (
            <motion.div layout key={a.alert_id} className={`alert-row t-${a.severity === "CRITICAL" ? "failed" : "retry"}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="bar" />
              <div>
                <b>{a.title}</b>
                <p>{a.message}</p>
                <p className="sub">
                  <span className="mono">{a.alert_id}</span> · {fmt.relative(a.opened_at, now)}
                  {a.acknowledged_by ? " · 확인 " + opName(a.acknowledged_by) : ""}
                </p>
              </div>
              <div className="acts">
                {a.status === "OPEN" ? (
                  <button className="btn sm" onClick={() => ack(a)} disabled={busy === a.alert_id}>
                    <Check aria-hidden />
                    확인
                  </button>
                ) : (
                  <span className="pill sm t-queued">
                    <Eye aria-hidden />
                    확인됨
                  </span>
                )}
                {a.dead_letter_id ? (
                  <Link className="btn sm dlqb" href={`/flowline/dlq?focus=${encodeURIComponent(a.dead_letter_id)}`}>
                    DLQ
                  </Link>
                ) : a.workflow_id ? (
                  <Link className="btn sm ghost" href={wfHref(a.workflow_id, { screen: "orch" })}>
                    열기
                  </Link>
                ) : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      ) : (
        <Empty>열린 알림이 없습니다</Empty>
      )}
    </Panel>
  );
}

// ───────────────────────────── charts ──
function ThroughputChart() {
  const { data } = useApi(["throughput", "48h"], () => api.throughput({ range: "48h" }), { revalidateOn: ["tick"], throttleMs: 60000 });
  const option = useMemo(
    () =>
      data
        ? (t: ChartTokens) =>
            baseOpt(t, {
              legend: { show: false },
              xAxis: axX(t, data.ts.map((x) => fmt.hm(x)), { axisLabel: { color: t.muted, fontSize: 10.5, interval: 5, fontFamily: t.mono } }),
              yAxis: axY(t, { name: "pipelines/h", nameTextStyle: { color: t.muted, fontSize: 10, fontFamily: t.mono, align: "left" } }),
              series: [{ type: "bar", name: "완료 pipeline", barWidth: "62%", itemStyle: { color: accent(t), borderRadius: [2, 2, 0, 0] }, data: data.total }],
            })
        : null,
    [data],
  );
  return (
    <Panel title="Pipeline Throughput" right={<span className="sub">최근 48시간 · 완료 pipeline/h · BigQuery 집계</span>}>
      {option ? <EChart className="chart" option={option} ariaLabel="최근 48시간 완료 pipeline 처리량" /> : <Skel h={230} />}
    </Panel>
  );
}

function LangTrendChart({ data }: { data: import("@/lib/types").ThroughputSeries | undefined }) {
  const option = useMemo(
    () =>
      data
        ? (t: ChartTokens) =>
            baseOpt(t, {
              xAxis: axX(t, data.ts.map((x) => fmt.hm(x)), { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 10.5, interval: 23, fontFamily: t.mono, alignMinLabel: "left", alignMaxLabel: "right" } }),
              yAxis: axY(t),
              series: LANG_CODES.map((l) => ({
                type: "line" as const,
                name: l.toUpperCase(),
                showSymbol: false,
                smooth: 0.3,
                lineStyle: { width: 1.6, color: t.lang[l] },
                itemStyle: { color: t.lang[l] },
                data: data.utterances?.[l] ?? data.byLanguage[l],
              })),
            })
        : null,
    [data],
  );
  return (
    <Panel title="언어별 처리량 추이" right={<span className="sub">오늘 · 5분 단위 평가 발화 수</span>}>
      {option ? <EChart className="chart" option={option} setOptionOpts={{ notMerge: false }} ariaLabel="언어별 5분 단위 발화 처리량" /> : <Skel h={230} />}
    </Panel>
  );
}

function StateChart({ counts, total }: { counts?: TickSnapshot["counts"]; total?: number }) {
  const sig = counts ? STATES.map((s) => counts[s] ?? 0).join(",") : "";
  const option = useMemo(() => {
    if (!sig) return null;
    const vals = sig.split(",").map(Number);
    const st = [...STATES].reverse();
    const rv = [...vals].reverse();
    return (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        tooltip: itemTooltip(t),
        grid: { left: 6, right: 26, top: 4, bottom: 4, containLabel: true },
        xAxis: axY(t, { splitNumber: 3 }),
        yAxis: axX(t, st.map((s) => STATUS_META[s].label), { axisLabel: { color: t.text, fontSize: 11, fontFamily: t.font } }),
        series: [
          {
            type: "bar",
            barWidth: 9,
            label: { show: true, position: "right", color: t.text, fontSize: 10.5, fontFamily: t.mono },
            data: st.map((s, i) => ({ value: rv[i], itemStyle: { color: t.tone[STATUS_META[s].tone], borderRadius: 2 } })),
          },
        ],
      });
  }, [sig]);
  return (
    <Panel title="Workflow 상태 분포" right={<span className="sub">레지스트리 {total ?? "-"}건 · 실시간</span>}>
      {option ? <EChart className="chart" option={option} setOptionOpts={{ notMerge: false }} ariaLabel="Workflow 상태 분포" /> : <Skel h={230} />}
    </Panel>
  );
}

function ErrorChart() {
  const { data } = useApi(["errors", "7d"], () => api.errors({ range: "7d" }));
  const option = useMemo(() => {
    if (!data) return null;
    const e = [...data.top].reverse();
    return (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        tooltip: itemTooltip(t),
        grid: { left: 6, right: 26, top: 4, bottom: 4, containLabel: true },
        xAxis: axY(t, { splitNumber: 3 }),
        yAxis: axX(t, e.map((x) => x.label), { axisLabel: { color: t.text, fontSize: 11, fontFamily: t.font } }),
        series: [
          {
            type: "bar",
            barWidth: 9,
            label: { show: true, position: "right", color: t.text, fontSize: 10.5, fontFamily: t.mono },
            data: e.map((x) => ({ value: x.count, itemStyle: { color: FAILURE_CATEGORY_META[x.category]?.retryable ? t.tone.retry : t.tone.failed, borderRadius: 2 } })),
          },
        ],
      });
  }, [data]);
  return (
    <Panel title="오류 유형 분포" right={<span className="sub">최근 7일 · Attempt 기준 · 주황 = 재시도 가능</span>}>
      {option ? <EChart className="chart" option={option} ariaLabel="최근 7일 오류 유형 분포" /> : <Skel h={230} />}
    </Panel>
  );
}
