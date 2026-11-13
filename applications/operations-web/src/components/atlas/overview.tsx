"use client";
/**
 * S-01 · Global overview. Two kinds of numbers, labelled as such:
 *   LIVE  — current state (Running, Pending, Retry wait, DLQ pending review) from the SSE `tick` snapshot
 *   range — everything counted over the global period (GET /overview → inRange, /analytics/throughput,
 *           /events, /alerts, /incidents with ?range= / ?from=&to=)
 * Alerts ack / resolve via POST; every in-page link keeps the period.
 */
import { AlertTriangle, CheckCircle, Eye, Map as MapIcon, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { CatalogIcon, EChart, LangBadge, useTween } from "@/components/shared";
import { eventLabel, failureCategoryLabel, failureCategoryPolicy, stageLabel, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { FAILURE_CATEGORY_META, LANG_CODES, STATES, STATUS_META } from "@/lib/catalog";
import { api, revalidateKey, useApi, useLiveStream, useSimNow, useTimeRange } from "@/lib/client";
import type { Alert, FailureCategory, LangCode, Tone } from "@/lib/types";
import { axisX, axisY, barLabel, baseOpt, catY, opt, tooltip } from "./chart";
import { RangeEmpty, RangeTag, useRangeHref, useRangeLabel } from "./time-range";
import { ErrorNote, Plate, Sheet, SheetHead, Skeleton, opName, usePerms, useToast, useReducedMotionSafe } from "./ui";

const HOUR = 3_600_000;

function Kpi({
  label,
  icon,
  value,
  fmtv,
  sub,
  tone,
  href,
  live,
}: {
  label: string;
  icon?: string;
  value: number | null | undefined;
  fmtv: (v: number) => string;
  sub: ReactNode;
  tone?: Tone;
  href: string;
  live?: boolean;
}) {
  const t = useT("overview");
  const v = useTween(value ?? 0, { decimals: Number.isInteger(value ?? 0) ? 0 : 4 });
  return (
    <Link className="kpi" href={href} data-tone={tone ? "" : undefined} style={tone ? { ["--tc" as string]: `var(--st-${tone})` } : undefined}>
      <div className="k">
        {icon ? <CatalogIcon name={icon} style={tone ? { color: `var(--st-${tone})` } : undefined} /> : null}
        <span className="kl">{label}</span>
        {live ? (
          <span className="live-tag kpi-tag" title={t("kpi.liveHint")}>
            <span className="live-dot" />
            LIVE
          </span>
        ) : (
          <span className="kpi-tag rng" title={t("kpi.rangeHint")}>
            {t("kpi.range")}
          </span>
        )}
      </div>
      <div className="v">{value == null ? "—" : fmtv(v)}</div>
      <div className="s">{sub}</div>
    </Link>
  );
}

function AlertRow({ a }: { a: Alert }) {
  const now = useSimNow();
  const toast = useToast();
  const t = useT("overview");
  const f = useFmt();
  const locale = useLocale();
  const rh = useRangeHref();
  const { can } = usePerms();
  const allowed = can("workflow:cancel") || can("dlq:replay") || can("capacity:write");
  const tone = a.status === "RESOLVED" ? "success" : a.severity === "CRITICAL" ? "failed" : "retry";
  const act = async (kind: "ack" | "resolve") => {
    try {
      if (kind === "ack") await api.ackAlert(a.alert_id, { note: t("alerts.ackNote") });
      else await api.resolveAlert(a.alert_id, { note: t("alerts.resolveNote") });
      toast.ok(kind === "ack" ? t("alerts.acked", { id: a.alert_id }) : t("alerts.resolvedToast", { id: a.alert_id }));
      revalidateKey("alerts");
    } catch (e) {
      toast.err(e);
    }
  };
  return (
    <motion.div layout="position" className={`ov-alert tone-${tone}`}>
      <span style={{ color: "var(--tc)", paddingTop: 2 }}>{a.status === "RESOLVED" ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{a.title}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {a.message}
        </div>
        <div className="mono muted" style={{ fontSize: 10.5, marginTop: 2 }}>
          {a.alert_id} · {statusLabel("severity", a.severity, locale)} · {statusLabel("alert", a.status, locale)} · {f.relative(a.opened_at, now)}
          {a.acknowledged_by ? " · " + t("alerts.ackBy", { name: opName(a.acknowledged_by) }) : ""}
          {a.incident_id ? " · " + a.incident_id : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {a.status === "OPEN" ? (
          <button className="btn sm" disabled={!allowed} title={allowed ? undefined : t("alerts.needPerm")} onClick={() => act("ack")}>
            {t("alerts.ack")}
          </button>
        ) : null}
        {a.status !== "RESOLVED" ? (
          <button className="btn sm" disabled={!allowed} title={allowed ? undefined : t("alerts.needPerm")} onClick={() => act("resolve")}>
            {t("alerts.resolve")}
          </button>
        ) : (
          <span className="st-pill" style={{ ["--tone" as string]: "var(--st-success)" }}>
            {statusLabel("alert", "RESOLVED", locale)}
          </span>
        )}
        {a.dead_letter_id ? (
          <Link className="btn sm" href={rh(`/dlq?sel=${a.dead_letter_id}`)}>
            DLQ
          </Link>
        ) : null}
        {a.workflow_id ? (
          <Link className="btn sm" href={rh(`/workflows/${a.workflow_id}`)}>
            {t("alerts.detail")}
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}

export function OverviewScreen() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const t = useT("overview");
  const f = useFmt();
  const locale = useLocale();
  const tr = useTimeRange();
  const rh = useRangeHref();
  const L = useRangeLabel();
  const { snapshot } = useLiveStream();
  const P = tr.params;
  const ovQ = useApi(["overview", tr.key], () => api.overview(P), { revalidateOn: ["transition"], throttleMs: 2500 });
  const live = snapshot?.kpis ?? ovQ.data;
  const liveDist = snapshot?.counts ?? ovQ.data?.statusDistribution;
  const R = ovQ.data?.inRange;
  const thr = useApi(["throughput", "ov", tr.key], () => api.throughput({ ...P, granularity: "auto" }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const evQ = useApi(["events", "recent", tr.key], () => api.eventsPage({ ...P, limit: 14 }), { revalidateOn: ["transition"], throttleMs: 2000 });
  const alQ = useApi(["alerts", tr.key], () => api.alertsPage(P), { revalidateOn: ["alert"] });
  const incQ = useApi(["incidents", tr.key], () => api.incidentsPage(P), { revalidateOn: ["alert"] });

  const err = R?.errorDistribution;
  const errList = err ? (Object.entries(err) as [FailureCategory, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
  const dist = R?.statusDistribution;
  const keys = dist ? STATES.filter((s) => dist[s]) : [];
  const alerts = alQ.data?.items ?? [];
  const open = alerts.filter((a) => a.status !== "RESOLVED");
  const resolved = alerts.filter((a) => a.status === "RESOLVED").slice(0, 3);
  const langRows = R ? LANG_CODES.map((c) => [c, R.byLanguage[c] ?? { created: 0, succeeded: 0, failed: 0, successRate: null }] as const) : [];
  const pct = (v: number) => f.pct(v, 1);
  const dur = (v: number) => f.duration(v, { style: "short" });
  const n = (v: number) => f.number(Math.round(v));
  const spanH = (L.resolved.to - L.resolved.from) / HOUR;
  const thrTs = thr.data?.ts ?? [];
  const xLabel = (x: number) => (spanH <= 26 ? f.hm(x) : `${f.date(x).slice(5)} ${f.hm(x)}`);
  const gran = thr.data?.granularity === "5m" ? t("throughput.per5m") : t("throughput.perHour");
  const statusName = (s: string) => statusLabel("workflow", s, locale);

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-01 · GLOBAL OVERVIEW"
        title={t("title")}
        desc={
          <>
            {t("desc")} <RangeTag />
          </>
        }
        acts={
          <>
            <Link className="btn" href={rh("/")}>
              <MapIcon />
              {t("acts.canvas")}
            </Link>
            <Link className="btn" href={rh("/explorer")}>
              <Search />
              {t("acts.explorer")}
            </Link>
          </>
        }
      />
      <ErrorNote error={ovQ.error} />
      <div className="kpis">
        <Kpi
          live
          label="Running"
          icon="loader"
          tone="running"
          value={live?.running}
          fmtv={n}
          href={rh("/?stage=vertex")}
          sub={liveDist ? t("kpi.runningSub", { dispatching: liveDist.DISPATCHING ?? 0, reserved: liveDist.RESERVED ?? 0 }) : ""}
        />
        <Kpi
          live
          label="Pending"
          icon="clock"
          tone="queued"
          value={live?.pending}
          fmtv={n}
          href={rh("/capacity")}
          sub={live && liveDist ? t("kpi.pendingSub", { queued: live.queued, received: (liveDist.RECEIVED ?? 0) + (liveDist.VALIDATED ?? 0) }) : ""}
        />
        <Kpi live label="Retry wait" icon="rotate-ccw" tone="retry" value={live?.retryWaiting} fmtv={n} href={rh("/explorer?status=RETRY_WAIT")} sub={t("kpi.retrySub")} />
        <Kpi
          live
          label="DLQ pending review"
          icon="archive-x"
          tone="dlq"
          value={live?.dlqPendingReview}
          fmtv={n}
          href={rh("/dlq?status=PENDING_REVIEW")}
          sub={R ? t("kpi.dlqSub", { created: R.dlqCreated }) : ""}
        />
        <Kpi
          label={t("kpi.completed")}
          icon="check-circle"
          tone="success"
          value={R?.completed}
          fmtv={n}
          href={rh("/results")}
          sub={R ? t("kpi.completedSub", { count: f.number(R.utterancesEvaluated) }) : ""}
        />
        <Kpi
          label={t("kpi.failed")}
          icon="x-circle"
          tone="failed"
          value={R?.failed}
          fmtv={n}
          href={rh("/explorer?status=DEAD_LETTERED,TIMED_OUT&range_by=updated")}
          sub={R ? t("kpi.failedSub", { dlq: R.deadLettered, timeout: R.timedOut, cancelled: R.cancelled }) : ""}
        />
        <Kpi
          label={t("kpi.success")}
          tone={R && (R.successRate ?? 1) < 0.995 ? "retry" : "success"}
          value={R?.successRate}
          fmtv={pct}
          href={rh("/analytics")}
          sub={R ? t("kpi.successSub", { retry: R.retryRate == null ? "—" : f.pct(R.retryRate, 1) }) : ""}
        />
        <Kpi
          label={t("kpi.duration")}
          value={R?.avgProcessingMs}
          fmtv={dur}
          href={rh("/analytics")}
          sub={R ? t("kpi.durationSub", { p95: dur(R.p95ProcessingMs), wait: dur(R.avgWaitMs) }) : ""}
        />
      </div>
      <div className="split s-64">
        <Plate title={t("throughput.title")} right={<RangeTag prefix={gran} />}>
          <EChart
            className="chart"
            ariaLabel={t("throughput.title")}
            loading={!thr.data}
            option={(tk) => ({
              ...baseOpt(tk, reduced),
              xAxis: axisX(tk, thrTs.map(xLabel), { boundaryGap: true }),
              yAxis: axisY(tk, { name: t("throughput.axis", { unit: gran }), minInterval: 1 }),
              tooltip: tooltip(tk),
              series: LANG_CODES.map((c) => ({
                name: c.toUpperCase(),
                type: "bar",
                stack: "a",
                barWidth: "70%",
                itemStyle: { color: tk.lang[c] },
                emphasis: { focus: "series" },
                data: thr.data?.byLanguage[c] ?? [],
              })),
            })}
          />
        </Plate>
        <Plate title={t("status.title")} refText={t("status.ref")}>
          {dist && !keys.length ? (
            <RangeEmpty title={t("status.empty")} hint={t("empty.widen")} />
          ) : (
            <EChart
              className="chart"
              ariaLabel={t("status.title")}
              loading={!dist}
              onEvents={{ click: (p) => router.push(rh(`/explorer?status=${keys[(p as { dataIndex: number }).dataIndex]}`)) }}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced, { grid: { left: 104, right: 40, top: 8, bottom: 22 } }),
                  tooltip: tooltip(tk, { trigger: "item" }),
                  legend: { show: false },
                  xAxis: axisY(tk, { minInterval: 1 }),
                  yAxis: catY(tk, keys.map(statusName)),
                  series: [
                    {
                      type: "bar",
                      barWidth: 11,
                      cursor: "pointer",
                      data: keys.map((k) => ({ value: dist![k], name: statusName(k), itemStyle: { color: tk.tone[STATUS_META[k].tone] } })),
                      label: barLabel(tk),
                    },
                  ],
                })
              }
            />
          )}
        </Plate>
      </div>
      <div className="split s-64">
        <Plate title={t("lang.title")} refText={t("lang.ref")}>
          <EChart
            className="chart"
            ariaLabel={t("lang.title")}
            loading={!R}
            onEvents={{ click: (p) => router.push(rh(`/explorer?language=${langRows[(p as { dataIndex: number }).dataIndex]?.[0]}`)) }}
            option={(tk) =>
              opt({
                ...baseOpt(tk, reduced, { grid: { left: 46, right: 14, top: 36, bottom: 28 } }),
                xAxis: axisX(
                  tk,
                  langRows.map(([c]) => c.toUpperCase()),
                  { boundaryGap: true },
                ),
                yAxis: axisY(tk, { minInterval: 1, name: t("lang.axis") }),
                tooltip: tooltip(tk, { trigger: "axis", axisPointer: { type: "shadow" } }),
                series: [
                  {
                    name: t("lang.succeeded"),
                    type: "bar",
                    stack: "l",
                    barWidth: 34,
                    cursor: "pointer",
                    itemStyle: { color: tk.tone.success },
                    data: langRows.map(([, v]) => v.succeeded),
                  },
                  {
                    name: t("lang.failed"),
                    type: "bar",
                    stack: "l",
                    cursor: "pointer",
                    itemStyle: { color: tk.tone.failed },
                    data: langRows.map(([, v]) => v.failed),
                    label: {
                      show: true,
                      position: "top",
                      color: tk.text,
                      fontFamily: tk.mono,
                      fontSize: 10.5,
                      formatter: (p: { dataIndex: number }) => {
                        const r = langRows[p.dataIndex]?.[1].successRate;
                        return r == null ? "—" : f.pct(r, 1);
                      },
                    },
                  },
                  {
                    name: t("lang.created"),
                    type: "line",
                    symbol: "rect",
                    symbolSize: 7,
                    lineStyle: { width: 0 },
                    itemStyle: { color: tk.muted },
                    data: langRows.map(([, v]) => v.created),
                  },
                ],
              })
            }
          />
          <div className="ov-langs">
            {langRows.map(([c, v]) => (
              <Link key={c} href={rh(`/explorer?language=${c}`)} className={`ov-lang lg-${c}`}>
                <LangBadge lang={c as LangCode} />
                <span className="mono">{t("lang.cell", { created: v.created, ok: v.succeeded, fail: v.failed })}</span>
              </Link>
            ))}
          </div>
        </Plate>
        <Plate title={t("errors.title")} refText={t("errors.ref")}>
          {err && !errList.length ? (
            <RangeEmpty title={t("errors.empty")} />
          ) : (
            <EChart
              className="chart"
              ariaLabel={t("errors.title")}
              loading={!err}
              onEvents={{ click: (p) => router.push(rh(`/explorer?error_category=${errList[(p as { dataIndex: number }).dataIndex]?.[0]}`)) }}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced, { grid: { left: locale === "en" ? 156 : 132, right: 34, top: 8, bottom: 22 } }),
                  legend: { show: false },
                  tooltip: tooltip(tk, {
                    trigger: "item",
                    formatter: (p: { dataIndex: number; name: string; value: number }) =>
                      `${p.name}<br><b>${p.value}</b> · ${failureCategoryPolicy(errList[p.dataIndex][0], locale)}`,
                  }),
                  xAxis: axisY(tk, { minInterval: 1 }),
                  yAxis: catY(
                    tk,
                    errList.map(([c]) => failureCategoryLabel(c, locale)),
                  ),
                  series: [
                    {
                      type: "bar",
                      barWidth: 11,
                      cursor: "pointer",
                      data: errList.map(([c, v]) => ({ value: v, itemStyle: { color: FAILURE_CATEGORY_META[c].retryable ? tk.tone.retry : tk.tone.failed } })),
                      label: barLabel(tk),
                    },
                  ],
                })
              }
            />
          )}
        </Plate>
      </div>
      <div className="split s-55">
        <Plate
          flush
          title={t("events.title")}
          right={
            <span className="ref">
              <span className="live-dot" /> {evQ.data ? t("events.ref", { count: f.number(evQ.data.total) }) : "event registry"}
            </span>
          }
        >
          <div className="tbl-wrap" style={{ maxHeight: 460 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>{t("events.cols.time")}</th>
                  <th>{t("events.cols.event")}</th>
                  <th>Workflow</th>
                  <th>{t("events.cols.lang")}</th>
                  <th>{t("events.cols.stage")}</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {(evQ.data?.items ?? []).map((e) => (
                    <motion.tr
                      key={e.event_id}
                      className="click"
                      initial={reduced ? false : { opacity: 0, backgroundColor: "rgba(13,135,166,0.18)" }}
                      animate={{ opacity: 1, backgroundColor: "rgba(13,135,166,0)" }}
                      transition={{ duration: 1.1 }}
                      onClick={() => e.workflow_id && router.push(rh(`/workflows/${e.workflow_id}`))}
                    >
                      <td className="mono muted">{spanH <= 26 ? f.time(e.ts) : f.dateTime(e.ts).slice(5, 16)}</td>
                      <td>
                        <span className={`mono sev-${e.severity}`} style={{ fontWeight: 600 }}>
                          {e.name}
                        </span>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {eventLabel(e.name, locale)}
                        </div>
                      </td>
                      <td className="idc">{e.workflow_id ?? "system"}</td>
                      <td>{e.language ? <LangBadge lang={e.language} /> : "—"}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {e.stage ? stageLabel(e.stage, locale) : "—"}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {!evQ.data ? <Skeleton /> : !evQ.data.items.length ? <RangeEmpty title={t("events.empty")} hint={t("empty.widen")} /> : null}
          </div>
        </Plate>
        <Plate flush title={t("alerts.title")} refText={alQ.data ? t("alerts.ref", { count: open.length }) : undefined}>
          <div style={{ maxHeight: 470, overflow: "auto" }}>
            <div className="grp-t" style={{ paddingTop: 10 }}>
              {t("alerts.open", { count: open.length })}
            </div>
            {alQ.data ? open.map((a) => <AlertRow key={a.alert_id} a={a} />) : <Skeleton />}
            {alQ.data && !open.length ? (
              <RangeEmpty
                title={t("alerts.none")}
                outside={alQ.data.openOutsideRange ? t("alerts.outside", { count: alQ.data.openOutsideRange }) : undefined}
              />
            ) : alQ.data?.openOutsideRange ? (
              <div className="ov-outside">{t("alerts.outside", { count: alQ.data.openOutsideRange })}</div>
            ) : null}
            {resolved.length ? <div className="grp-t">{t("alerts.recentResolved")}</div> : null}
            {resolved.map((a) => (
              <AlertRow key={a.alert_id} a={a} />
            ))}
            <div className="grp-t">{t("incidents.title")}</div>
            {incQ.data && !incQ.data.items.length ? <div className="empty">{t("incidents.none")}</div> : null}
            {(incQ.data?.items ?? []).map((i) => (
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
                  {i.incident_id} · {t("incidents.commander", { name: opName(i.commander) })} · {t("incidents.started", { at: f.dateTime(i.started_at) })}
                  {i.resolved_at ? " · " + t("incidents.ended", { at: f.dateTime(i.resolved_at) }) : ""}
                </div>
              </div>
            ))}
          </div>
        </Plate>
      </div>
    </Sheet>
  );
}
