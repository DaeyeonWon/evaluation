"use client";
/**
 * /board — language-lane live board (ported from the Lanes design into the Atlas drawing language).
 * Rows = language lanes (Capacity Slots, Backlog, wait), columns = Workflow state-machine phases.
 * Cards migrate between cells (motion layoutId FLIP) as SSE ticks/transitions arrive; tokens run along
 * the state-flow rail; the time river spans the global time range. Column headers / intake sources
 * open the shared stage inspector (?stage=&col=); cards open Workflow detail keeping the range.
 *
 * Range semantics: columns 01–05 are always live; 06–07, the river, the intake and the strip's
 * "period" figures follow the selected range.
 */
import clsx from "clsx";
import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  Radio,
  Repeat,
  Search,
  ShieldCheck,
  Target,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CatalogIcon, LangBadge, useTween } from "@/components/shared";
import { componentLabel, languageName, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import {
  LANG_CODES,
  PIPELINE_BY_ID,
  ROOT_PIPELINE_IDS,
  STAGE_BY_ID,
} from "@/lib/catalog";
import {
  api,
  parseAsInt,
  parseAsString,
  useApi,
  useLiveStream,
  useQueryStates,
  useSimNow,
  useStreamEvent,
  useTimeRange,
} from "@/lib/client";
import type {
  LangCode,
  LanguageCapacity,
  StageId,
  TransitionMessage,
  WorkflowSummary,
} from "@/lib/types";
import { StageInspector } from "../canvas/inspector";
import { SheetHead, useReducedMotionSafe, useToast } from "../ui";
import {
  COLS,
  COL_OF,
  iconOf,
  shortPipe,
  shortWf,
  toCard,
  toneOf,
  type Card,
} from "./model";
import { FlowRail } from "./rail";
import { RangeTag, useRangeHref, useRangeLabel } from "./range";
import { River } from "./river";
import "@/styles/atlas-board.css";

const MLink = motion.create(Link);
const LEGEND = [
  ["success", "workflow", "SUCCEEDED"],
  ["running", "workflow", "RUNNING"],
  ["queued", "workflow", "QUEUED"],
  ["retry", "workflow", "RETRY_WAIT"],
  ["failed", "node", "FAILED"],
  ["dlq", "workflow", "DEAD_LETTERED"],
  ["cancelled", "workflow", "CANCELLED"],
] as const;
const PARSERS = {
  stage: parseAsString,
  col: parseAsInt,
  pipeline: parseAsString,
  file: parseAsString,
};

function Tween({
  value,
  f,
}: {
  value: number | null | undefined;
  f?: (v: number) => string;
}) {
  const v = useTween(value ?? 0);
  if (value == null) return <>—</>;
  return <>{f ? f(v) : Math.round(v).toLocaleString("en-US")}</>;
}

// ───────────────────────────────────────────── data ──
function useBoardData(tr: ReturnType<typeof useTimeRange>) {
  const { snapshot } = useLiveStream();
  const activeQ = useApi(
    ["board-wf-active"],
    () => api.workflows({ active: true, pageSize: 500 }),
    { revalidateOn: ["transition"] },
  );
  const rangedQ = useApi(
    ["board-wf-ranged", tr.key],
    () => api.workflows({ ...tr.params, pageSize: 500, sort: "created_asc" }),
    {
      revalidateOn: ["transition"],
      throttleMs: 2500,
    },
  );
  const from = rangedQ.data?.range?.from ?? tr.resolved.from;
  const to = rangedQ.data?.range?.to ?? tr.resolved.to;
  const cards = useMemo(() => {
    const byId = new Map<string, WorkflowSummary>();
    rangedQ.data?.items.forEach((w) => byId.set(w.workflow_id, w));
    activeQ.data?.items.forEach((w) => byId.set(w.workflow_id, w));
    const out = new Map<string, Card>();
    // terminal cards: completed inside the range
    rangedQ.data?.items.forEach((w) => {
      const c = COL_OF[w.status];
      if (c == null || !COLS[c].ranged) return;
      const at = w.completed_at ?? w.updated_at;
      if (at < from || at > to) return;
      out.set(w.workflow_id, toCard(w, undefined));
    });
    // live cards: positions from the tick snapshot (fresher than the list)
    if (snapshot)
      snapshot.active.forEach((a) =>
        out.set(a.workflow_id, toCard(byId.get(a.workflow_id), a)),
      );
    else
      activeQ.data?.items.forEach((w) =>
        out.set(w.workflow_id, toCard(w, undefined)),
      );
    return [...out.values()];
  }, [activeQ.data, rangedQ.data, snapshot, from, to]);
  return {
    snapshot,
    cards,
    summaries: rangedQ.data?.items ?? [],
    facets: rangedQ.data?.facets?.pipeline_id as
      Record<string, number> | undefined,
    from,
    to,
    loading: !snapshot && activeQ.isLoading,
  };
}

// ───────────────────────────────────────────── screen ──
export function BoardScreen() {
  const t = useT("board");
  const locale = useLocale();
  const toast = useToast();
  const tr = useTimeRange();
  const rangeLabel = useRangeLabel(tr.spec, tr.resolved);
  const href = useRangeHref();
  const wfHref = useCallback((id: string) => href(`/workflows/${id}`), [href]);
  const [qs, setQs] = useQueryStates(PARSERS);
  const now = useSimNow();
  const { snapshot, cards, summaries, facets, from, to, loading } =
    useBoardData(tr);

  // URL robustness: an unknown ?stage= is reported and cleared
  const warned = useRef<string | null>(null);
  useEffect(() => {
    if (!qs.stage || STAGE_BY_ID[qs.stage as StageId]) return;
    if (warned.current !== qs.stage)
      toast.err(t("urlStage", { stage: qs.stage }));
    warned.current = qs.stage;
    setQs({ stage: null, col: null });
  }, [qs.stage, setQs, toast, t]);
  const stage =
    qs.stage && STAGE_BY_ID[qs.stage as StageId] ? (qs.stage as StageId) : null;
  const colIdx = stage
    ? qs.col != null && COLS[qs.col]?.stages.includes(stage)
      ? qs.col
      : COLS.findIndex((c) => c.stages.includes(stage))
    : null;
  const openStage = useCallback(
    (s: StageId, col: number) =>
      setQs({ stage: s, col }, { history: stage ? "replace" : "push" }),
    [setQs, stage],
  );
  const closeStage = useCallback(
    () => setQs({ stage: null, col: null }),
    [setQs],
  );

  // file-name search → set of matching workflow ids (all stages, within the range)
  const [fileIn, setFileIn] = useState(qs.file ?? "");
  useEffect(() => {
    const h = setTimeout(() => {
      const v = fileIn.trim();
      if ((qs.file ?? "") !== v) setQs({ file: v || null });
    }, 300);
    return () => clearTimeout(h);
  }, [fileIn, qs.file, setQs]);
  const fileQ = qs.file?.trim() ?? "";
  const searchQ = useApi(
    fileQ ? ["board-file-search", tr.key, fileQ] : null,
    () => api.fileSearch({ ...tr.params, q: fileQ, limit: 1000 }),
    {
      revalidateOn: ["transition"],
      throttleMs: 4000,
    },
  );
  const match = useMemo(() => {
    if (!fileQ || !searchQ.data) return null;
    const ids = new Set<string>();
    const batches = new Set<string>();
    searchQ.data.items.forEach((h) => {
      if (h.workflow_id) ids.add(h.workflow_id);
      if (h.batch_id) batches.add(h.batch_id);
    });
    return { ids, batches, hits: searchQ.data.total };
  }, [fileQ, searchQ.data]);
  const matchIds = useMemo(() => {
    if (!match) return null;
    const s = new Set(match.ids);
    cards.forEach(
      (c) => c.batch_id && match.batches.has(c.batch_id) && s.add(c.id),
    );
    return s;
  }, [match, cards]);

  const pipeline =
    qs.pipeline &&
    (ROOT_PIPELINE_IDS.includes(qs.pipeline) || PIPELINE_BY_ID[qs.pipeline])
      ? qs.pipeline
      : null;
  const shown = useMemo(
    () => (pipeline ? cards.filter((c) => c.pipeline_id === pipeline) : cards),
    [cards, pipeline],
  );
  const onBoard = matchIds ? shown.filter((c) => matchIds.has(c.id)).length : 0;

  const [flash, setFlash] = useState<Record<string, number>>({});
  useStreamEvent("transition", (m) => {
    const k = Date.now();
    setFlash((x) => ({ ...x, [m.workflow_id]: k }));
    setTimeout(
      () =>
        setFlash((x) => (x[m.workflow_id] === k ? omit(x, m.workflow_id) : x)),
      1300,
    );
  });

  return (
    <div className="sheet sheet-in bd-sheet">
      <SheetHead
        dwg={t("dwg")}
        title={t("title")}
        desc={t("desc")}
        acts={<RangeTag label={rangeLabel} />}
      />
      <Strip tr={tr} />
      <River
        summaries={summaries}
        from={from}
        to={to}
        now={now}
        spec={tr.spec}
        rangeLabel={rangeLabel}
        pipeline={pipeline}
        matchIds={matchIds}
        wfHref={wfHref}
      />
      <Intake tr={tr} now={now} onOpen={(s) => openStage(s, 0)} />
      <Filters
        pipeline={pipeline}
        facets={facets}
        onPipeline={(p) => setQs({ pipeline: p })}
        fileIn={fileIn}
        setFileIn={setFileIn}
        searching={!!fileQ && (searchQ.isLoading || fileIn.trim() !== fileQ)}
        match={match}
        fileQ={fileQ}
        onBoard={onBoard}
      />
      <section className="plate flush bd-board-plate">
        <BoardGrid
          cards={shown}
          now={now}
          loading={loading}
          flash={flash}
          openCol={colIdx}
          onOpen={openStage}
          snapshotReady={!!snapshot}
          matchIds={matchIds}
          wfHref={wfHref}
          href={href}
        />
        <div className="bd-foot">
          <span className="bd-eyebrow">{t("legend.title")}</span>
          <div className="bd-legend">
            {LEGEND.map(([k, fam, v]) => (
              <span key={k} className={`tone-${k}`}>
                <i />
                {statusLabel(fam, v, locale)}
              </span>
            ))}
          </div>
          <span className="bd-foot-note">{t("legend.ring")}</span>
          <span className="bd-foot-note bd-live-note">{t("liveNote")}</span>
        </div>
      </section>
      <Feed wfHref={wfHref} />
      {stage ? (
        <StageInspector
          key={colIdx ?? -1}
          stageId={stage}
          onClose={closeStage}
          siblings={colIdx != null ? COLS[colIdx].stages : undefined}
          onStage={(s) => setQs({ stage: s }, { history: "replace" })}
        />
      ) : null}
    </div>
  );
}

function omit<T extends Record<string, unknown>>(o: T, k: string): T {
  const n = { ...o };
  delete n[k];
  return n;
}

// ───────────────────────────────────────────── strip ──
function Strip({ tr }: { tr: ReturnType<typeof useTimeRange> }) {
  const t = useT("board");
  const f = useFmt();
  const { snapshot } = useLiveStream();
  const ov = useApi(
    ["board-overview", tr.key],
    () => api.overview({ ...tr.params }),
    { revalidateOn: ["tick"], throttleMs: 5000, revalidateOnFocus: false },
  ).data;
  const k = snapshot?.kpis;
  const g = snapshot?.capacity.global;
  const r = ov?.inRange;
  const items: {
    ic: ReactNode;
    l: string;
    v: number | null | undefined;
    tone: string | null;
    fm?: (v: number) => string;
    ranged?: boolean;
    slot?: boolean;
  }[] = [
    {
      ic: <Gauge />,
      l: t("strip.globalSlot"),
      v: g?.active,
      tone: null,
      slot: true,
    },
    {
      ic: <CatalogIcon name="loader" />,
      l: t("strip.running"),
      v: k?.running,
      tone: "running",
    },
    { ic: <Clock />, l: t("strip.queued"), v: k?.pending, tone: "queued" },
    {
      ic: <CatalogIcon name="rotate-ccw" />,
      l: t("strip.retryWait"),
      v: k?.retryWaiting,
      tone: "retry",
    },
    {
      ic: <CatalogIcon name="archive-x" />,
      l: t("strip.dlqPending"),
      v: k?.dlqPendingReview,
      tone: "dlq",
    },
    {
      ic: <CheckCircle2 />,
      l: t("strip.completed"),
      v: r?.completed,
      tone: "success",
      ranged: true,
    },
    {
      ic: <Target />,
      l: t("strip.utterances"),
      v: r?.utterancesEvaluated,
      tone: null,
      ranged: true,
    },
    {
      ic: <ShieldCheck />,
      l: t("strip.passRate"),
      v: r?.utterancePassRate != null ? r.utterancePassRate * 100 : null,
      tone: "success",
      fm: (v) => v.toFixed(1) + "%",
      ranged: true,
    },
  ];
  return (
    <div className="kpis bd-strip" aria-label={t("strip.aria")}>
      {items.map((it) => (
        <div
          key={it.l}
          className={clsx("kpi", it.tone && `tone-${it.tone}`)}
          data-tone={it.tone ?? undefined}
        >
          <div className="k">
            {it.ic}
            <span className="bd-strip-l">{it.l}</span>
            <span className={clsx("bd-tag", it.ranged && "rg")}>
              {it.ranged ? t("strip.ranged") : t("strip.live")}
            </span>
          </div>
          <div className="v">
            {it.slot ? (
              g ? (
                <>
                  <Tween value={g.active} />
                  <small>/{g.max}</small>
                </>
              ) : (
                "—"
              )
            ) : (
              <Tween
                value={it.v}
                f={it.fm ?? ((v) => f.number(Math.round(v)))}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────── intake ──
function Intake({
  tr,
  now,
  onOpen,
}: {
  tr: ReturnType<typeof useTimeRange>;
  now: number;
  onOpen: (s: StageId) => void;
}) {
  const t = useT("board");
  const f = useFmt();
  const o = {
    revalidateOn: ["tick" as const],
    throttleMs: 5000,
    revalidateOnFocus: false,
  };
  const g = useApi(
    ["board-stage", "gcs_input", tr.key],
    () => api.stage("gcs_input", { ...tr.params, limit: 1, objects_limit: 1 }),
    o,
  ).data?.metrics;
  const e = useApi(
    ["board-stage", "event_bus", tr.key],
    () => api.stage("event_bus", { ...tr.params, limit: 1, objects_limit: 1 }),
    o,
  ).data?.metrics;
  const i = useApi(
    ["board-stage", "ingress", tr.key],
    () => api.stage("ingress", { ...tr.params, limit: 1, objects_limit: 1 }),
    o,
  ).data?.metrics;
  const n = (v: unknown) => (typeof v === "number" ? f.number(v) : "—");
  const srcs: {
    id: StageId;
    ic: ReactNode;
    name: string;
    big: unknown;
    sub: string;
  }[] = [
    {
      id: "gcs_input",
      ic: <UploadCloud />,
      name: "gs://bixby-utterance-input",
      big: g?.objectsToday,
      sub: t("intake.gcs", {
        utt: n(g?.utterancesToday),
        last:
          typeof g?.lastUploadAt === "number"
            ? f.relative(g.lastUploadAt, now)
            : "—",
      }),
    },
    {
      id: "event_bus",
      ic: <Radio />,
      name: "Eventarc · Pub/Sub",
      big: e?.deliveredToday,
      sub: t("intake.bus", {
        p95:
          typeof e?.p95DeliveryLatencyMs === "number"
            ? f.duration(e.p95DeliveryLatencyMs, { style: "short" })
            : "—",
        backlog: n(e?.subscriptionBacklog),
      }),
    },
    {
      id: "ingress",
      ic: <ShieldCheck />,
      name: "Cloud Run Event Ingress",
      big: i?.validatedToday,
      sub: t("intake.ingress", {
        dup: n(i?.duplicatesIgnoredToday),
        err: n(i?.validationErrorsToday),
      }),
    },
  ];
  return (
    <div className="bd-intake">
      {srcs.map((s, k) => (
        <div key={s.id} className="bd-intake-seg">
          <button
            type="button"
            className="bd-src"
            onClick={() => onOpen(s.id)}
            aria-label={t("intake.open", { name: s.name })}
          >
            <span className="ic">{s.ic}</span>
            <span className="tx">
              <small>{s.name}</small>
              <span>
                <b>{n(s.big)}</b> <span className="muted">{s.sub}</span>
              </span>
            </span>
          </button>
          <span
            className={clsx("bd-wire", k === srcs.length - 1 && "last")}
            aria-hidden
          >
            <i />
            <i />
            <i />
          </span>
        </div>
      ))}
      <span className="bd-intake-end">
        <ArrowRight aria-hidden /> {t("intake.toQueue")}
      </span>
    </div>
  );
}

// ───────────────────────────────────────────── filters ──
function Filters({
  pipeline,
  facets,
  onPipeline,
  fileIn,
  setFileIn,
  searching,
  match,
  fileQ,
  onBoard,
}: {
  pipeline: string | null;
  facets: Record<string, number> | undefined;
  onPipeline: (p: string | null) => void;
  fileIn: string;
  setFileIn: (v: string) => void;
  searching: boolean;
  match: { ids: Set<string>; batches: Set<string>; hits: number } | null;
  fileQ: string;
  onBoard: number;
}) {
  const t = useT("board");
  const locale = useLocale();
  return (
    <div className="bd-filters">
      <div className="bd-fgroup">
        <span className="bd-eyebrow">{t("filter.pipeline")}</span>
        <div
          className="chipset"
          role="group"
          aria-label={t("filter.pipelineAria")}
        >
          <button
            type="button"
            aria-pressed={!pipeline}
            onClick={() => onPipeline(null)}
          >
            {t("filter.all")}
          </button>
          {ROOT_PIPELINE_IDS.map((id) => {
            const def = PIPELINE_BY_ID[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={pipeline === id}
                onClick={() => onPipeline(pipeline === id ? null : id)}
                title={def ? (locale === "ko" ? def.labelKo : def.label) : id}
              >
                <span className="mono">{shortPipe(id)}</span>
                <span className="bd-fc">{facets?.[id] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="bd-fgroup bd-ffile">
        <span className="bd-eyebrow">{t("filter.file")}</span>
        <div className="bd-isearch">
          <Search aria-hidden />
          <input
            type="search"
            value={fileIn}
            onChange={(e) => setFileIn(e.target.value)}
            placeholder={t("filter.filePlaceholder")}
            aria-label={t("filter.fileAria")}
            spellCheck={false}
            autoComplete="off"
          />
          {fileIn ? (
            <button
              type="button"
              className="btn sm ghost icon"
              onClick={() => setFileIn("")}
              aria-label={t("filter.clear")}
            >
              <X />
            </button>
          ) : null}
        </div>
        <span
          className={clsx("bd-fmeta", match && match.hits === 0 && "bd-bad")}
          aria-live="polite"
        >
          {searching
            ? t("filter.searching")
            : match
              ? match.hits
                ? t("filter.fileHits", {
                    hits: match.hits,
                    batches: match.ids.size,
                    onBoard,
                  })
                : t("filter.fileNone", { q: fileQ })
              : null}
        </span>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────── board grid ──
function BoardGrid({
  cards,
  now,
  loading,
  flash,
  openCol,
  onOpen,
  snapshotReady,
  matchIds,
  wfHref,
  href,
}: {
  cards: Card[];
  now: number;
  loading: boolean;
  flash: Record<string, number>;
  openCol: number | null;
  onOpen: (s: StageId, col: number) => void;
  snapshotReady: boolean;
  matchIds: Set<string> | null;
  wfHref: (id: string) => string;
  href: (p: string) => string;
}) {
  const t = useT("board");
  const { snapshot } = useLiveStream();
  const boardRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const buckets = useMemo(() => {
    const b: Record<string, Card[]> = {};
    LANG_CODES.forEach((l) => COLS.forEach((_, i) => (b[l + ":" + i] = [])));
    cards.forEach((w) => {
      const i = COL_OF[w.status];
      if (i == null) return;
      b[w.language + ":" + i]?.push(w);
    });
    COLS.forEach((c, i) =>
      LANG_CODES.forEach((l) => {
        const k = l + ":" + i;
        if (c.ranged)
          b[k].sort(
            (x, y) =>
              (y.completed_at ?? y.updated_at) -
              (x.completed_at ?? x.updated_at),
          );
        else if (c.id === "queue")
          b[k].sort(
            (x, y) =>
              y.priority - x.priority ||
              (x.queued_at ?? 0) - (y.queued_at ?? 0),
          );
        else if (c.id === "run")
          b[k].sort(
            (x, y) =>
              Number(y.status === "RUNNING") - Number(x.status === "RUNNING") ||
              y.pct - x.pct,
          );
        // file-name matches float to the top of their cell
        if (matchIds)
          b[k].sort(
            (x, y) => Number(matchIds.has(y.id)) - Number(matchIds.has(x.id)),
          );
      }),
    );
    return b;
  }, [cards, matchIds]);
  const colCount = (i: number) =>
    LANG_CODES.reduce((s, l) => s + buckets[l + ":" + i].length, 0);
  const capByLang = useMemo(
    () => new Map(snapshot?.capacity.languages.map((c) => [c.code, c]) ?? []),
    [snapshot],
  );
  const orphans = useApi(
    ["board-res-orphan"],
    () => api.reservations({ status: "ORPHANED" }),
    { revalidateOn: ["tick"], throttleMs: 10000, revalidateOnFocus: false },
  ).data;

  return (
    <div className="bd-board-scroll">
      <div className="bd-board" ref={boardRef}>
        <FlowRail boardRef={boardRef} />
        <div className="bd-colh lead">
          <span className="k">
            <Layers aria-hidden /> {t("lane.head")}
          </span>
          <span className="t">{t("lane.title")}</span>
          <span className="s">{t("lane.sub")}</span>
        </div>
        {COLS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={clsx("bd-colh", `tone-${c.tone}`, openCol === i && "on")}
            data-col={i}
            aria-expanded={openCol === i}
            aria-controls={openCol === i ? "atlas-inspector" : undefined}
            aria-label={t("colOpen", { col: t(`cols.${c.id}.t`) })}
            onClick={() => onOpen(c.stages[0], i)}
          >
            <span className="k">
              {c.k} <CatalogIcon name={c.icon} aria-hidden />
              {c.ranged ? (
                <span className="bd-tag rg">{t("colRanged")}</span>
              ) : null}
            </span>
            <span className="t">{t(`cols.${c.id}.t`)}</span>
            <span className="n">
              <Tween value={snapshotReady ? colCount(i) : null} />
            </span>
            <span className="s">{t(`cols.${c.id}.s`)}</span>
            <span className="more">
              {t("colMore")} <ArrowRight aria-hidden />
            </span>
            <span className="tick" />
          </button>
        ))}
        <LayoutGroup id="atlas-board">
          {LANG_CODES.map((code) => (
            <LaneRow
              key={code}
              code={code}
              cap={capByLang.get(code)}
              orphan={orphans?.filter((r) => r.language === code).length ?? 0}
              buckets={buckets}
              now={now}
              loading={loading}
              flash={flash}
              matchIds={matchIds}
              reduced={reduced}
              wfHref={wfHref}
              href={href}
            />
          ))}
        </LayoutGroup>
      </div>
    </div>
  );
}

function Slots({ cap, orphan }: { cap: LanguageCapacity; orphan: number }) {
  const t = useT("board");
  const cells: ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < cap.running; i++)
    cells.push(
      <i key={k++} className="on tone-running" title={t("lane.slotRunning")} />,
    );
  for (let i = 0; i < cap.dispatching; i++)
    cells.push(
      <i
        key={k++}
        className="on dim2 tone-running"
        title={t("lane.slotDispatching")}
      />,
    );
  for (let i = 0; i < cap.reserved; i++)
    cells.push(<i key={k++} className="res" title={t("lane.slotReserved")} />);
  for (let i = 0; i < orphan; i++)
    cells.push(<i key={k++} className="orphan" title={t("lane.slotOrphan")} />);
  while (cells.length < cap.max)
    cells.push(<i key={k++} title={t("lane.slotFree")} />);
  const cols = cap.max > 12 ? Math.ceil(cap.max / 2) : Math.max(cap.max, 5);
  return (
    <div
      className="bd-slots"
      style={{ ["--cols" as string]: cols }}
      aria-label={`${cap.active} / ${cap.max} ${t("lane.slot")}`}
      role="img"
    >
      {cells}
    </div>
  );
}

function LaneRow({
  code,
  cap,
  orphan,
  buckets,
  now,
  loading,
  flash,
  matchIds,
  reduced,
  wfHref,
  href,
}: {
  code: LangCode;
  cap: LanguageCapacity | undefined;
  orphan: number;
  buckets: Record<string, Card[]>;
  now: number;
  loading: boolean;
  flash: Record<string, number>;
  matchIds: Set<string> | null;
  reduced: boolean;
  wfHref: (id: string) => string;
  href: (p: string) => string;
}) {
  const t = useT("board");
  const f = useFmt();
  const locale = useLocale();
  const p95bad = cap ? cap.p95WaitSec > cap.p95WaitSloSec : false;
  const name = languageName(code, locale);
  return (
    <>
      <Link
        className={`bd-lanehd lg-${code}`}
        href={href(`/capacity?lang=${code}`)}
        aria-label={t("lane.toCapacity", { lang: name })}
      >
        <div className="nm">
          <b>{name}</b>
          <code>
            {code}
            {cap ? ` · w${cap.priorityWeight}` : ""}
          </code>
          {cap ? (
            <span className={clsx("bd-cst", `s-${cap.status}`)}>
              {statusLabel("capacity", cap.status, locale)}
            </span>
          ) : null}
        </div>
        {cap ? (
          <>
            <div className="cap">
              <b>
                <Tween value={cap.active} />
              </b>
              <span>/ {cap.max}</span>
              <span className="u">
                {t("lane.slot")} · {f.pct(cap.utilization, 0)}
              </span>
            </div>
            <Slots cap={cap} orphan={orphan} />
            <div className="meta">
              <span>
                {t("lane.backlog")}{" "}
                <b
                  className={
                    cap.backlog > cap.backlogAlertThreshold ? "over" : ""
                  }
                >
                  {cap.backlog}
                </b>
              </span>
              <span>
                {t("lane.throughput")} <b>{cap.throughputPerHour}</b>/h
              </span>
              <span>
                {t("lane.avgWait")}{" "}
                <b>{f.duration(cap.avgWaitSec * 1000, { style: "short" })}</b>
              </span>
              <span>
                {t("lane.p95")}{" "}
                <b className={p95bad ? "over" : ""}>
                  {f.duration(cap.p95WaitSec * 1000, { style: "short" })}
                </b>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="skel" style={{ height: 24, width: 80 }} />
            <div className="skel" style={{ height: 9, width: 140 }} />
          </>
        )}
      </Link>
      {COLS.map((c, i) => {
        const list = buckets[code + ":" + i];
        const vis = list.slice(0, c.cap);
        const extra = list.length - vis.length;
        return (
          <div
            key={c.id}
            className={clsx("bd-cell", `c-${c.id}`)}
            data-cell={`${code}:${i}`}
          >
            {vis.map((w) => (
              <BatchCard
                key={w.id}
                w={w}
                mini={!!c.mini}
                now={now}
                flash={!!flash[w.id]}
                hit={matchIds ? matchIds.has(w.id) : null}
                reduced={reduced}
                href={wfHref(w.id)}
              />
            ))}
            {!vis.length ? (
              <span className="zero">{loading ? "…" : "—"}</span>
            ) : null}
            {extra > 0 ? (
              <Link
                className="more"
                href={href(
                  `/explorer?language=${code}&status=${c.states.join(",")}`,
                )}
                title={t("cell.more")}
              >
                +{extra}
                {c.ranged
                  ? ` · ${t("cell.inRange", { count: list.length })}`
                  : ""}
              </Link>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Ring({ pct, text }: { pct: number; text?: string }) {
  const r = 10;
  const C = 2 * Math.PI * r;
  const off = C * (1 - Math.max(0, Math.min(1, pct || 0)));
  return (
    <svg className="bd-ring" viewBox="0 0 26 26" aria-hidden>
      <circle className="bg" cx="13" cy="13" r={r} />
      <circle
        className="fg"
        cx="13"
        cy="13"
        r={r}
        strokeDasharray={C.toFixed(2)}
        strokeDashoffset={off.toFixed(2)}
        transform="rotate(-90 13 13)"
      />
      {text ? (
        <text x="13" y="13.5">
          {text}
        </text>
      ) : null}
    </svg>
  );
}

function useCardSub(w: Card, now: number): string {
  const t = useT("board");
  const f = useFmt();
  const locale = useLocale();
  switch (w.status) {
    case "RUNNING": {
      const leaf = w.node_path ? w.node_path.split("/").pop()! : null;
      return (
        leaf ??
        (w.current_node ? componentLabel(w.current_node, locale) : "aggregate")
      );
    }
    case "DISPATCHING":
      return t("card.dispatching");
    case "QUEUED":
      return t("card.queued", {
        wait: f.duration(now - (w.queued_at ?? w.updated_at), {
          style: "short",
        }),
        priority: w.priority,
      });
    case "RESERVED":
      return t("card.reserved", { ago: f.relative(w.updated_at, now) });
    case "RECEIVED":
      return t("card.received");
    case "VALIDATED":
      return t("card.validated");
    case "RETRY_WAIT":
      return (
        t("card.retry", {
          eta: w.retry_at ? f.relative(w.retry_at, now) : "",
        }) + (w.errorCode ? " · " + w.errorCode : "")
      );
    case "SUCCEEDED":
      return w.passRate != null
        ? `PASS ${Math.round(w.passRate * 100)}%`
        : t("card.committed");
    case "DEAD_LETTERED":
      return w.errorCode ?? "DLQ";
    case "CANCELLED":
      return t("card.cancelled");
    case "TIMED_OUT":
      return t("card.timedOut");
  }
}

function BatchCard({
  w,
  mini,
  now,
  flash,
  hit,
  reduced,
  href,
}: {
  w: Card;
  mini: boolean;
  now: number;
  flash: boolean;
  hit: boolean | null;
  reduced: boolean;
  href: string;
}) {
  const t = useT("board");
  const locale = useLocale();
  const tone = toneOf(w.status);
  const p = w.status === "SUCCEEDED" ? 1 : w.pct || 0;
  const txt =
    w.status === "RUNNING" || w.status === "SUCCEEDED"
      ? String(Math.round(p * 100))
      : w.status === "QUEUED"
        ? "P" + w.priority
        : "";
  const sub = useCardSub(w, now);
  const st = statusLabel("workflow", w.status, locale);
  const title = [
    `${w.id} · ${st}`,
    `${w.pipeline_id ?? "—"} · attempt ${w.attempt}`,
    sub,
    w.object ? w.object : null,
    w.status === "RUNNING" && w.total
      ? t("card.utt", { done: Math.round(p * w.total), total: w.total })
      : null,
    hit ? t("card.match") : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <MLink
      layoutId={reduced ? undefined : `bd-${w.id}`}
      layout={reduced ? false : "position"}
      transition={{ type: "spring", stiffness: 260, damping: 30, mass: 0.8 }}
      href={href}
      className={clsx(
        "bd-card",
        `tone-${tone}`,
        mini && "mini",
        flash && "flash",
        hit === true && "hit",
        hit === false && "dim",
      )}
      aria-label={t("card.aria", {
        id: w.id,
        status: st,
        attempt: w.attempt,
        pipeline: w.pipeline_id ?? "—",
      })}
      title={title}
    >
      <Ring pct={p} text={txt} />
      <span className="bt">
        <span className="id">
          {w.replay ? <Repeat aria-label={t("card.replay")} /> : null}
          {mini ? "#" + shortWf(w.id).split("-").pop() : shortWf(w.id)}
        </span>
        <span className="sb">
          <CatalogIcon name={iconOf(w.status)} aria-hidden />
          <span className="sbt">{sub}</span>
        </span>
      </span>
      <span className="side">
        {w.attempt > 0 ? (
          <span
            className={clsx("att", w.attempt > 1 && "hot")}
            title={`attempt ${w.attempt}/3`}
          >
            A{w.attempt}
          </span>
        ) : null}
        {!mini ? <span className="pp">{shortPipe(w.pipeline_id)}</span> : null}
      </span>
    </MLink>
  );
}

// ───────────────────────────────────────────── feed ──
function Feed({ wfHref }: { wfHref: (id: string) => string }) {
  const t = useT("board");
  const f = useFmt();
  const locale = useLocale();
  const [feed, setFeed] = useState<(TransitionMessage & { k: number })[]>([]);
  const n = useRef(0);
  useStreamEvent("transition", (m) =>
    setFeed((x) => [{ ...m, k: ++n.current }, ...x].slice(0, 8)),
  );
  return (
    <section className="plate bd-feed">
      <header>
        <h2>
          <Zap aria-hidden /> {t("feed.title")}{" "}
          <span className="live-dot" aria-hidden />
        </h2>
        <span className="ref">{t("feed.ref")}</span>
      </header>
      <div className="body">
        <ol className="bd-feed-l" aria-live="off">
          {feed.length ? (
            feed.map((m, i) => (
              <li
                key={m.k}
                className={clsx(i === 0 && "new", `tone-${toneOf(m.to)}`)}
              >
                <span className="tm">{f.time(m.at)}</span>
                <LangBadge lang={m.language} />
                <span className="nm">
                  {m.from
                    ? statusLabel("workflow", m.from, locale)
                    : t("feed.new")}{" "}
                  → <b>{statusLabel("workflow", m.to, locale)}</b>
                </span>
                <Link className="idc" href={wfHref(m.workflow_id)}>
                  {shortWf(m.workflow_id)}
                </Link>
              </li>
            ))
          ) : (
            <li className="muted">{t("feed.waiting")}</li>
          )}
        </ol>
      </div>
    </section>
  );
}
