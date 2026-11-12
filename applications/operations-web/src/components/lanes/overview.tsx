"use client";
/**
 * S1 — Global overview. KPIs from the SSE tick; throughput (48h), per-language trend (5m, today),
 * state distribution, 7d error types, recent events (live), alerts (ACK / resolve via API) + incidents.
 */
import clsx from "clsx";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
import { Activity, AlertTriangle, ArchiveX, BarChart3, Bell, CheckCircle2, ExternalLink, Layers, LayoutGrid, Radio, Target, XOctagon } from "lucide-react";
import { FAILURE_CATEGORY_META, LANG_CODES, STATES, STATUS_META } from "@/lib/catalog";
import { api, revalidateKey, useApi, useLiveStream, useSimNow, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, EChart } from "@/components/shared";
import type { Alert } from "@/lib/types";
import { Empty, LangTag, Pill, Tween, axX, axY, chartBase, dur, eo, langName, opName, pct, shortWf, useAction, useCan, useHere, wfHref } from "./core";

export function OverviewScreen() {
  const { snapshot } = useLiveStream();
  const k = snapshot?.kpis;
  const g = snapshot?.capacity.global;
  const reduced = !!useReducedMotion();
  const kpis: { k: string; l: string; icon: React.ReactNode; t: string; v: number | null | undefined; f?: (v: number) => string; sub: string; href: string }[] = [
    { k: "running", l: "Running", icon: <CatalogIcon name="loader" />, t: "running", v: k?.running, sub: g ? `Global ${g.active}/${g.max} slot` : "", href: "/lanes/explorer?status=RUNNING,DISPATCHING" },
    { k: "pending", l: "Pending", icon: <CatalogIcon name="clock" />, t: "queued", v: k?.pending, sub: k ? `대기열 ${k.queued} · 수신/예약 ${k.pending - k.queued}` : "", href: "/lanes/explorer?status=QUEUED,RECEIVED,VALIDATED,RESERVED" },
    { k: "completed", l: "Completed (오늘)", icon: <CheckCircle2 />, t: "success", v: k?.completedToday, sub: k ? `${fmt.number(k.utterancesEvaluatedToday)} 발화 평가` : "", href: "/lanes/explorer?status=SUCCEEDED" },
    { k: "failed", l: "Failed (오늘)", icon: <XOctagon />, t: "failed", v: k?.failedToday, sub: k ? `취소 ${k.cancelledToday}건 별도` : "", href: "/lanes/explorer?status=TIMED_OUT,DEAD_LETTERED" },
    { k: "retry", l: "Retry Waiting", icon: <CatalogIcon name="rotate-ccw" />, t: "retry", v: k?.retryWaiting, sub: "Backoff 60s / 300s", href: "/lanes/explorer?status=RETRY_WAIT" },
    { k: "dlq", l: "DLQ Pending Review", icon: <ArchiveX />, t: "dlq", v: k?.dlqPendingReview, sub: k ? `DLQ 전체 ${k.dlqTotal}건` : "", href: "/lanes/dlq?status=PENDING_REVIEW" },
    { k: "succ", l: "Overall Success (7d)", icon: <Target />, t: "success", v: k?.successRate7d != null ? k.successRate7d * 100 : null, f: (v) => v.toFixed(1) + "%", sub: k ? `오늘 ${pct(k.successRateToday)} · 목표 99.5%` : "", href: "/lanes/analytics" },
    { k: "proc", l: "Avg / p95 처리", icon: <Activity />, t: "running", v: k ? k.avgProcessingMs / 1000 : null, f: (v) => dur(v * 1000), sub: k ? `p95 ${dur(k.p95ProcessingMs)} · 대기 ${dur(k.avgWaitMs)}` : "", href: "/lanes/analytics" },
  ];
  const tp = useApi(["lanes-tp-48h"], () => api.throughput({ range: "48h" }), { revalidateOn: ["transition"], throttleMs: 15000 });
  const five = useApi(["lanes-tp-5m"], () => api.throughput({ granularity: "5m" }), { revalidateOn: ["tick"], throttleMs: 10000 });
  const errs = useApi(["lanes-errors-7d"], () => api.errors({ range: "7d" }), { revalidateOn: ["transition"], throttleMs: 15000 });
  const counts = snapshot?.counts;
  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Screen 1 · Overview-first</div>
          <h1>Global Overview</h1>
          <p>전체 Pipeline 실행 건강 상태. 숫자는 서버 시뮬레이터 틱(SSE)마다 갱신되며, 각 항목을 누르면 관련 화면으로 이동합니다.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className="btn" href="/lanes">
            <LayoutGrid />
            보드
          </Link>
          <Link className="btn" href="/lanes/dlq">
            <ArchiveX />
            DLQ 처리
          </Link>
        </div>
      </div>
      <div className="kpis">
        {kpis.map((x) => (
          <Link key={x.k} className={`kpi t-${x.t}`} href={x.href}>
            <span className="bar" />
            <div className="lbl">
              <span className="tc" style={{ display: "inline-flex" }}>
                {x.icon}
              </span>
              {x.l}
            </div>
            <div className="v">{x.v == null ? <span className="skel" style={{ display: "block", height: 36, width: 70 }} /> : <Tween value={x.v} f={x.f} />}</div>
            <div className="sub">{x.sub}</div>
          </Link>
        ))}
      </div>
      <div className="grid g-12-8" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-h">
            <h2 className="sec">
              <Activity className="i" />
              Pipeline Throughput <span className="eyebrow">최근 48시간 · 완료 pipelines/h</span>
            </h2>
          </div>
          {tp.data ? (
            <EChart
              className="chart"
              ariaLabel="48시간 처리량"
              option={(t) =>
                eo({
                  ...chartBase(t, reduced),
                  legend: { show: false },
                  xAxis: axX(t, "time", { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => fmt.hm(v), hideOverlap: true } }),
                  yAxis: axY(t, { name: "pipelines/h", nameTextStyle: { color: t.muted, fontSize: 10, align: "left" } }),
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => v + " pipelines" },
                  series: [
                    {
                      type: "line",
                      name: "전체 처리량",
                      data: tp.data!.ts.map((x, i) => [x, tp.data!.total[i]]),
                      showSymbol: false,
                      smooth: 0.3,
                      lineStyle: { width: 1.8, color: t.read("--ink") },
                      itemStyle: { color: t.read("--ink") },
                      areaStyle: {
                        color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: t.read("--ink") + "33" }, { offset: 1, color: t.read("--ink") + "00" }] },
                      },
                    },
                  ],
                })
              }
            />
          ) : (
            <div className="skel chart" />
          )}
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2 className="sec">
              <Layers className="i" />
              Workflow 상태 분포 <span className="eyebrow">Firestore 로드 {snapshot?.totalWorkflows ?? "—"}건 · 실시간</span>
            </h2>
          </div>
          {counts ? (
            <EChart
              className="chart"
              ariaLabel="상태 분포"
              option={(t) => {
                // Fixed category list (zero bars allowed) so labels never shift under bars on SSE ticks.
                const ks = STATES;
                return eo({
                  ...chartBase(t, reduced),
                  animationDurationUpdate: 500,
                  grid: { left: 92, right: 30, top: 6, bottom: 20 },
                  legend: { show: false },
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), trigger: "item" },
                  xAxis: axY(t),
                  yAxis: axX(t, "category", { data: ks.map((s) => STATUS_META[s].label), inverse: true, axisLabel: { color: t.text, fontSize: 11, interval: 0 } }),
                  series: [
                    {
                      type: "bar",
                      barWidth: 9,
                      data: ks.map((s) => ({ value: counts[s] ?? 0, name: STATUS_META[s].label, itemStyle: { color: t.tone[STATUS_META[s].tone], borderRadius: [0, 2, 2, 0] } })),
                      label: { show: true, position: "right", color: t.text, fontSize: 10, fontFamily: t.mono },
                    },
                  ],
                });
              }}
              setOptionOpts={{ notMerge: false }}
            />
          ) : (
            <div className="skel chart" />
          )}
        </div>
      </div>
      <div className="grid g-12-8" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panel-h">
            <h2 className="sec">
              <BarChart3 className="i" />
              언어별 처리량 추이 <span className="eyebrow">오늘 · 5분 간격 평가 발화(1h 이동합)</span>
            </h2>
          </div>
          {five.data ? (
            <EChart
              className="chart"
              ariaLabel="언어별 처리량 추이"
              option={(t) =>
                eo({
                  ...chartBase(t, reduced),
                  xAxis: axX(t, "time", { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => fmt.hm(v) } }),
                  yAxis: axY(t, { name: "발화/h", nameTextStyle: { color: t.muted, fontSize: 10, align: "left" } }),
                  series: LANG_CODES.map((l) => ({
                    type: "line",
                    name: langName(l),
                    showSymbol: false,
                    smooth: 0.35,
                    lineStyle: { width: 1.6 },
                    itemStyle: { color: t.lang[l] },
                    data: five.data!.ts.map((x, i) => [x, five.data!.byLanguage[l].slice(Math.max(0, i - 11), i + 1).reduce((a, b) => a + b, 0)]),
                  })),
                })
              }
            />
          ) : (
            <div className="skel chart" />
          )}
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2 className="sec">
              <AlertTriangle className="i" />
              오류 유형 분포 <span className="eyebrow">7일 · 실패 Attempt</span>
            </h2>
          </div>
          {errs.data ? (
            <EChart
              className="chart"
              ariaLabel="오류 유형 분포"
              option={(t) =>
                eo({
                  ...chartBase(t, reduced),
                  grid: { left: 118, right: 30, top: 6, bottom: 20 },
                  legend: { show: false },
                  tooltip: { ...(chartBase(t, reduced).tooltip as object), trigger: "item" },
                  xAxis: axY(t),
                  yAxis: axX(t, "category", { data: errs.data!.top.map((x) => x.label), inverse: true, axisLabel: { color: t.text, fontSize: 11, interval: 0 } }),
                  series: [
                    {
                      type: "bar",
                      barWidth: 9,
                      data: errs.data!.top.map((x) => ({ value: x.count, itemStyle: { color: FAILURE_CATEGORY_META[x.category]?.retryable ? t.tone.retry : t.tone.failed, borderRadius: [0, 2, 2, 0] } })),
                      label: { show: true, position: "right", color: t.text, fontSize: 10, fontFamily: t.mono },
                    },
                  ],
                })
              }
            />
          ) : (
            <div className="skel chart" />
          )}
        </div>
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <RecentEvents />
        <AlertsPanel />
      </div>
    </section>
  );
}

function RecentEvents() {
  const here = useHere();
  const [warn, setWarn] = useState(false);
  const q = useApi(["lanes-ov-events", warn], () => api.events({ limit: 40, severity: warn ? ["WARNING", "ERROR", "CRITICAL"] : undefined }), { revalidateOn: ["event"], throttleMs: 2000 });
  const [fresh, setFresh] = useState<string[]>([]);
  useStreamEvent("event", (e) => setFresh((f) => [e.event_id, ...f].slice(0, 12)));
  const evs = q.data ?? [];
  return (
    <div className="panel ovev-p">
      <div className="panel-h">
        <h2 className="sec">
          <Radio className="i" />
          최근 이벤트
        </h2>
        <span className="r">
          <div className="seg" role="group" aria-label="심각도 필터">
            <button type="button" aria-pressed={!warn} onClick={() => setWarn(false)}>
              전체
            </button>
            <button type="button" aria-pressed={warn} onClick={() => setWarn(true)}>
              WARN+
            </button>
          </div>
        </span>
      </div>
      <div className="feed scroll-y ovev">
        {q.isLoading && <div className="skel" style={{ height: 300 }} />}
        {evs.map((e) => {
          const tone = e.severity === "ERROR" || e.severity === "CRITICAL" ? "failed" : e.severity === "WARNING" ? "retry" : "queued";
          return (
            <div key={e.event_id} className={clsx("ev", fresh.includes(e.event_id) && "new")}>
              <span className="tm">{fmt.time(e.ts)}</span>
              <span className={`t-${tone}`}>
                <CatalogIcon name={tone === "queued" ? "circle-dashed" : "alert-triangle"} />
              </span>
              <span className="nm">
                {e.name}{" "}
                <span className="muted" style={{ fontFamily: "var(--f-body)" }}>
                  {e.label}
                </span>{" "}
                {e.language && <LangTag code={e.language} />}
              </span>
              {e.workflow_id ? (
                <Link className="btn sm ghost mono" href={wfHref(e.workflow_id, here)}>
                  {shortWf(e.workflow_id)}
                </Link>
              ) : (
                <span className="mono dim" style={{ fontSize: 10 }}>
                  system
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertsPanel() {
  const here = useHere();
  const now = useSimNow();
  const { can } = useCan();
  const act = useAction();
  const al = useApi(["lanes-alerts"], () => api.alerts(), { revalidateOn: ["alert"] });
  const inc = useApi(["lanes-incidents"], () => api.incidents(), { revalidateOn: ["alert"], throttleMs: 5000 });
  const list = (al.data ?? []).slice(0, 14);
  const today = fmt.date(now);
  const mutateAlert = async (a: Alert, kind: "ack" | "resolve") => {
    const r = await act(() => (kind === "ack" ? api.ackAlert(a.alert_id, { note: "Lanes 콘솔에서 확인" }) : api.resolveAlert(a.alert_id, { note: "Lanes 콘솔에서 해결" })), (x) =>
      `${x.alert_id} ${kind === "ack" ? "확인(ACK)" : "해결"} 처리 — 감사 로그 기록`,
    );
    if (r) {
      void al.mutate();
      revalidateKey("lanes-alerts");
    }
  };
  return (
    <div className="panel" id="alerts">
      <div className="panel-h">
        <h2 className="sec">
          <Bell className="i" />
          시스템 알림 · 장애
        </h2>
        <span className="r muted" style={{ fontSize: 11 }}>
          OPEN {(al.data ?? []).filter((a) => a.status === "OPEN").length} · ACK {(al.data ?? []).filter((a) => a.status === "ACKNOWLEDGED").length}
        </span>
      </div>
      {(inc.data ?? []).map((i) => (
        <div key={i.incident_id} className={`note t-${i.status === "RESOLVED" ? "success" : "retry"}`} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b className="mono">{i.incident_id}</b>
            <Pill tone={i.severity === "SEV2" ? "failed" : "retry"}>{i.severity}</Pill>
            <Pill tone={i.status === "RESOLVED" ? "success" : "running"}>{i.status === "RESOLVED" ? "해결됨" : "모니터링"}</Pill>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>
              {fmt.dateKo(i.started_at)} {fmt.hm(i.started_at)} · 지휘 {opName(i.commander)}
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            <b>{i.title}</b>
          </div>
          <div className="muted" style={{ marginTop: 2 }}>
            {i.summary}
          </div>
          {i.timeline?.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 11 }}>
                타임라인 {i.timeline.length}건
              </summary>
              <ul className="tl" style={{ marginTop: 6 }}>
                {i.timeline.map((t, n) => (
                  <li key={n}>
                    <span className="mono muted">{fmt.hm(t.at)}</span>
                    <span>{t.text}</span>
                  </li>
                ))}
              </ul>
              {i.postmortem && (
                <div className="muted" style={{ fontSize: 11 }}>
                  Postmortem: {i.postmortem}
                </div>
              )}
            </details>
          )}
        </div>
      ))}
      {al.isLoading ? (
        <div className="skel" style={{ height: 200 }} />
      ) : list.length ? (
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>시각</th>
                <th>심각도</th>
                <th>알림</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.alert_id}>
                  <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
                    {fmt.date(a.opened_at) === today ? <span className="dim">오늘</span> : fmt.date(a.opened_at).slice(5).replace("-", "/")}
                    <br />
                    {fmt.time(a.opened_at)}
                  </td>
                  <td>
                    <Pill tone={a.severity === "CRITICAL" ? "failed" : a.severity === "INFO" ? "queued" : "retry"} icon={<AlertTriangle />}>
                      {a.severity}
                    </Pill>
                  </td>
                  <td>
                    <b>{a.title}</b>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {a.message}
                    </div>
                  </td>
                  <td>
                    <Pill tone={a.status === "OPEN" ? "failed" : a.status === "RESOLVED" ? "success" : "queued"}>{a.status}</Pill>
                    {a.acknowledged_by && (
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {opName(a.acknowledged_by)}
                      </div>
                    )}
                  </td>
                  <td className="r" style={{ whiteSpace: "nowrap" }}>
                    {a.status === "OPEN" && (
                      <button type="button" className="btn sm" disabled={!can("cancel")} onClick={() => void mutateAlert(a, "ack")}>
                        ACK
                      </button>
                    )}{" "}
                    {a.status !== "RESOLVED" && (
                      <button type="button" className="btn sm ghost" disabled={!can("cancel")} onClick={() => void mutateAlert(a, "resolve")}>
                        해결
                      </button>
                    )}
                    {a.dead_letter_id && (
                      <>
                        {" "}
                        <Link className="btn sm" href={`/lanes/dlq?id=${a.dead_letter_id}`}>
                          DLQ
                        </Link>
                      </>
                    )}
                    {a.workflow_id && (
                      <>
                        {" "}
                        <Link className="btn sm ghost" href={wfHref(a.workflow_id, here)} aria-label="Workflow 열기">
                          <ExternalLink />
                        </Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={<CheckCircle2 className="i" />}>알림 없음</Empty>
      )}
    </div>
  );
}
