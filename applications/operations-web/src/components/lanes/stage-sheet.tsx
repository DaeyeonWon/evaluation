"use client";
/**
 * U3 — Stage sheet (bottom drawer). Opened from board column headers / intake sources.
 * Tabs: 배치 (workflows in the stage) · GCS 객체 (bucket/object/generation/size/time + preview) ·
 * 이벤트 (Event Registry, JSON payloads, live-prepended) · 진행 로그 (live SSE stream) · 메트릭.
 */
import clsx from "clsx";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, ChevronRight, Copy, Folder, Inbox, Layers, Pause, Play, Radio, Terminal, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BUCKETS, EVENT_CATALOG, SEVERITY_META, STAGES, STAGE_BY_ID, STAGE_EDGES, STATUS_META } from "@/lib/catalog";
import { api, useApi, useSimNow, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, StatusPill } from "@/components/shared";
import type { GcsObject, LogEntry, StageDetail, StageId, WorkflowEvent, WorkflowStatus } from "@/lib/types";
import { Empty, ErrorBox, JsonView, LangTag, ProgBar, dur, pct, shortWf, toneOf, useCopy, useHere, wfHref } from "./core";

const TABS = [
  { k: "wf", l: "배치", Icon: Layers },
  { k: "gcs", l: "GCS 객체", Icon: Folder },
  { k: "ev", l: "이벤트", Icon: Radio },
  { k: "log", l: "진행 로그", Icon: Terminal },
  { k: "met", l: "메트릭", Icon: BarChart3 },
] as const;

export function StageSheet({
  stage,
  group,
  title,
  tab,
  onTab,
  onPick,
  onClose,
}: {
  stage: StageId | null;
  group: StageId[];
  title: string;
  tab: string;
  onTab: (t: string) => void;
  onPick: (s: StageId) => void;
  onClose: () => void;
}) {
  const open = !!stage && !!STAGE_BY_ID[stage];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <Fragment key="sheet">
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          <motion.section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="단계 상세"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="sheet-grip" />
            <SheetBody stage={stage!} group={group} title={title} tab={tab} onTab={onTab} onPick={onPick} onClose={onClose} />
          </motion.section>
        </Fragment>
      )}
    </AnimatePresence>
  );
}

function SheetBody({
  stage,
  group,
  title,
  tab,
  onTab,
  onPick,
  onClose,
}: {
  stage: StageId;
  group: StageId[];
  title: string;
  tab: string;
  onTab: (t: string) => void;
  onPick: (s: StageId) => void;
  onClose: () => void;
}) {
  const st = STAGE_BY_ID[stage];
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const q = useApi(["lanes-stage-detail", stage], () => api.stage(stage, { limit: 60 }), { revalidateOn: ["tick"], throttleMs: 3000 });
  const sd = q.data && q.data.stage.id === stage ? q.data : undefined;
  const counts = Object.entries(sd?.counts ?? {}).filter(([, n]) => (n ?? 0) > 0) as [WorkflowStatus, number][];
  const order = STAGES.findIndex((s) => s.id === stage) + 1;
  const [liveEv, setLiveEv] = useState(0);
  useStreamEvent("event", (e) => {
    if (e.stage === stage) setLiveEv((n) => n + 1);
  });
  return (
    <>
      <div className="sheet-h">
        <div className="sheet-title" style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">
            {title || st.label.ko} · Stage {String(order).padStart(2, "0")} · {st.kind === "branch" ? "Branch" : "Main"}
          </div>
          <h3>
            <CatalogIcon name={st.icon} className="i lg" /> {st.label.ko} <small>{st.label.en}</small>
          </h3>
          <div className="svc" style={{ marginTop: 4 }}>
            {st.gcpService} · {st.resource}
          </div>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12, maxWidth: 820 }}>
            {st.description}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            {counts.length ? (
              counts.map(([s, n]) => (
                <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <StatusPill status={s} />
                  <b className="mono" style={{ marginRight: 6 }}>
                    {n}
                  </b>
                </span>
              ))
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>
                {sd ? "Transit 단계 — 상태를 보유하지 않고 최근 30분 배치를 표시합니다" : "불러오는 중…"}
              </span>
            )}
          </div>
        </div>
        <div className="sheet-side">
          <button ref={closeRef} type="button" className="iconbtn" aria-label="닫기" onClick={onClose}>
            <X className="i" />
          </button>
          {group.length > 1 && (
            <div className="stagepick" role="group" aria-label="세부 단계">
              {group.map((g) => (
                <button key={g} type="button" aria-pressed={g === stage} onClick={() => onPick(g)}>
                  <CatalogIcon name={STAGE_BY_ID[g].icon} />
                  {STAGE_BY_ID[g].label.ko}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="sheet-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} onClick={() => onTab(t.k)}>
            <t.Icon className="i sm" />
            {t.l}
            {t.k === "wf" && sd && <span className="c">{sd.workflows.length}</span>}
            {t.k === "gcs" && sd && <span className="c">{sd.gcsObjects.length || "IN"}</span>}
            {t.k === "ev" && sd && <span className="c">{sd.events.length + liveEv}</span>}
            {t.k === "log" && <span className="c live">LIVE</span>}
            {tab === t.k && <motion.span layoutId="ln-sheet-tab" className="uline" />}
          </button>
        ))}
      </div>
      <div className="sheet-b">
        {q.error && !sd ? (
          <ErrorBox error={q.error} retry={() => q.mutate()} />
        ) : !sd ? (
          <div className="skel" style={{ height: 240 }} />
        ) : tab === "gcs" ? (
          <GcsTab sd={sd} />
        ) : tab === "ev" ? (
          <EventsTab sd={sd} />
        ) : tab === "log" ? (
          <LogsTab sd={sd} />
        ) : tab === "met" ? (
          <MetricsTab sd={sd} />
        ) : (
          <WorkflowsTab sd={sd} />
        )}
      </div>
    </>
  );
}

function WorkflowsTab({ sd }: { sd: StageDetail }) {
  const now = useSimNow();
  const here = useHere();
  const ws = sd.workflows.slice().sort((a, c) => c.updated_at - a.updated_at);
  if (!ws.length) return <Empty icon={<Inbox className="i" />}>현재 이 단계에 머무는 배치가 없습니다</Empty>;
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>Workflow</th>
            <th>언어</th>
            <th>상태</th>
            <th className="r">Attempt</th>
            <th>진행</th>
            <th>입력 객체</th>
            <th className="r">대기</th>
            <th className="r">실행</th>
            <th>갱신</th>
          </tr>
        </thead>
        <tbody>
          {ws.map((w) => (
            <tr key={w.workflow_id}>
              <td className="mono">
                <Link className="copy-id link" href={wfHref(w.workflow_id, here)}>
                  {w.workflow_id}
                </Link>
              </td>
              <td>
                <LangTag code={w.language} />
              </td>
              <td>
                <StatusPill status={w.status} />
              </td>
              <td className="r mono">{w.attempt}</td>
              <td style={{ minWidth: 120 }}>
                <ProgBar pct={w.status === "SUCCEEDED" ? 1 : w.progress.pct} tone={toneOf(w.status)} />
              </td>
              <td className="mono trunc muted" title={w.input.uri}>
                {w.input.object}
              </td>
              <td className="r mono">{dur(w.waitMs)}</td>
              <td className="r mono">{dur(w.runMs)}</td>
              <td className="muted">{fmt.relative(w.updated_at, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseGs(uri: string): { bucket: string; name: string } | null {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  return m ? { bucket: m[1], name: m[2] } : null;
}

/** api.qs() drops empty strings, so `delimiter: ""` would fall back to the server default "/" (prefixes only).
 *  A delimiter that never occurs in object names yields the same flat listing. */
const FLAT_DELIM = "|";

function GcsTab({ sd }: { sd: StageDetail }) {
  const here = useHere();
  const derived = !sd.gcsObjects.length;
  const input = useApi(derived ? ["lanes-gcs-input-all"] : null, () => api.gcsObjects({ bucket: BUCKETS.input, delimiter: FLAT_DELIM, limit: 1000 }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const objects: GcsObject[] = useMemo(() => {
    if (!derived) return sd.gcsObjects.slice().reverse();
    const list = input.data?.objects ?? [];
    const byName = new Map(list.map((o) => [o.bucket + "/" + o.name, o]));
    const byWf = new Map(list.filter((o) => o.workflow_id).map((o) => [o.workflow_id!, o]));
    const seen = new Set<string>();
    const out: GcsObject[] = [];
    const push = (o: GcsObject) => {
      const k = o.bucket + "/" + o.name;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(o);
    };
    // 1) batches currently in this stage — fall back to the workflow's own input record when the
    //    (throttled) bucket listing does not have the object yet; the preview row fetches full metadata.
    sd.workflows
      .slice()
      .sort((a, c) => c.updated_at - a.updated_at)
      .forEach((w) => {
        const p = parseGs(w.input.uri);
        if (!p) return;
        const o = byName.get(p.bucket + "/" + p.name);
        push(
          o
            ? { ...o, workflow_id: o.workflow_id ?? w.workflow_id }
            : { bucket: p.bucket, name: p.name, uri: w.input.uri, size: w.input.sizeBytes, generation: "—", metageneration: "—", contentType: "application/x-ndjson", md5Hash: "", crc32c: "", storageClass: "STANDARD", timeCreated: w.created_at, updated: w.created_at, metadata: {}, workflow_id: w.workflow_id },
        );
      });
    // 2) batches that recently passed through (stage events) — keeps quiet stages informative
    sd.events.forEach((e) => {
      const pl = e.payload as { bucket?: string; name?: string };
      const o = (pl?.bucket && pl?.name ? byName.get(pl.bucket + "/" + pl.name) : undefined) ?? (e.workflow_id ? byWf.get(e.workflow_id) : undefined);
      if (o) push({ ...o, workflow_id: o.workflow_id ?? e.workflow_id });
    });
    return out.slice(0, 60);
  }, [derived, sd, input.data]);
  const [open, setOpen] = useState<string | null>(null);
  if (derived && input.isLoading) return <div className="skel" style={{ height: 200 }} />;
  if (!objects.length)
    return (
      <Empty icon={<Folder className="i" />}>
        이 단계는 자체 버킷이 없고, 지금 머무르거나 최근 통과한 배치도 없어 참조할 입력 객체가 없습니다
        <br />
        <span className="dim">입력 객체는 「실발화 입력 업로드」, Artifact는 「평가 파이프라인」, 결과 CSV는 「결과 저장」 단계에서 확인하세요</span>
      </Empty>
    );
  return (
    <>
      {derived && (
        <div className="note" style={{ marginBottom: 8 }}>
          <Folder className="i sm" /> <b>{sd.stage.label.ko}</b> 단계는 자체 버킷이 없고, 머무는 배치 {sd.workflows.length}건과 최근 이벤트로 통과한 배치의 <b>입력 객체</b>를 참조합니다 — gs://{BUCKETS.input} · {objects.length}개
        </div>
      )}
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 11.5 }}>
        행을 누르면 객체 메타데이터와 내용 미리보기가 펼쳐집니다 (GET /api/v1/gcs/object).
      </p>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Object</th>
              <th>Generation</th>
              <th className="r">Size</th>
              <th>생성 시각</th>
              <th>Content-Type</th>
              <th>Workflow</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((o) => {
              const k = o.bucket + "/" + o.name;
              return (
                <Fragment key={k}>
                  <tr className={clsx("click", open === k && "sel")} onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
                    <td className="mono muted">{o.bucket}</td>
                    <td className="mono">{o.name}</td>
                    <td className="mono muted">{o.generation}</td>
                    <td className="r mono">{fmt.bytes(o.size)}</td>
                    <td className="mono">{fmt.dateTime(o.timeCreated)}</td>
                    <td className="mono muted">{o.contentType}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {o.workflow_id ? (
                        <Link className="btn sm ghost mono" href={wfHref(o.workflow_id, here)}>
                          {shortWf(o.workflow_id)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  {open === k && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--surface-2)" }}>
                        <GcsPreview o={o} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GcsPreview({ o }: { o: GcsObject }) {
  const q = useApi(["lanes-gcs-obj", o.bucket, o.name], () => api.gcsObject({ bucket: o.bucket, name: o.name, limit: 6 }), { revalidateOnFocus: false });
  const ob = q.data?.object ?? o;
  return (
    <div className="grid g2">
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Object metadata
        </div>
        <JsonView
          value={{
            uri: ob.uri,
            size: ob.size,
            generation: ob.generation,
            metageneration: ob.metageneration,
            md5Hash: ob.md5Hash,
            crc32c: ob.crc32c,
            storageClass: ob.storageClass,
            timeCreated: fmt.iso(ob.timeCreated),
            updated: fmt.iso(ob.updated),
            metadata: ob.metadata,
          }}
        />
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Content preview
        </div>
        {q.isLoading ? (
          <div className="skel" style={{ height: 160 }} />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <pre className="code" style={{ whiteSpace: "pre-wrap" }}>
            {(q.data?.content ?? "(미리보기 불가)").slice(0, 4000)}
          </pre>
        )}
      </div>
    </div>
  );
}

function evTone(e: WorkflowEvent) {
  return e.severity === "ERROR" || e.severity === "CRITICAL" ? "failed" : e.severity === "WARNING" ? "retry" : "queued";
}

export function EventRow({ e, isNew }: { e: WorkflowEvent; isNew?: boolean }) {
  const [open, setOpen] = useState(false);
  const tone = evTone(e);
  return (
    <div className={clsx("evrow", open && "open", isNew && "new")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mono muted">{fmt.timeMs(e.ts)}</span>
        <span className="chev">
          <ChevronRight className="i sm" />
        </span>
        <span className="mono" style={{ fontWeight: 600, color: `var(--st-${tone})`, overflow: "hidden", textOverflow: "ellipsis" }}>
          {e.name}
        </span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {e.label} {e.language && <LangTag code={e.language} />} <span className="muted mono">{e.workflow_id ? shortWf(e.workflow_id) : "system"}</span>
        </span>
        <span className="mono dim" style={{ fontSize: 10.5 }}>
          {e.source}
        </span>
      </button>
      {open && (
        <JsonView
          value={{
            event_id: e.event_id,
            timestamp: e.timestamp,
            name: e.name,
            stage: e.stage,
            source: e.source,
            severity: e.severity,
            workflow_id: e.workflow_id,
            attempt: e.attempt,
            pipeline_job_id: e.pipeline_job_id,
            correlation_id: e.correlation_id,
            trace_id: e.trace_id,
            payload: e.payload,
          }}
        />
      )}
    </div>
  );
}

function EventsTab({ sd }: { sd: StageDetail }) {
  const [live, setLive] = useState<WorkflowEvent[]>([]);
  useStreamEvent("event", (e) => {
    if (e.stage === sd.stage.id) setLive((xs) => [e, ...xs].slice(0, 200));
  });
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...live, ...sd.events].filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true))).sort((a, b) => b.ts - a.ts);
  }, [live, sd.events]);
  const newIds = useMemo(() => new Set(live.slice(0, 5).map((e) => e.event_id)), [live]);
  return (
    <>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 11.5 }}>
        Event Registry (Firestore) · Pub/Sub 메시지 — 최신순, SSE로 실시간 추가됩니다. 행을 눌러 JSON payload 펼치기.
      </p>
      {all.length ? all.map((e) => <EventRow key={e.event_id} e={e} isNew={newIds.has(e.event_id)} />) : <Empty>이벤트 없음</Empty>}
    </>
  );
}

/** Mirrors the server's STAGE_LOG_FILTER (engine.stageDetail) so live SSE lines match the initial page. */
const STAGE_LOG_FILTER: Record<StageId, (l: LogEntry) => boolean> = {
  gcs_input: (l) => l.event_type === "EVENT_RECEIVED",
  event_bus: (l) => l.event_type === "EVENT_RECEIVED",
  ingress: (l) => l.service === "event-ingress",
  registry_queue: (l) => l.event_type === "QUEUED",
  scheduler: (l) => (l.service === "scheduler" && l.event_type !== "QUEUED") || l.service === "reconciler",
  workflows: (l) => (l.service === "dispatcher" || l.service === "pipeline-orchestrator" || l.event_type === "CANCEL_REQUESTED") && !/^RETRY/.test(l.event_type ?? ""),
  vertex: (l) => l.service === "vertex-ai-pipelines",
  results: (l) => l.service === "result-commit",
  retry: (l) => /^RETRY/.test(l.event_type ?? "") || (l.severity === "WARNING" && l.service === "pipeline-orchestrator"),
  dlq: (l) => l.service === "dlq-manager" || /DEAD_LETTER|REPLAY/.test(l.event_type ?? ""),
};

function logMatch(stage: StageId, lg: LogEntry): boolean {
  const f = STAGE_LOG_FILTER[stage];
  if (f) return f(lg);
  const cat = lg.event_type ? EVENT_CATALOG[lg.event_type] : undefined;
  return (!!cat && cat.stage === stage) || STAGE_BY_ID[stage].services.includes(lg.service);
}

function LogsTab({ sd }: { sd: StageDetail }) {
  const stage = sd.stage.id;
  const copy = useCopy();
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState<LogEntry[]>([]);
  // server page (refetched every few seconds) is merged in, so lines the SSE filter missed still arrive
  const [base, setBase] = useState<LogEntry[]>(() => sd.logs.slice().reverse());
  const [seenLogs, setSeenLogs] = useState(sd.logs);
  if (!paused && seenLogs !== sd.logs) {
    setSeenLogs(sd.logs);
    const ids = new Set(base.map((l) => l.log_id));
    const add = sd.logs.filter((l) => !ids.has(l.log_id));
    if (add.length) setBase([...base, ...add].sort((a, c) => a.ts - c.ts).slice(-400));
  }
  const [lastRx, setLastRx] = useState<number | null>(null);
  useStreamEvent("log", (lg) => {
    if (paused || !logMatch(stage, lg)) return;
    setLive((xs) => [...xs, lg].slice(-400));
    setLastRx(lg.ts);
  });
  const lines = useMemo(() => {
    const seen = new Set<string>();
    return [...base, ...live]
      .filter((l) => (seen.has(l.log_id) ? false : (seen.add(l.log_id), true)))
      .sort((a, c) => a.ts - c.ts)
      .slice(-400);
  }, [base, live]);
  const now = useSimNow();
  const lastTs = lastRx ?? (lines.length ? lines[lines.length - 1].ts : null);
  const boxRef = useRef<HTMLDivElement>(null);
  const nearRef = useRef(true);
  useEffect(() => {
    const b = boxRef.current;
    if (b && nearRef.current) b.scrollTop = b.scrollHeight;
  }, [lines.length]);
  const freshFrom = lines.length - Math.min(live.length, 3);
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <span className="pill t-success">
          <CatalogIcon name={paused ? "circle-dashed" : "loader"} className={paused ? undefined : "spin"} />
          {paused ? "PAUSED" : "LIVE stream"}
        </span>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Cloud Logging · {sd.stage.services.join(", ")} · 수신 <b className="mono">{lines.length}</b>줄 (SSE {live.length})
        </span>
        <button type="button" className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="i sm" /> : <Pause className="i sm" />}
          {paused ? "재개" : "일시정지"}
        </button>
        <button type="button" className="btn sm" onClick={() => void copy(lines.map((l) => JSON.stringify(l)).join("\n"))}>
          <Copy className="i sm" />
          JSONL 복사
        </button>
      </div>
      <div
        className="stream"
        ref={boxRef}
        tabIndex={0}
        aria-label="실시간 로그"
        onScroll={(e) => {
          const b = e.currentTarget;
          nearRef.current = b.scrollHeight - b.scrollTop - b.clientHeight < 60;
        }}
      >
        {lines.map((lg, i) => {
          const tone = SEVERITY_META[lg.severity]?.tone ?? "queued";
          return (
            <div key={lg.log_id} className={clsx("ln", i >= freshFrom && live.length > 0 && "new")}>
              <span className="muted">{fmt.timeMs(lg.ts)}</span>
              <span className={`t-${tone} tc`} style={{ fontWeight: 600 }}>
                {lg.severity}
              </span>
              <span className="svc muted">
                {lg.service}
                {lg.component && lg.component !== lg.service ? "/" + lg.component : ""}
              </span>
              <span className="msg">
                {lg.workflow_id && (
                  <Link className="copy-id link" href={wfHref(lg.workflow_id, "/lanes?stage=" + stage + "&tab=log")}>
                    {shortWf(lg.workflow_id)}
                  </Link>
                )}{" "}
                {lg.message}
              </span>
            </div>
          );
        })}
        <div className="hb" aria-live="off">
          <span className="muted">{fmt.time(now)}</span>
          <span className={paused ? "muted" : "tc t-success"} style={{ fontWeight: 600 }}>
            {paused ? "PAUSED" : "● LIVE"}
          </span>
          <span className="svc muted">stream</span>
          <span className="msg muted">
            {paused ? "일시정지됨 — 재개하면 그동안의 로그를 이어 받습니다" : lastTs ? `마지막 로그 ${fmt.relative(lastTs, now)} · 이 단계 로그 수신 대기 중` : "이 단계 로그 수신 대기 중…"}
          </span>
        </div>
      </div>
    </>
  );
}

const METRIC_LBL: Record<string, string> = {
  objectsToday: "오늘 업로드 객체", bytesToday: "오늘 업로드 용량", utterancesToday: "오늘 발화 수", lastUploadAt: "마지막 업로드", byLanguage: "언어별",
  deliveredToday: "오늘 전달", avgDeliveryLatencyMs: "평균 전달 지연", p95DeliveryLatencyMs: "p95 전달 지연", redeliveriesToday: "재전달", subscriptionBacklog: "Subscription Backlog", deadLetterTopicMessages: "Dead Letter Topic",
  receivedToday: "오늘 수신", validatedToday: "검증 통과", duplicatesIgnoredToday: "중복 무시", validationErrorsToday: "검증 오류", p95RegistrationLatencyMs: "p95 등록 지연", inFlight: "처리 중",
  queued: "대기 중", oldestQueuedAt: "가장 오래된 대기", p95WaitSec: "p95 대기",
  activeSlots: "Active Slot", globalMax: "Global Max", reservationsActive: "Active Reservation", reservationsOrphaned: "Orphaned Reservation", admissionsLastHour: "최근 1시간 Admission", saturatedLanguages: "포화 언어",
  dispatching: "Dispatching", executionsToday: "오늘 Execution", cancelledToday: "오늘 취소", timedOut7d: "7일 Timeout", p95StartLatencyMs: "p95 시작 지연",
  running: "실행 중", runningByComponent: "Component별 실행", utterancesInFlight: "평가 중 발화", gpuInUse: "GPU 사용", gpuQuota: "GPU Quota", avgDurationSec: "평균 실행 시간",
  succeededToday: "오늘 성공", rowsWrittenToday: "오늘 기록 행", csvBytesToday: "오늘 CSV 용량", bqTable: "BigQuery 테이블", passRateToday: "오늘 PASS율", aggregateFile: "집계 파일",
  retryWait: "Retry 대기", retriesToday: "오늘 Retry", retryRate: "Retry 비율", nextRetryAt: "다음 Retry", policy: "Retry 정책",
  pendingReview: "검토 대기", total: "전체", byStatus: "상태별", byCategory: "유형별", replays: "Replay",
};

function MetricVal({ k, v, now }: { k: string; v: unknown; now: number }) {
  if (v == null) return <b>—</b>;
  if (typeof v === "object") {
    if (Array.isArray(v)) return <b className="s">{v.join(", ") || "없음"}</b>;
    if (k === "policy") {
      const p = v as { maxRetries: number; backoffSeconds: number[]; nonRetryable: string[] };
      return (
        <b className="s">
          max {p.maxRetries} retry · backoff {p.backoffSeconds?.join("s / ")}s · 즉시 DLQ {p.nonRetryable?.join(", ")}
        </b>
      );
    }
    return (
      <b className="s">
        <span className="kvs">
          {Object.entries(v as Record<string, unknown>).map(([a, n]) => (
            <span key={a} className="kv1">
              {a} <b>{typeof n === "number" ? fmt.number(n) : String(n)}</b>
            </span>
          ))}
        </span>
      </b>
    );
  }
  if (typeof v === "number") {
    if (/At$/.test(k))
      return (
        <>
          <b>{fmt.relative(v, now)}</b>
          <span className="mono dim">{fmt.time(v)}</span>
        </>
      );
    if (/Ms$/.test(k)) return <b>{dur(v)}</b>;
    if (/Sec$/.test(k)) return <b>{dur(v * 1000)}</b>;
    if (/Bytes|bytes/.test(k)) return <b>{fmt.bytes(v)}</b>;
    if (/Rate|rate/.test(k)) return <b>{pct(v)}</b>;
    return <b>{fmt.number(v)}</b>;
  }
  return <b className="s">{String(v)}</b>;
}

function MetricsTab({ sd }: { sd: StageDetail }) {
  const now = useSimNow();
  const m = sd.metrics ?? {};
  const ent = (Object.entries(sd.counts ?? {}) as [WorkflowStatus, number][]).filter(([, n]) => n > 0);
  const max = Math.max(1, ...ent.map(([, n]) => n));
  return (
    <>
      <div className="mgrid">
        {Object.entries(m).map(([k, v]) => {
          const wide = v != null && typeof v === "object" && !Array.isArray(v) && k !== "byLanguage";
          return (
            <div key={k} className={clsx("m", wide && "wide")}>
              <span>{METRIC_LBL[k] ?? k}</span>
              {k === "byLanguage" && v && typeof v === "object" ? (
                <b className="s">
                  <span className="kvs">
                    {Object.entries(v as Record<string, number>).map(([l, n]) => (
                      <span key={l} className={`lang L-${l}`}>
                        {l} {fmt.number(n)}
                      </span>
                    ))}
                  </span>
                </b>
              ) : (
                <MetricVal k={k} v={v} now={now} />
              )}
            </div>
          );
        })}
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            상태별 분포
          </div>
          {ent.length ? (
            ent.map(([s, n]) => (
              <div key={s} className={`formrow t-${STATUS_META[s].tone}`}>
                <span style={{ width: 110 }}>
                  <StatusPill status={s} />
                </span>
                <span style={{ flex: 1, height: 8, background: "var(--sunken)", borderRadius: 4, overflow: "hidden" }}>
                  <i style={{ display: "block", height: "100%", width: `${(n / max) * 100}%`, background: "var(--tc)", transition: "width .6s" }} />
                </span>
                <b className="mono" style={{ width: 30, textAlign: "right" }}>
                  {n}
                </b>
              </div>
            ))
          ) : (
            <div className="muted">—</div>
          )}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            연결
          </div>
          {STAGE_EDGES.filter((e) => e.from === sd.stage.id || e.to === sd.stage.id).map((e) => (
            <div key={e.from + e.to} className="formrow">
              <span className="mono">
                {e.from} → {e.to}
              </span>
              <span className="muted" style={e.tone ? { color: `var(--st-${e.tone})` } : undefined}>
                {e.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
