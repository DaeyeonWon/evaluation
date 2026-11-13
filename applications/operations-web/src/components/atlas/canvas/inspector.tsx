"use client";
/**
 * U3 · Stage inspector. Opens for ANY stage and is used by two hosts:
 *   - the canvas (/) as a resizable grid column:   <Inspector stage onClose onWidth />
 *   - the live board (/board) as a right drawer:   <StageInspector stageId onClose siblings? onStage? />
 * Tabs: batches in the stage (→ Workflow detail) · objects (file-name search, server ?q=, match
 * highlighting) · events as Pub/Sub envelopes (expandable JSON) · live log stream (SSE `log` +
 * `event` + `transition`) · metrics (vertex broken down by pipeline). All data follows the global
 * time range (URL ?range= / ?from=&to=).
 *
 * URL state (both hosts): ?tab= (wf | gcs | ev | log | met; "gcs" is the objects tab, "obj" is
 * accepted as an alias; default wf is omitted) and ?q= (objects-tab file-name filter, debounced).
 * Deep links such as /?stage=gcs_input&tab=gcs&q=batch-0007 open pre-filtered.
 */
import clsx from "clsx";
import { Search, X } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { LangBadge, StatusPill } from "@/components/shared";
import {
  languageName,
  stageDescription,
  stageLabel,
  stageService,
  type Locale,
  type MessageKey,
  type Schema,
  type Translator,
} from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import {
  PIPELINE_BY_ID,
  STAGE_BY_ID,
  STAGES,
  STATE_TO_STAGE,
} from "@/lib/catalog";
import {
  api,
  parseAsString,
  useApi,
  useQueryStates,
  useSimNow,
  useStreamEvent,
  useTimeRange,
} from "@/lib/client";
import type { LocaleFmt } from "@/lib/format";
import type {
  FileSearchHit,
  LogEntry,
  StageId,
  WorkflowEvent,
} from "@/lib/types";
import { useRangeHref, useRangeLabel } from "../board/range";
import { Empty, JsonView, useReducedMotionSafe } from "../ui";
import "@/styles/atlas-board.css";

const STAGE_SVC: Record<StageId, string> = {
  gcs_input: "cloud-storage",
  event_bus: "eventarc",
  registry_queue: "firestore",
  scheduler: "scheduler",
  workflows: "pipeline-orchestrator",
  vertex: "vertex-ai-pipelines",
  results: "result-commit",
  retry: "retry-controller",
  dlq: "dlq-manager",
  ingress: "event-ingress",
};
const ADR: Partial<Record<StageId, string>> = {
  workflows: "ADR-001",
  registry_queue: "ADR-003",
  results: "ADR-004",
  scheduler: "ADR-002",
};
const OBJECTS_LIMIT = 100;
const TABS = ["wf", "obj", "ev", "log", "met"] as const;
/** URL spelling of each tab (the objects tab is "gcs" in links from the canvas search and /files). */
const TAB_URL: Record<(typeof TABS)[number], string | null> = { wf: null, obj: "gcs", ev: "ev", log: "log", met: "met" };
const URL_TAB: Record<string, (typeof TABS)[number]> = { wf: "wf", gcs: "obj", obj: "obj", ev: "ev", log: "log", met: "met" };
const INSPECTOR_URL = { tab: parseAsString, q: parseAsString };
type Tab = (typeof TABS)[number];

type TI = Translator<MessageKey<Schema["inspector"]>>;

function fmtMetric(
  k: string,
  v: unknown,
  now: number,
  f: LocaleFmt,
  t: TI,
): string {
  if (v == null || (typeof v === "number" && !Number.isFinite(v)))
    return /At$/.test(k) ? t("metric.none") : "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : t("metric.emptyList");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  const n = v as number;
  if (/At$/.test(k)) return `${f.dateTimeLabel(n)} · ${f.relative(n, now)}`;
  if (/Ms$/.test(k)) return f.duration(n, { style: "short" });
  if (/Sec$/.test(k)) return f.duration(n * 1000, { style: "short" });
  if (/Bytes|bytes/.test(k)) return f.bytes(n);
  if (/Rate|rate/.test(k)) return f.pct(n, 1);
  return f.number(n);
}

function stageLogMatch(stage: StageId, l: LogEntry): boolean {
  if (stage === "gcs_input" || stage === "event_bus")
    return l.service === "event-ingress" && l.event_type === "EVENT_RECEIVED";
  if (stage === "retry")
    return (
      l.service === "pipeline-orchestrator" &&
      /retry|RETRY|backoff/.test(l.message)
    );
  if (stage === "workflows")
    return l.service === "dispatcher" || l.service === "pipeline-orchestrator";
  return STAGE_BY_ID[stage].services.includes(l.service);
}
function eventMatch(stage: StageId, e: WorkflowEvent) {
  return (
    e.stage === stage ||
    (stage === "event_bus" && e.name === "EVENT_PUBLISHED") ||
    (stage === "gcs_input" && e.name === "GCS_OBJECT_FINALIZED")
  );
}
interface Line {
  key: string;
  ts: number;
  severity: string;
  comp: string;
  msg: string;
  fresh?: boolean;
}
const evLine = (e: WorkflowEvent, fresh?: boolean): Line => ({
  key: "ev:" + e.event_id,
  ts: e.ts,
  severity: e.severity || "INFO",
  comp: "event-registry",
  msg: `${e.name}${e.workflow_id ? " · " + e.workflow_id : ""}${e.pipeline_id ? " · " + e.pipeline_id : ""}`,
  fresh,
});
const logLine = (l: LogEntry, fresh?: boolean): Line => ({
  key: l.log_id,
  ts: l.ts,
  severity: l.severity,
  comp: l.component || l.service,
  msg: l.message,
  fresh,
});

/** Render `text` with <mark> over the server's match ranges for one field. */
export function Highlight({
  text,
  ranges,
  field,
  offset = 0,
}: {
  text: string;
  ranges: FileSearchHit["match_ranges"];
  field: FileSearchHit["match_ranges"][number]["field"];
  offset?: number;
}) {
  const rs = ranges
    .filter((r) => r.field === field)
    .sort((a, b) => a.start - b.start);
  if (!rs.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  rs.forEach((r, i) => {
    const s = Math.max(last, r.start + offset);
    const e = Math.min(text.length, r.end + offset);
    if (e <= s) return;
    if (s > last) out.push(text.slice(last, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    last = e;
  });
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function EventRow({
  e,
  fresh,
  t,
  f,
}: {
  e: WorkflowEvent;
  fresh?: boolean;
  t: TI;
  f: LocaleFmt;
}) {
  const [open, setOpen] = useState(false);
  const msg = {
    message: {
      messageId: e.event_id,
      publishTime: e.timestamp,
      attributes: {
        event_type: e.name,
        stage: e.stage,
        source: e.source,
        language: e.language,
        pipeline_id: e.pipeline_id,
        pipeline_job_id: e.pipeline_job_id,
        node_path: e.node_path,
        correlation_id: e.correlation_id,
        trace_id: e.trace_id,
      },
      data: e.payload,
    },
    subscription: "projects/bixby-eval-prod/subscriptions/ops-event-registry",
  };
  return (
    <div
      className="evrow"
      style={fresh ? { animation: "at-rowflash 1.4s ease-out" } : undefined}
    >
      <button
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        aria-label={t(open ? "events.collapse" : "events.expand", {
          name: e.name,
        })}
      >
        <span className="et">{f.time(e.ts)}</span>
        <span className={`en sev-${e.severity}`}>{e.name}</span>
        <span className="ew">
          {f.shortWorkflowId(e.workflow_id ?? "system")}
        </span>
      </button>
      {open ? <JsonView value={msg} className="wrap" /> : null}
    </div>
  );
}

/* ─────────────────────────────── metrics ── */
const PIPE_COLS = [
  "running",
  "runs",
  "succeeded",
  "failed",
  "successRate",
  "avgDurationSec",
] as const;
function MetricTable({
  k,
  v,
  t,
  f,
  locale,
}: {
  k: string;
  v: Record<string, Record<string, unknown>>;
  t: TI;
  f: LocaleFmt;
  locale: Locale;
}) {
  const rows = Object.entries(v).sort(([, a], [, b]) =>
    a.kind === b.kind
      ? Number(b.runs ?? 0) - Number(a.runs ?? 0)
      : a.kind === "root"
        ? -1
        : 1,
  );
  return (
    <div className="bd-mt">
      <div className="bd-mt-h">{t.dynamic(`metrics.${k}`, undefined, k)}</div>
      <div className="tbl-wrap">
        <table className="t bd-mt-t">
          <thead>
            <tr>
              <th>{t("metric.pipeline")}</th>
              {PIPE_COLS.map((c) => (
                <th key={c} className="r">
                  {t(`metric.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, r]) => {
              const def = PIPELINE_BY_ID[id];
              const sr =
                typeof r.successRate === "number" ? r.successRate : null;
              const byNode = (r.runningByNode ?? {}) as Record<string, number>;
              return (
                <tr key={id}>
                  <td>
                    <span
                      className={clsx("bd-kind", r.kind === "sub" && "sub")}
                    >
                      {r.kind === "sub" ? "SUB" : "ROOT"}
                    </span>{" "}
                    <span
                      className="idc"
                      title={
                        def ? (locale === "ko" ? def.labelKo : def.label) : id
                      }
                    >
                      {id}
                    </span>
                    {Object.keys(byNode).length ? (
                      <div className="bd-mt-nodes">
                        {Object.entries(byNode).map(([n, c]) => (
                          <span key={n}>
                            {n} <b>{c}</b>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="r mono">{f.number(Number(r.running ?? 0))}</td>
                  <td className="r mono">{f.number(Number(r.runs ?? 0))}</td>
                  <td className="r mono">
                    {f.number(Number(r.succeeded ?? 0))}
                  </td>
                  <td
                    className={clsx("r mono", Number(r.failed) > 0 && "bd-bad")}
                  >
                    {f.number(Number(r.failed ?? 0))}
                  </td>
                  <td className="r mono">
                    {sr == null ? "—" : f.pct(sr, 0)}
                    {sr != null ? (
                      <span className="bd-mt-bar" aria-hidden>
                        <i style={{ width: `${sr * 100}%` }} />
                      </span>
                    ) : null}
                  </td>
                  <td className="r mono">
                    {typeof r.avgDurationSec === "number" &&
                    r.avgDurationSec > 0
                      ? f.duration(r.avgDurationSec * 1000, { style: "short" })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricBars({
  k,
  v,
  t,
  f,
  locale,
}: {
  k: string;
  v: Record<string, number>;
  t: TI;
  f: LocaleFmt;
  locale: Locale;
}) {
  const rows = Object.entries(v).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const name = (key: string) =>
    k === "byLanguage" ? `${languageName(key, locale)} · ${key}` : key;
  return (
    <div className="bd-mt">
      <div className="bd-mt-h">{t.dynamic(`metrics.${k}`, undefined, k)}</div>
      {rows.length ? (
        <ul className="bd-mbars">
          {rows.map(([key, n]) => (
            <li key={key}>
              <span className="nm" title={key}>
                {name(key)}
              </span>
              <span className="br" aria-hidden>
                <i style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <b>{f.number(n)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted bd-small">{t("metric.emptyList")}</div>
      )}
    </div>
  );
}

function Metrics({
  metrics,
  now,
  t,
  f,
  locale,
}: {
  metrics: Record<string, unknown>;
  now: number;
  t: TI;
  f: LocaleFmt;
  locale: Locale;
}) {
  const scalars: [string, unknown][] = [];
  const blocks: [string, ReactNode][] = [];
  for (const [k, v] of Object.entries(metrics)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const vals = Object.values(v as Record<string, unknown>);
      if (
        vals.length &&
        vals.every((x) => x && typeof x === "object" && !Array.isArray(x))
      )
        blocks.push([
          k,
          <MetricTable
            key={k}
            k={k}
            v={v as Record<string, Record<string, unknown>>}
            t={t}
            f={f}
            locale={locale}
          />,
        ]);
      else if (vals.every((x) => typeof x === "number"))
        blocks.push([
          k,
          <MetricBars
            key={k}
            k={k}
            v={v as Record<string, number>}
            t={t}
            f={f}
            locale={locale}
          />,
        ]);
      else
        blocks.push([
          k,
          <div className="bd-mt" key={k}>
            <div className="bd-mt-h">
              {t.dynamic(`metrics.${k}`, undefined, k)}
            </div>
            <JsonView value={v} className="wrap" />
          </div>,
        ]);
    } else scalars.push([k, v]);
  }
  // the pipeline breakdown is the headline for the vertex stage; show it first
  blocks.sort(
    (a, b) => Number(b[0] === "byPipeline") - Number(a[0] === "byPipeline"),
  );
  return (
    <>
      <div className="mgrid">
        {scalars.map(([k, v]) => (
          <div key={k}>
            <div className="k">{t.dynamic(`metrics.${k}`, undefined, k)}</div>
            <div
              className={clsx(
                "v",
                typeof v === "string" && v.length > 24 && "obj-v",
              )}
            >
              {fmtMetric(k, v, now, f, t)}
            </div>
          </div>
        ))}
      </div>
      {blocks.map(([, n]) => n)}
    </>
  );
}

/* ─────────────────────────────── objects ── */
function ObjectRow({
  o,
  t,
  f,
  href,
}: {
  o: FileSearchHit;
  t: TI;
  f: LocaleFmt;
  href: (p: string) => string;
}) {
  const prefix = `gs://${o.bucket}/`;
  return (
    <div className="obj bd-obj">
      <span className="bd-obj-top">
        <span className={`bd-okind k-${o.kind}`}>
          {t(`objects.kind.${o.kind}`)}
        </span>
        {o.language ? <LangBadge lang={o.language} /> : null}
        {o.current_status ? (
          <StatusPill status={o.current_status} size="xs" />
        ) : null}
      </span>
      <span className="on">
        <span className="muted">{prefix}</span>
        <Highlight text={o.object} ranges={o.match_ranges} field="object" />
      </span>
      <span className="om">
        {o.generation ? <span>gen {o.generation}</span> : null}
        {o.size > 0 ? <span>{f.bytes(o.size)}</span> : null}
        <span>{f.dateTimeLabel(o.updated, { seconds: true })}</span>
        {o.ref ? <span title={t("objects.ref")}>{o.ref}</span> : null}
      </span>
      {o.workflow_id || o.batch_id ? (
        <span className="om">
          {o.workflow_id ? (
            <Link href={href(`/workflows/${o.workflow_id}`)}>
              <Highlight
                text={o.workflow_id}
                ranges={o.match_ranges}
                field="workflow_id"
              />
            </Link>
          ) : null}
          {o.batch_id ? (
            <span>
              <Highlight
                text={o.batch_id}
                ranges={o.match_ranges}
                field="batch_id"
              />
            </span>
          ) : null}
          {o.pipeline_job_id && o.pipeline_job_id.includes(".") ? (
            <span title="pipeline_job_id">
              {o.pipeline_job_id.split(".").slice(1).join(".")}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── panel ── */
interface PanelProps {
  stage: StageId;
  onClose: () => void;
  onWidth?: (w: number) => void;
  /** stages that share the host's column (board) → segmented switcher in the head */
  siblings?: StageId[];
  onStage?: (s: StageId) => void;
  /** drawer host (board) instead of the canvas grid column */
  floating?: boolean;
}

function InspectorPanel({
  stage,
  onClose,
  onWidth,
  siblings,
  onStage,
  floating,
}: PanelProps) {
  const t = useT("inspector");
  const f = useFmt();
  const locale = useLocale();
  const now = useSimNow();
  const reduced = useReducedMotionSafe();
  const tr = useTimeRange();
  const rangeLabel = useRangeLabel(tr.spec, tr.resolved);
  const href = useRangeHref();
  // tab + objects filter live in the URL (deep links: ?tab=gcs&q=…); typing is local and debounced
  const [url, setUrl] = useQueryStates(INSPECTOR_URL);
  const tab: Tab = URL_TAB[url.tab ?? ""] ?? "wf";
  const setTab = useCallback((k: Tab) => setUrl({ tab: TAB_URL[k] }), [setUrl]);
  const q = url.q?.trim() ?? "";
  const [qIn, setQIn] = useState(q);
  // follow outside changes of ?q= (canvas search box, back/forward) without clobbering typing
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) {
    setSeenQ(q);
    if (qIn.trim() !== q) setQIn(q);
  }
  useEffect(() => {
    const v = qIn.trim();
    if (v === q) return;
    const h = setTimeout(() => setUrl({ q: v || null }), 250);
    return () => clearTimeout(h);
  }, [qIn, q, setUrl]);

  const st = STAGE_BY_ID[stage];
  const qr = useApi(
    ["stage-detail", stage, tr.key, q],
    () =>
      api.stage(stage, {
        ...tr.params,
        limit: 60,
        q: q || undefined,
        objects_limit: OBJECTS_LIMIT,
      }),
    { revalidateOn: ["tick"], throttleMs: 3000 },
  );
  const d = qr.data?.stage.id === stage ? qr.data : undefined;
  const [liveEv, setLiveEv] = useState<WorkflowEvent[]>([]);
  const [liveLines, setLiveLines] = useState<Line[]>([]);
  const lastLog = useRef(0);
  const logBox = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useStreamEvent("log", (l) => {
    if (!stageLogMatch(stage, l)) return;
    lastLog.current = Date.now();
    setLiveLines((x) => [...x, logLine(l, true)].slice(-200));
  });
  useStreamEvent("event", (e) => {
    if (!eventMatch(stage, e)) return;
    lastLog.current = Date.now();
    setLiveEv((x) => [e, ...x].slice(0, 80));
    setLiveLines((x) => [...x, evLine(e, true)].slice(-200));
  });
  // state transitions that enter or leave this stage (the registry's view of the stage's traffic)
  useStreamEvent("transition", (m) => {
    const fromStage = m.from ? STATE_TO_STAGE[m.from] : null;
    const enters = m.stage === stage && fromStage !== stage;
    const leaves = fromStage === stage && m.stage !== stage;
    const within = m.stage === stage && fromStage === stage;
    if (!enters && !leaves && !within) return;
    lastLog.current = Date.now();
    const dir = enters
      ? t("log.enter")
      : leaves
        ? t("log.leave", { stage: stageLabel(m.stage, locale) })
        : t("log.change");
    setLiveLines((x) =>
      [
        ...x,
        {
          key: `tr:${m.workflow_id}:${m.to}:${m.at}`,
          ts: m.at,
          severity:
            m.to === "DEAD_LETTERED" || m.to === "TIMED_OUT"
              ? "ERROR"
              : m.to === "RETRY_WAIT"
                ? "WARNING"
                : "INFO",
          comp: `${STAGE_SVC[stage]}/state`,
          msg: `${m.workflow_id} ${m.from ?? "∅"} → ${m.to} · ${dir} · attempt ${m.workflow.attempt}`,
          fresh: true,
        },
      ].slice(-200),
    );
  });
  useStreamEvent("job", (j) => {
    if (stage !== "vertex" || j.depth === 0) return;
    lastLog.current = Date.now();
    setLiveLines((x) =>
      [
        ...x,
        {
          key: `job:${j.job_id}:${j.to}:${j.at}`,
          ts: j.at,
          severity:
            j.to === "FAILED"
              ? "ERROR"
              : j.to === "CANCELLED"
                ? "WARNING"
                : "INFO",
          comp: `${j.pipeline_id}@${j.pipeline_version}`,
          msg: `${j.job_id.split(".").slice(1).join(".")} ${j.from ?? "∅"} → ${j.to}${j.error_code ? " · " + j.error_code : ""} · ${j.workflow_id}`,
          fresh: true,
        },
      ].slice(-200),
    );
  });
  useStreamEvent("tick", (tk) => {
    if (Date.now() - lastLog.current < 2500 || !d) return;
    lastLog.current = Date.now();
    const pick = Object.entries(d.metrics)
      .filter(([, v]) => v == null || typeof v !== "object")
      .slice(0, 3)
      .map(([k, v]) => `${k}=${fmtMetric(k, v, tk.now, f, t)}`)
      .join(" · ");
    setLiveLines((x) =>
      [
        ...x,
        {
          key: "hb:" + tk.tick,
          ts: tk.now,
          severity: "DEBUG",
          comp: `${STAGE_SVC[stage]}/monitor`,
          msg: t("log.heartbeat", { metrics: pick || t("log.noChange") }),
          fresh: true,
        },
      ].slice(-200),
    );
  });

  const events = useMemo(() => {
    const seen = new Set<string>();
    return [...liveEv, ...(d?.events ?? [])]
      .filter((e) =>
        seen.has(e.event_id) ? false : (seen.add(e.event_id), true),
      )
      .slice(0, 60);
  }, [liveEv, d]);
  const freshEv = useMemo(
    () => new Set(liveEv.map((e) => e.event_id)),
    [liveEv],
  );
  const lines = useMemo(() => {
    const seen = new Set<string>();
    const base = [
      ...(d?.logs ?? []).map((l) => logLine(l)),
      ...(d?.events ?? []).slice(0, 30).map((e) => evLine(e)),
    ];
    return [...base, ...liveLines]
      .filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)))
      .sort((a, b) => a.ts - b.ts)
      .slice(-200);
  }, [d, liveLines]);

  useLayoutEffect(() => {
    const b = logBox.current;
    if (b && atBottom.current) b.scrollTop = b.scrollHeight;
  }, [lines, tab]);

  const order = STAGES.findIndex((s) => s.id === stage) + 1;
  const wfs = useMemo(
    () =>
      d
        ? stage === "results" || stage === "dlq"
          ? d.workflows
              .slice()
              .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0))
              .slice(0, 30)
          : d.workflows.slice(0, 40)
        : [],
    [d, stage],
  );
  const objs = d?.objects ?? [];
  const searching = q !== qIn.trim();

  // resizable grip (both hosts)
  const gripRef = useRef<HTMLDivElement>(null);
  const [gripOn, setGripOn] = useState(false);
  useEffect(() => {
    const g = gripRef.current;
    if (!g || !onWidth) return;
    let sx = 0;
    let sw = 0;
    const mv = (e: PointerEvent) =>
      onWidth(
        Math.max(
          340,
          Math.min(
            Math.min(860, window.innerWidth - 40),
            sw + (sx - e.clientX),
          ),
        ),
      );
    const up = () => {
      setGripOn(false);
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    const down = (e: PointerEvent) => {
      sx = e.clientX;
      sw = g.parentElement?.getBoundingClientRect().width ?? 440;
      setGripOn(true);
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
      e.preventDefault();
    };
    g.addEventListener("pointerdown", down);
    return () => g.removeEventListener("pointerdown", down);
  }, [onWidth]);

  const counts: Record<Tab, ReactNode> = {
    wf: d ? d.workflows.length : "…",
    obj: d ? `${objs.length}${objs.length >= OBJECTS_LIMIT ? "+" : ""}` : "…",
    ev: events.length,
    log: lines.length,
    met: d ? Object.keys(d.metrics).length : "…",
  };

  return (
    <motion.aside
      className={clsx("insp", floating && "bd-floating")}
      id="atlas-inspector"
      aria-label={t("aria.panel", { stage: stageLabel(stage, locale) })}
      initial={reduced ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {onWidth ? (
        <div
          ref={gripRef}
          className={clsx("insp-grip", gripOn && "on")}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("aria.resize")}
          tabIndex={0}
          onKeyDown={(e) => {
            const cur =
              gripRef.current?.parentElement?.getBoundingClientRect().width ??
              440;
            if (e.key === "ArrowLeft") onWidth(Math.min(860, cur + 24));
            else if (e.key === "ArrowRight") onWidth(Math.max(340, cur - 24));
          }}
        />
      ) : null}
      <div className="insp-head">
        <div className="eyebrow">
          <span>
            STAGE {String(order).padStart(2, "0")} ·{" "}
            {st.kind === "branch" ? "BRANCH" : "MAIN"} · {ADR[stage] ?? "§3.1"}
          </span>
          <button
            className="btn sm ghost icon"
            onClick={onClose}
            aria-label={t("aria.close")}
          >
            <X />
          </button>
        </div>
        {siblings && siblings.length > 1 && onStage ? (
          <div
            className="seg bd-sib"
            role="tablist"
            aria-label={t("aria.siblings")}
          >
            {siblings.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === stage}

                onClick={() => onStage(s)}
              >
                {stageService(s, locale)}
              </button>
            ))}
          </div>
        ) : null}
        <h2>
          {stageLabel(stage, locale)}{" "}
          <small>{stageService(stage, locale)}</small>
        </h2>
        <div className="res">
          {st.gcpService} · {st.resource}
        </div>
        <p className="desc">{stageDescription(stage, locale)}</p>
        <div className="bd-insp-range">
          <span className="k">{t("range")}</span> {rangeLabel}
        </div>
      </div>
      <div className="bd-itabs" role="tablist" aria-label={t("aria.tabs")}>
        {TABS.map((k, i) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`insp-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`insp-pane-${k}`}
            onClick={() => setTab(k)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const n =
                TABS[
                  (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) %
                    TABS.length
                ];
              setTab(n);
              document.getElementById(`insp-tab-${n}`)?.focus();
            }}
            tabIndex={tab === k ? 0 : -1}
          >
            <span className="ix">{String(i).padStart(2, "0")}</span>
            {t(`tabs.${k}`)}
            {k === "log" ? <span className="live-dot" aria-hidden /> : null}
            <span className="cnt">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div
        className="insp-body bd-ipane"
        role="tabpanel"
        id={`insp-pane-${tab}`}
        aria-labelledby={`insp-tab-${tab}`}
      >
        {tab === "wf" ? (
          <div className="ib">
            <div className="wfl">
              {wfs.length ? (
                wfs.map((w) => (
                  <Link
                    key={w.workflow_id}
                    href={href(`/workflows/${w.workflow_id}`)}
                  >
                    <LangBadge lang={w.language} />
                    <span style={{ minWidth: 0 }}>
                      <span className="idc">{w.workflow_id}</span>
                      <br />
                      <span className="muted mono" style={{ fontSize: 10.5 }}>
                        {w.pipeline_id}
                        {w.current_node_path
                          ? ` · ${w.current_node_path} · ${f.pct(w.progress.pct, 0)}`
                          : ` · ${w.input.object}`}
                        {w.attempt > 1 ? ` · attempt ${w.attempt}` : ""}
                      </span>
                    </span>
                    <StatusPill status={w.status} size="xs" />
                  </Link>
                ))
              ) : (
                <Empty title={d ? t("wf.empty") : t("loading")} />
              )}
            </div>
          </div>
        ) : null}
        {tab === "obj" ? (
          <div className="ib">
            <div className="bd-isearch">
              <Search aria-hidden />
              <input
                type="search"
                value={qIn}
                onChange={(e) => setQIn(e.target.value)}
                placeholder={t("objects.placeholder")}
                aria-label={t("objects.searchAria", {
                  stage: stageLabel(stage, locale),
                })}
                spellCheck={false}
                autoComplete="off"
              />
              {qIn ? (
                <button
                  type="button"
                  className="btn sm ghost icon"
                  onClick={() => setQIn("")}
                  aria-label={t("objects.clear")}
                >
                  <X />
                </button>
              ) : null}
            </div>
            <div className="bd-isearch-meta" aria-live="polite">
              {!d
                ? t("loading")
                : searching
                  ? t("objects.searching")
                  : q
                    ? t("objects.matches", { count: objs.length, q })
                    : t("objects.all", { count: objs.length })}
              {objs.length >= OBJECTS_LIMIT ? (
                <span className="muted">
                  {" "}
                  · {t("objects.capped", { limit: OBJECTS_LIMIT })}
                </span>
              ) : null}
            </div>
            {objs.length ? (
              objs.map((o) => (
                <ObjectRow
                  key={`${o.uri}:${o.generation}:${o.ref ?? ""}:${o.workflow_id ?? ""}`}
                  o={o}
                  t={t}
                  f={f}
                  href={href}
                />
              ))
            ) : d ? (
              <Empty
                title={q ? t("objects.noMatch", { q }) : t("objects.empty")}
              >
                {q ? t("objects.noMatchHint") : t("objects.emptyHint")}
              </Empty>
            ) : null}
          </div>
        ) : null}
        {tab === "ev" ? (
          <div className="ib">
            {events.length ? (
              events.map((e) => (
                <EventRow
                  key={e.event_id}
                  e={e}
                  fresh={freshEv.has(e.event_id)}
                  t={t}
                  f={f}
                />
              ))
            ) : (
              <Empty title={t("events.empty")} />
            )}
          </div>
        ) : null}
        {tab === "log" ? (
          <div className="ib">
            <div
              className="logstream bd-logstream"
              ref={logBox}
              role="log"
              aria-live="off"
              aria-label={t("tabs.log")}
              onScroll={(e) => {
                const b = e.currentTarget;
                atBottom.current =
                  b.scrollHeight - b.scrollTop - b.clientHeight < 40;
              }}
            >
              {lines.length ? (
                lines.map((l) => (
                  <div key={l.key} className={l.fresh ? "new" : undefined}>
                    <span className="lt">{f.timeMs(l.ts)}</span>{" "}
                    <span className={`sev-${l.severity}`}>
                      {l.severity.padEnd(7, " ")}
                    </span>{" "}
                    <span className="muted">[{l.comp}]</span> {l.msg}
                  </div>
                ))
              ) : (
                <div className="muted">{t("log.waiting")}</div>
              )}
            </div>
          </div>
        ) : null}
        {tab === "met" ? (
          <div className="ib">
            {d ? (
              <Metrics
                metrics={d.metrics}
                now={now}
                t={t}
                f={f}
                locale={locale}
              />
            ) : (
              <Empty title={t("loading")} />
            )}
          </div>
        ) : null}
      </div>
    </motion.aside>
  );
}

/** Canvas host: a resizable grid column (unchanged API). */
export function Inspector({
  stage,
  onClose,
  onWidth,
}: {
  stage: StageId;
  onClose: () => void;
  onWidth: (w: number) => void;
}) {
  return <InspectorPanel stage={stage} onClose={onClose} onWidth={onWidth} />;
}

/**
 * Standalone host: a right-side drawer with scrim, Escape to close and a resizable width.
 * `siblings` + `onStage` add a stage switcher (e.g. the board's 실행 column = Cloud Workflows + Vertex AI).
 */
export function StageInspector({
  stageId,
  onClose,
  siblings,
  onStage,
}: {
  stageId: StageId;
  onClose: () => void;
  siblings?: StageId[];
  onStage?: (s: StageId) => void;
}) {
  const t = useT("inspector");
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button
        type="button"
        className="bd-insp-scrim"
        aria-label={t("aria.close")}
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        className="drawer bd-insp-host"
        style={w ? { width: `min(${w}px, 100%)` } : undefined}
      >
        <InspectorPanel
          key={stageId}
          stage={stageId}
          onClose={onClose}
          onWidth={setW}
          siblings={siblings}
          onStage={onStage}
          floating
        />
      </div>
    </>
  );
}
