"use client";
/**
 * S-01 · Global overview. KPI readouts tween from the SSE `tick` snapshot; charts come from
 * /analytics/* and /overview; recent events, alerts (ack / resolve via POST) and incidents are live.
 */
import { AlertTriangle, CheckCircle, Eye, Map as MapIcon, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { CatalogIcon, EChart, LangBadge, fmt, useTween } from "@/components/shared";
import { FAILURE_CATEGORY_META, LANG_CODES, STATES, STATUS_META } from "@/lib/catalog";
import { api, revalidateKey, useApi, useLiveStream, useSimNow } from "@/lib/client";
import type { Alert, FailureCategory, Tone } from "@/lib/types";
import { axisX, axisY, barLabel, baseOpt, catY, opt, tooltip } from "./chart";
import { Plate, Sheet, SheetHead, Skeleton, opName, usePerms, useToast, useReducedMotionSafe } from "./ui";

function Kpi({ label, icon, value, fmtv, sub, tone, href }: { label: string; icon?: string; value: number | null | undefined; fmtv: (v: number) => string; sub: ReactNode; tone?: Tone; href: string }) {
  const v = useTween(value ?? 0, { decimals: Number.isInteger(value ?? 0) ? 0 : 4 });
  return (
    <Link className="kpi" href={href} data-tone={tone ? "" : undefined} style={tone ? { ["--tc" as string]: `var(--st-${tone})` } : undefined}>
      <div className="k">
        {icon ? <CatalogIcon name={icon} style={tone ? { color: `var(--st-${tone})` } : undefined} /> : null}
        {label}
      </div>
      <div className="v">{value == null ? "—" : fmtv(v)}</div>
      <div className="s">{sub}</div>
    </Link>
  );
}

function AlertRow({ a }: { a: Alert }) {
  const now = useSimNow();
  const toast = useToast();
  const { can } = usePerms();
  const tone = a.status === "RESOLVED" ? "success" : a.severity === "CRITICAL" ? "failed" : "retry";
  const act = async (kind: "ack" | "resolve") => {
    try {
      if (kind === "ack") await api.ackAlert(a.alert_id, { note: "Overview에서 확인" });
      else await api.resolveAlert(a.alert_id, { note: "Overview에서 해결 처리" });
      toast.ok(`${a.alert_id} 알림을 ${kind === "ack" ? "확인" : "해결"} 처리했습니다.`);
      revalidateKey("alerts");
    } catch (e) {
      toast.err(e);
    }
  };
  return (
    <motion.div layout="position" className={`tone-${tone}`} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--rule-2)", alignItems: "start" }}>
      <span style={{ color: "var(--tc)", paddingTop: 2 }}>{a.status === "RESOLVED" ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{a.title}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {a.message}
        </div>
        <div className="mono muted" style={{ fontSize: 10.5, marginTop: 2 }}>
          {a.alert_id} · {a.severity} · {a.status} · {fmt.relative(a.opened_at, now)}
          {a.acknowledged_by ? " · 확인 " + opName(a.acknowledged_by) : ""}
          {a.incident_id ? " · " + a.incident_id : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {a.status === "OPEN" ? (
          <button className="btn sm" disabled={!can("cancel")} title={can("cancel") ? undefined : "Operator 이상 권한 필요"} onClick={() => act("ack")}>
            확인
          </button>
        ) : null}
        {a.status !== "RESOLVED" ? (
          <button className="btn sm" disabled={!can("cancel")} onClick={() => act("resolve")}>
            해결
          </button>
        ) : (
          <span className="st-pill" style={{ ["--tone" as string]: "var(--st-success)" }}>
            해결됨
          </span>
        )}
        {a.dead_letter_id ? (
          <Link className="btn sm" href={`/dlq?sel=${a.dead_letter_id}`}>
            DLQ
          </Link>
        ) : null}
        {a.workflow_id ? (
          <Link className="btn sm" href={`/workflows/${a.workflow_id}`}>
            상세
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}

export function OverviewScreen() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const { snapshot } = useLiveStream();
  const ovQ = useApi(["overview"], () => api.overview(), { revalidateOn: ["transition"], throttleMs: 2500 });
  const o = snapshot?.kpis ?? ovQ.data;
  const dist = snapshot?.counts ?? ovQ.data?.statusDistribution;
  const thr = useApi(["throughput-5m"], () => api.throughput({ granularity: "5m" }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const thr7 = useApi(["throughput-7d"], () => api.throughput({ range: "7d" }), { revalidateOnFocus: false });
  const evQ = useApi(["events", "recent"], () => api.events({ limit: 14 }), { revalidateOn: ["transition"], throttleMs: 2000 });
  const alQ = useApi(["alerts"], () => api.alerts(), { revalidateOn: ["alert"] });
  const incQ = useApi(["incidents"], () => api.incidents(), { revalidateOn: ["alert"] });
  const err = ovQ.data?.errorDistribution7d;
  const errList = err ? (Object.entries(err) as [FailureCategory, number][]).sort((a, b) => b[1] - a[1]) : [];
  const keys = dist ? STATES.filter((s) => dist[s]) : [];
  const open = (alQ.data ?? []).filter((a) => a.status !== "RESOLVED");
  const resolved = (alQ.data ?? []).filter((a) => a.status === "RESOLVED").slice(0, 3);
  const pct = (v: number) => fmt.pct(v, 1);
  const dur = (v: number) => fmt.duration(v, { style: "short" });
  const n = (v: number) => fmt.number(Math.round(v));

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-01 · GLOBAL OVERVIEW"
        title="전체 운영 현황"
        desc="bixby-eval-prod · asia-northeast3 · 실시간 갱신. 숫자를 누르면 해당 화면으로 이동합니다."
        acts={
          <>
            <Link className="btn" href="/">
              <MapIcon />
              캔버스에서 보기
            </Link>
            <Link className="btn" href="/explorer">
              <Search />
              Pipeline 검색
            </Link>
          </>
        }
      />
      <div className="kpis">
        <Kpi label="Running" icon="loader" tone="running" value={o?.running} fmtv={n} href="/?stage=vertex" sub={dist ? `Dispatching ${dist.DISPATCHING ?? 0} · Reserved ${dist.RESERVED ?? 0}` : ""} />
        <Kpi label="Pending" icon="clock" tone="queued" value={o?.pending} fmtv={n} href="/capacity" sub={o && dist ? `Queued ${o.queued} · 수신/검증 ${(dist.RECEIVED ?? 0) + (dist.VALIDATED ?? 0)}` : ""} />
        <Kpi label="Completed (오늘)" icon="check-circle" tone="success" value={o?.completedToday} fmtv={n} href="/results" sub={o ? `실발화 ${fmt.number(o.utterancesEvaluatedToday)} 건 평가` : ""} />
        <Kpi label="Failed (오늘)" icon="x-circle" tone="failed" value={o?.failedToday} fmtv={n} href="/explorer?status=DEAD_LETTERED,TIMED_OUT" sub={o ? `취소 ${o.cancelledToday} 별도` : ""} />
        <Kpi label="Retry Waiting" icon="rotate-ccw" tone="retry" value={o?.retryWaiting} fmtv={n} href="/explorer?status=RETRY_WAIT" sub="backoff 60s → 300s" />
        <Kpi label="DLQ Pending Review" icon="archive-x" tone="dlq" value={o?.dlqPendingReview} fmtv={n} href="/dlq?status=PENDING_REVIEW" sub={o ? `누적 ${o.dlqTotal}` : ""} />
        <Kpi
          label="Overall Success Rate"
          tone={o && (o.successRateToday ?? 1) < 0.995 ? "retry" : "success"}
          value={o?.successRateToday}
          fmtv={pct}
          href="/analytics"
          sub={o ? `7일 ${fmt.pct(o.successRate7d, 1)} · 목표 99.5%` : ""}
        />
        <Kpi label="Avg / p95 처리 시간" value={o?.avgProcessingMs} fmtv={dur} href="/analytics" sub={o ? `p95 ${dur(o.p95ProcessingMs)} · 대기 ${dur(o.avgWaitMs)}` : ""} />
      </div>
      <div className="split s-64">
        <Plate title="Pipeline Throughput" refText="오늘 00:00~ · 5분 단위 완료 Pipeline · BigQuery 집계 · LIVE">
          <EChart
            className="chart"
            ariaLabel="오늘 5분 단위 처리량"
            loading={!thr.data}
            option={(t) => ({
              ...baseOpt(t, reduced),
              xAxis: axisX(t, (thr.data?.ts ?? []).map((x) => fmt.hm(x)), { boundaryGap: true }),
              yAxis: axisY(t, { name: "완료 Pipeline / 5분", minInterval: 1 }),
              tooltip: tooltip(t),
              series: LANG_CODES.map((c) => ({ name: c.toUpperCase(), type: "bar", stack: "a", barWidth: "70%", itemStyle: { color: t.lang[c] }, emphasis: { focus: "series" }, data: thr.data?.byLanguage[c] ?? [] })),
            })}
          />
        </Plate>
        <Plate title="Workflow 상태 분포" refText="현재 상태 · Firestore registry 전체 · 클릭 = Explorer">
          <EChart
            className="chart"
            ariaLabel="Workflow 상태 분포"
            onEvents={{ click: (p) => router.push(`/explorer?status=${keys[(p as { dataIndex: number }).dataIndex]}`) }}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 92, right: 34, top: 8, bottom: 22 } }),
                tooltip: tooltip(t, { trigger: "item" }),
                legend: { show: false },
                xAxis: axisY(t, { minInterval: 1 }),
                yAxis: catY(t, keys.map((k) => STATUS_META[k].label)),
                series: [{ type: "bar", barWidth: 11, cursor: "pointer", data: keys.map((k) => ({ value: dist![k], name: STATUS_META[k].label, itemStyle: { color: t.tone[STATUS_META[k].tone] } })), label: barLabel(t) }],
              })
            }
          />
        </Plate>
      </div>
      <div className="split s-64">
        <Plate title="언어별 처리량 추이" refText="7일 · 시간당 Pipeline · 드래그로 기간 이동">
          <EChart
            className="chart"
            ariaLabel="언어별 7일 처리량 추이"
            loading={!thr7.data}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced),
                xAxis: axisX(t, (thr7.data?.ts ?? []).map((x) => fmt.date(x).slice(5) + " " + fmt.hm(x)), {
                  axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono, interval: 23, formatter: (v: string) => v.split(" ")[0] },
                }),
                yAxis: axisY(t, { name: "Pipeline / h" }),
                dataZoom: [{ type: "inside", start: 55, end: 100 }],
                series: LANG_CODES.map((c) => ({ name: c.toUpperCase(), type: "line", showSymbol: false, smooth: 0.3, lineStyle: { width: 1.4, color: t.lang[c] }, itemStyle: { color: t.lang[c] }, data: thr7.data?.byLanguage[c] ?? [] })),
              })
            }
          />
        </Plate>
        <Plate title="오류 유형별 분포" refText="7일 · 주황 Retry 대상 / 빨강 즉시 DLQ·제한">
          <EChart
            className="chart"
            ariaLabel="오류 유형별 분포"
            onEvents={{ click: (p) => router.push(`/explorer?error_category=${errList[(p as { dataIndex: number }).dataIndex]?.[0]}`) }}
            option={(t) =>
              opt({
                ...baseOpt(t, reduced, { grid: { left: 132, right: 34, top: 8, bottom: 22 } }),
                legend: { show: false },
                tooltip: tooltip(t, { trigger: "item", formatter: (p: { dataIndex: number; name: string; value: number }) => `${p.name}<br><b>${p.value}</b>건 · ${FAILURE_CATEGORY_META[errList[p.dataIndex][0]].policy}` }),
                xAxis: axisY(t, { minInterval: 1 }),
                yAxis: catY(t, errList.map(([c]) => FAILURE_CATEGORY_META[c].label)),
                series: [{ type: "bar", barWidth: 11, cursor: "pointer", data: errList.map(([c, v]) => ({ value: v, itemStyle: { color: FAILURE_CATEGORY_META[c].retryable ? t.tone.retry : t.tone.failed } })), label: barLabel(t) }],
              })
            }
          />
        </Plate>
      </div>
      <div className="split s-55">
        <Plate flush title="최근 이벤트" right={<span className="ref"><span className="live-dot" /> event registry · LIVE</span>}>
          <div className="tbl-wrap" style={{ maxHeight: 460 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>이벤트</th>
                  <th>Workflow</th>
                  <th>언어</th>
                  <th>단계</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {(evQ.data ?? []).map((e) => (
                    <motion.tr
                      key={e.event_id}
                      className="click"
                      initial={reduced ? false : { opacity: 0, backgroundColor: "rgba(13,135,166,0.18)" }}
                      animate={{ opacity: 1, backgroundColor: "rgba(13,135,166,0)" }}
                      transition={{ duration: 1.1 }}
                      onClick={() => e.workflow_id && router.push(`/workflows/${e.workflow_id}`)}
                    >
                      <td className="mono muted">{fmt.time(e.ts)}</td>
                      <td>
                        <span className={`mono sev-${e.severity}`} style={{ fontWeight: 600 }}>
                          {e.name}
                        </span>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {e.label}
                        </div>
                      </td>
                      <td className="idc">{e.workflow_id ?? "system"}</td>
                      <td>{e.language ? <LangBadge lang={e.language} /> : "—"}</td>
                      <td className="mono muted">{e.stage}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {!evQ.data ? <Skeleton /> : null}
          </div>
        </Plate>
        <Plate flush title="시스템 알림 및 장애 현황" refText={`${open.length} OPEN · §7.5`}>
          <div style={{ maxHeight: 470, overflow: "auto" }}>
            <div className="grp-t" style={{ paddingTop: 10 }}>
              진행 중인 알림 · {open.length}
            </div>
            {alQ.data ? open.map((a) => <AlertRow key={a.alert_id} a={a} />) : <Skeleton />}
            {alQ.data && !open.length ? <div className="empty"><b>열린 알림이 없습니다</b></div> : null}
            <div className="grp-t">최근 해결</div>
            {resolved.map((a) => (
              <AlertRow key={a.alert_id} a={a} />
            ))}
            <div className="grp-t">인시던트</div>
            {(incQ.data ?? []).map((i) => (
              <div key={i.incident_id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--rule-2)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="st-pill" style={{ ["--tone" as string]: i.status === "RESOLVED" ? "var(--st-success)" : "var(--st-retry)" }}>
                    {i.status === "RESOLVED" ? <CheckCircle size={12} /> : <Eye size={12} />}
                    {i.status}
                  </span>
                  <b style={{ fontSize: 13 }}>{i.title}</b>
                  <span className="chip">{i.severity}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {i.summary}
                </div>
                <div className="mono muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                  {i.incident_id} · 지휘 {opName(i.commander)} · 시작 {fmt.dateTime(i.started_at)}
                  {i.resolved_at ? " · 종료 " + fmt.dateTime(i.resolved_at) : ""}
                </div>
              </div>
            ))}
          </div>
        </Plate>
      </div>
    </Sheet>
  );
}
