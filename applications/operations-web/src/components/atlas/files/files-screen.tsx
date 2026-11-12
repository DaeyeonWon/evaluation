"use client";
/**
 * F-01 · File search. "각 단계별 파일 이름으로 검색" — one query across every orchestration stage
 * (input JSONL, Pub/Sub messages, Firestore docs, reservations, executions, pipeline artifacts incl.
 * child jobs, result CSVs, DLQ input_uri) via GET /api/v1/files/search.
 *
 * URL state: ?q= · ?stage=a,b · ?bucket= · ?language=ko,en · ?status=RUNNING · ?sel=<row key>
 * plus the global period (?range= / ?from=&to=) from the shell picker.
 * Two requests: a facet call without the stage filter (chip counts for all 10 stages) and the
 * result call (≤1000 rows, newest first). Status is filtered client-side (the API has no status param).
 */
import clsx from "clsx";
import {
  ArrowUpRight,
  Copy,
  FileSearch,
  FolderSearch,
  GitBranch,
  Map as MapIcon,
  RotateCcw,
  Search,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CatalogIcon, LangBadge, StatusPill } from "@/components/shared";
import { stageLabel, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import {
  BUCKETS,
  LANG_CODES,
  STAGE_BY_ID,
  STATE_TO_STAGE,
  STATES,
  STATUS_META,
} from "@/lib/catalog";
import {
  api,
  parseAsList,
  parseAsString,
  useApi,
  useQueryStates,
  useSimNow,
  useTimeRange,
} from "@/lib/client";
import type {
  FileSearchHit,
  LangCode,
  StageId,
  WorkflowStatus,
} from "@/lib/types";
import { RangeTag, useRangeHref, useRangeLabel } from "../time-range";
import {
  ErrorNote,
  Plate,
  Sheet,
  SheetHead,
  Skeleton,
  copyText,
  useReducedMotionSafe,
  useToast,
} from "../ui";
import {
  Hl,
  STAGE_ORDER,
  inspectorHref,
  jobHref,
  splitPath,
  stageNo,
} from "./common";

const PARSERS = {
  q: parseAsString,
  stage: parseAsList,
  bucket: parseAsString,
  language: parseAsList,
  status: parseAsList,
  sel: parseAsString,
};
const LIMIT = 1000;
const PAGE = 100;
const BUCKET_LIST = [BUCKETS.input, BUCKETS.artifacts, BUCKETS.results];

export const hitKey = (h: FileSearchHit) =>
  `${h.stage}|${h.uri}|${h.ref ?? ""}`;

export function FilesScreen() {
  const t = useT("files");
  const locale = useLocale();
  const f = useFmt();
  const now = useSimNow();
  const tr = useTimeRange();
  const L = useRangeLabel();
  const rh = useRangeHref();
  const toast = useToast();
  const [fs, setF] = useQueryStates(PARSERS);
  const stages = useMemo(
    () =>
      fs.stage.filter((s): s is StageId =>
        (STAGE_ORDER as string[]).includes(s),
      ),
    [fs.stage],
  );
  const langs = useMemo(
    () =>
      fs.language.filter((l): l is LangCode =>
        (LANG_CODES as string[]).includes(l),
      ),
    [fs.language],
  );
  const statuses = useMemo(
    () =>
      fs.status.filter((s): s is WorkflowStatus =>
        (STATES as string[]).includes(s),
      ),
    [fs.status],
  );
  const q = (fs.q ?? "").trim();

  /* ── query box: draft → debounced URL ── */
  const [draft, setDraft] = useState(fs.q ?? "");
  const written = useRef(fs.q ?? "");
  useEffect(() => {
    if ((fs.q ?? "") !== written.current) {
      written.current = fs.q ?? "";
      setDraft(fs.q ?? "");
    }
  }, [fs.q]);
  useEffect(() => {
    const v = draft.trim();
    if (v === q) return;
    const h = setTimeout(() => {
      written.current = v;
      setF({ q: v || null, sel: null });
    }, 260);
    return () => clearTimeout(h);
  }, [draft, q, setF]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest(
        "input, textarea, select, [contenteditable=true]",
      );
      if (!typing && e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── data ── */
  const base = {
    q,
    bucket: fs.bucket ?? undefined,
    language: langs.length ? langs : undefined,
    ...tr.params,
  };
  const facetQ = useApi(
    ["file-search", "facets", tr.key, q, fs.bucket, langs],
    () => api.fileSearch({ ...base, limit: 1 }),
    { revalidateOn: ["transition"], throttleMs: 8000 },
  );
  const listQ = useApi(
    ["file-search", "list", tr.key, q, fs.bucket, langs, stages],
    () =>
      api.fileSearch({
        ...base,
        stage: stages.length ? stages : undefined,
        limit: LIMIT,
      }),
    {
      revalidateOn: ["transition"],
      throttleMs: 8000,
    },
  );
  const data = listQ.data;
  const facets = facetQ.data;
  const statusCounts = useMemo(() => {
    const c: Partial<Record<WorkflowStatus, number>> = {};
    data?.items.forEach(
      (h) =>
        h.current_status &&
        (c[h.current_status] = (c[h.current_status] ?? 0) + 1),
    );
    return c;
  }, [data]);
  const rows = useMemo(
    () =>
      data
        ? statuses.length
          ? data.items.filter(
              (h) => h.current_status && statuses.includes(h.current_status),
            )
          : data.items
        : [],
    [data, statuses],
  );
  // "show more" resets when the row set changes (state keyed by the rows array)
  const [more, setMore] = useState<{ rows: FileSearchHit[]; n: number }>({
    rows: [],
    n: PAGE,
  });
  const shown = more.rows === rows ? more.n : PAGE;
  const setShown = (fn: (n: number) => number) =>
    setMore({ rows, n: fn(shown) });
  const maxStage = Math.max(
    1,
    ...STAGE_ORDER.map((s) => facets?.byStage[s] ?? 0),
  );
  const sel = useMemo(
    () =>
      fs.sel
        ? (rows.find((h) => hitKey(h) === fs.sel) ??
          data?.items.find((h) => hitKey(h) === fs.sel) ??
          null)
        : null,
    [fs.sel, rows, data],
  );

  const set = (patch: Partial<typeof fs>) => setF({ ...patch, sel: null });
  const toggle = <T extends string>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const anyFilter = !!(
    q ||
    stages.length ||
    fs.bucket ||
    langs.length ||
    statuses.length
  );
  const loading = listQ.isLoading || draft.trim() !== q;

  const copy = useCallback(
    async (uri: string) => {
      if (await copyText(uri)) toast.ok(t("detail.copied", { uri }));
      else toast.err(new Error(t("detail.copyFailed")));
    },
    [toast, t],
  );
  const openRow = (h: FileSearchHit) =>
    setF({ sel: hitKey(h) }, { history: "push" });

  const today = f.date(L.resolved.to);
  const tips: [string, string[]][] = [
    [t("empty.tipName"), ["batch-0042", "results.csv", "eval_summary.json"]],
    [t("empty.tipPath"), [`${today}/ko`, "pipeline_root/wf-"]],
    [t("empty.tipIds"), []],
    [t("empty.tipRange"), []],
    ...(stages.length
      ? ([[t("empty.tipStage"), []]] as [string, string[]][])
      : []),
  ];

  return (
    <Sheet className="fx">
      <SheetHead
        dwg={t("page.dwg")}
        title={t("page.title")}
        desc={t("page.desc")}
        acts={
          <>
            <RangeTag />
            <span className="chip">{t("page.api")}</span>
          </>
        }
      />

      <div className="fx-q">
        <label className="fx-qbox">
          <span className="sr">{t("query.label")}</span>
          <Search aria-hidden />
          <input
            ref={input}
            type="search"
            value={draft}
            placeholder={t("query.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft("")}
            spellCheck={false}
            autoComplete="off"
            title={t("query.shortcut")}
          />
          {loading && (q || draft) ? (
            <span className="spin" aria-label={t("count.loading")} />
          ) : null}
          {draft ? (
            <button
              type="button"
              className="x"
              aria-label={t("query.clear")}
              onClick={() => (setDraft(""), input.current?.focus())}
            >
              <X />
            </button>
          ) : (
            <kbd className="kbd" title={t("query.shortcut")}>
              /
            </kbd>
          )}
        </label>
        <div className="fx-count" aria-live="polite">
          {data ? (
            <>
              <b>{f.number(statuses.length ? rows.length : data.total)}</b>
              {statuses.length
                ? t("count.statusFiltered", { count: rows.length })
                : data.total > data.items.length
                  ? t("count.shown", {
                      total: data.total,
                      shown: data.items.length,
                    })
                  : t("count.matches", { count: data.total })}
            </>
          ) : (
            <span className="muted">{t("count.loading")}</span>
          )}
        </div>
      </div>

      <nav className="fx-stages" aria-label={t("filters.stage")}>
        {STAGE_ORDER.map((s) => {
          const n = facets?.byStage[s] ?? 0;
          const on = stages.includes(s);
          return (
            <button
              key={s}
              type="button"
              className="fx-stage"
              aria-pressed={on}
              data-empty={n === 0}
              title={`${stageLabel(s, locale)} · ${STAGE_BY_ID[s].label.en}`}
              onClick={() => set({ stage: toggle(stages, s) })}
            >
              <span className="no">
                <CatalogIcon name={STAGE_BY_ID[s].icon} aria-hidden />
                {stageNo(s)}
              </span>
              <span className="nm">{stageLabel(s, locale)}</span>
              <span className={clsx("ct", n === 0 && "zero")}>
                {facets ? f.number(n) : "·"}
              </span>
              <span
                className="bar"
                style={{
                  ["--tc" as string]: on ? "var(--accent)" : "var(--ink-3)",
                }}
              >
                <i style={{ width: `${(n / maxStage) * 100}%` }} />
              </span>
            </button>
          );
        })}
      </nav>

      <div className="fx-filters" role="group" aria-label={t("filters.aria")}>
        <label className="grp">
          <span className="lbl">{t("filters.bucket")}</span>
          <select
            className="in mono"
            value={fs.bucket ?? ""}
            onChange={(e) => set({ bucket: e.target.value || null })}
          >
            <option value="">{t("filters.allBuckets")}</option>
            {BUCKET_LIST.map((b) => (
              <option key={b} value={b}>
                gs://{b}
              </option>
            ))}
          </select>
        </label>
        <div className="grp">
          <span className="lbl">{t("filters.language")}</span>
          <div className="chipset">
            {LANG_CODES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={langs.includes(c)}
                onClick={() => set({ language: toggle(langs, c) })}
              >
                <LangBadge lang={c} />
              </button>
            ))}
          </div>
        </div>
        <label className="grp">
          <span className="lbl">{t("filters.status")}</span>
          <select
            className="in"
            value={
              statuses.length === 1
                ? statuses[0]
                : statuses.length
                  ? "_multi"
                  : ""
            }
            onChange={(e) =>
              set({
                status:
                  e.target.value && e.target.value !== "_multi"
                    ? [e.target.value]
                    : [],
              })
            }
          >
            <option value="">{t("filters.anyStatus")}</option>
            {statuses.length > 1 ? (
              <option value="_multi">
                {statuses
                  .map((s) => statusLabel("workflow", s, locale))
                  .join(", ")}
              </option>
            ) : null}
            {STATES.map((s) => (
              <option key={s} value={s}>
                {statusLabel("workflow", s, locale)} · {s}
                {statusCounts[s] ? ` (${statusCounts[s]})` : ""}
              </option>
            ))}
          </select>
        </label>
        {anyFilter ? (
          <button
            type="button"
            className="btn sm ghost reset"
            onClick={() => (
              setDraft(""),
              setF({
                q: null,
                stage: [],
                bucket: null,
                language: [],
                status: [],
                sel: null,
              })
            )}
          >
            <RotateCcw />
            {t("filters.reset")}
          </button>
        ) : null}
      </div>

      <ErrorNote error={listQ.error ?? facetQ.error} />

      <Plate flush>
        {!data ? (
          <Skeleton rows={8} />
        ) : rows.length ? (
          <>
            <div
              className="tbl-wrap fx-tbl-wrap"
              style={{ maxHeight: "calc(100dvh - 160px)" }}
            >
              <table className="t fx-tbl" aria-label={t("table.aria")}>
                <thead>
                  <tr>
                    <th>{t("table.stage")}</th>
                    <th>{t("table.path")}</th>
                    <th className="r">{t("table.generation")}</th>
                    <th className="r">{t("table.size")}</th>
                    <th>{t("table.updated")}</th>
                    <th>{t("table.links")}</th>
                    <th>{t("table.status")}</th>
                    <th aria-label={t("detail.copy")} />
                  </tr>
                </thead>
                <tbody className={clsx(listQ.isValidating && "validating")}>
                  {rows.slice(0, shown).map((h, i) => (
                    <tr
                      key={hitKey(h)}
                      className={clsx("click", fs.sel === hitKey(h) && "sel")}
                      tabIndex={0}
                      aria-label={t("table.open", { uri: h.uri })}
                      style={{ animationDelay: `${Math.min(i, 20) * 12}ms` }}
                      onClick={() => openRow(h)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget)
                          openRow(h);
                      }}
                    >
                      <td>
                        <StagePill stage={h.stage} />
                      </td>
                      <td>
                        <PathCell h={h} />
                      </td>
                      <td className="r fx-meta-num">
                        {h.generation ? h.generation.slice(-10) : "—"}
                      </td>
                      <td className="r fx-meta-num">
                        {h.size > 0 ? f.bytes(h.size) : "—"}
                      </td>
                      <td
                        className="fx-meta-num"
                        title={f.dateTimeLabel(h.updated, { seconds: true })}
                        suppressHydrationWarning
                      >
                        {f.dateTime(h.updated).slice(5, 16)}
                        <div className="muted" style={{ fontSize: 10.5 }}>
                          {f.relative(h.updated, now)}
                        </div>
                      </td>
                      <td>
                        <LinksCell h={h} rh={rh} />
                      </td>
                      <td>
                        {h.current_status ? (
                          <StatusPill status={h.current_status} size="xs" />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="cp"
                          aria-label={t("detail.copy")}
                          title={t("detail.copy")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copy(h.uri);
                          }}
                        >
                          <Copy />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="fx-cards" aria-label={t("table.aria")}>
              {rows.slice(0, shown).map((h) => (
                <li key={hitKey(h)}>
                  <button
                    type="button"
                    className={clsx("fx-card", fs.sel === hitKey(h) && "sel")}
                    onClick={() => openRow(h)}
                  >
                    <span className="r1">
                      <StagePill stage={h.stage} />
                      {h.current_status ? (
                        <StatusPill status={h.current_status} size="xs" />
                      ) : null}
                    </span>
                    <PathCell h={h} />
                    <span className="r3" suppressHydrationWarning>
                      {h.workflow_id ? <span>{h.workflow_id}</span> : null}
                      {h.size > 0 ? <span>{f.bytes(h.size)}</span> : null}
                      <span>{f.relative(h.updated, now)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {rows.length > shown ? (
              <div className="pager">
                <span className="muted mono">
                  {f.number(shown)} / {f.number(rows.length)}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setShown((x) => x + PAGE)}
                >
                  +{PAGE}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="fx-empty">
            <FileSearch className="ico" aria-hidden />
            <b>{q || anyFilter ? t("empty.title") : t("empty.noData")}</b>
            <span className="in-range" suppressHydrationWarning>
              {q ? `“${q}” · ` : ""}
              {L.title}
            </span>
            <ul className="fx-tips">
              <li className="tt" style={{ display: "block" }}>
                {t("empty.tipsTitle")}
              </li>
              {tips.map(([txt, ex]) => (
                <li key={txt}>
                  <span>
                    {txt}
                    {ex.length ? " " : null}
                    {ex.map((x) => (
                      <span key={x}>
                        {" "}
                        <button
                          type="button"
                          className="ex"
                          onClick={() => setDraft(x)}
                        >
                          {x}
                        </button>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <div className="acts">
              {anyFilter ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => (
                    setDraft(""),
                    setF({
                      q: null,
                      stage: [],
                      bucket: null,
                      language: [],
                      status: [],
                      sel: null,
                    })
                  )}
                >
                  <RotateCcw />
                  {t("empty.resetAll")}
                </button>
              ) : null}
              {!(tr.spec.kind === "preset" && tr.spec.preset === "30d") ? (
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() =>
                    tr.setSpec(
                      { kind: "preset", preset: "30d" },
                      { history: "push" },
                    )
                  }
                >
                  {t("empty.widen")}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </Plate>

      <AnimatePresence>
        {sel ? (
          <Detail
            key={hitKey(sel)}
            h={sel}
            q={q}
            onClose={() => setF({ sel: null })}
            onCopy={copy}
          />
        ) : null}
      </AnimatePresence>
    </Sheet>
  );
}

/* ───────────── cells ───────────── */
function StagePill({ stage }: { stage: StageId }) {
  const locale = useLocale();
  return (
    <span className="fx-pill" title={STAGE_BY_ID[stage].label.en}>
      <span className="no">{stageNo(stage)}</span>
      <CatalogIcon name={STAGE_BY_ID[stage].icon} aria-hidden />
      {stageLabel(stage, locale)}
    </span>
  );
}

function PathCell({ h }: { h: FileSearchHit }) {
  const t = useT("files");
  const [dir, base] = splitPath(h.object);
  const shifted = {
    match_ranges: h.match_ranges.map((m) =>
      m.field === "object"
        ? { ...m, start: m.start - dir.length, end: m.end - dir.length }
        : m,
    ),
  };
  return (
    <div className="fx-path">
      <span className="bk">gs://{h.bucket}/</span>
      <Hl text={dir} hit={h} field="object" />
      <Hl text={base} hit={shifted} field="object" className="base" />
      <span className="sub">
        <span className="kind">{t(`kinds.${h.kind}`)}</span>
        {h.ref ? <span title={t("detail.ref")}>{h.ref}</span> : null}
        {h.language ? <LangBadge lang={h.language} /> : null}
      </span>
    </div>
  );
}

function LinksCell({ h, rh }: { h: FileSearchHit; rh: (p: string) => string }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (!h.workflow_id) return <span className="muted">—</span>;
  return (
    <div className="fx-links">
      <Link
        href={rh(`/workflows/${encodeURIComponent(h.workflow_id)}`)}
        onClick={stop}
      >
        <Hl text={h.workflow_id} hit={h} field="workflow_id" />
      </Link>
      {h.batch_id ? (
        <span className="muted">
          <Hl text={h.batch_id} hit={h} field="batch_id" />
        </span>
      ) : null}
      {h.pipeline_job_id ? (
        <Link
          href={rh(jobHref(h.workflow_id, h.pipeline_job_id))}
          onClick={stop}
          className="muted"
          title={h.pipeline_job_id}
        >
          {h.pipeline_job_id.replace(h.workflow_id, "…")}
        </Link>
      ) : null}
    </div>
  );
}

/* ───────────── side detail ───────────── */
function Detail({
  h,
  q,
  onClose,
  onCopy,
}: {
  h: FileSearchHit;
  q: string;
  onClose: () => void;
  onCopy: (uri: string) => void;
}) {
  const t = useT("files");
  const locale = useLocale();
  const f = useFmt();
  const now = useSimNow();
  const rh = useRangeHref();
  const reduced = useReducedMotionSafe();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [, base] = splitPath(h.object);
  const here = STAGE_ORDER.indexOf(h.stage);
  const nowStage = h.current_status ? STATE_TO_STAGE[h.current_status] : null;
  const nowI = nowStage ? STAGE_ORDER.indexOf(nowStage) : -1;
  const tone = h.current_status ? STATUS_META[h.current_status].tone : null;
  const reach = Math.max(here, nowI);
  return (
    <>
      <motion.button
        type="button"
        className="fx-scrim"
        aria-label={t("detail.close")}
        tabIndex={-1}
        onClick={onClose}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="drawer fx-det"
        role="dialog"
        aria-label={t("detail.aria")}
        initial={reduced ? false : { x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={
          reduced
            ? { opacity: 0, transition: { duration: 0 } }
            : { x: 40, opacity: 0, transition: { duration: 0.16 } }
        }
        transition={{ duration: 0.26, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <div className="dh">
          <div className="eb">
            <span>
              {t("detail.title")} · {t(`kinds.${h.kind}`)}
            </span>
            <button
              ref={closeRef}
              type="button"
              className="btn icon sm ghost"
              aria-label={t("detail.close")}
              onClick={onClose}
            >
              <X />
            </button>
          </div>
          <div className="row">
            <StagePill stage={h.stage} />
            {h.current_status ? <StatusPill status={h.current_status} /> : null}
            {h.language ? <LangBadge lang={h.language} display="both" /> : null}
          </div>
          <h2>{base}</h2>
          <div className="uri">{h.uri}</div>
          <div className="row">
            <button
              type="button"
              className="btn sm primary"
              onClick={() => onCopy(h.uri)}
            >
              <Copy />
              {t("detail.copy")}
            </button>
          </div>
        </div>
        <div className="db">
          <section>
            <h3>
              <span>{t("detail.position")}</span>
            </h3>
            <div
              className="fx-rail"
              role="img"
              aria-label={`${t("detail.here")}: ${stageLabel(h.stage, locale)}${nowStage ? ` · ${t("detail.now")}: ${stageLabel(nowStage, locale)}` : ""}`}
            >
              <motion.span
                className="fill"
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: 0.6,
                  ease: [0.2, 0.7, 0.2, 1],
                  delay: 0.1,
                }}
                style={{ width: `${(reach / (STAGE_ORDER.length - 1)) * 90}%` }}
              />
              {STAGE_ORDER.map((s, i) => (
                <span
                  key={s}
                  className={clsx(
                    "st",
                    i <= reach && "past",
                    i === here && "here",
                    i === nowI && "now",
                    tone && `tone-${tone}`,
                  )}
                  title={`${stageNo(s)} · ${stageLabel(s, locale)}`}
                >
                  <span className="pt" />
                  <span className="n">{stageNo(s)}</span>
                </span>
              ))}
            </div>
            <div className="fx-rail-legend">
              <div>
                <i style={{ background: "var(--ink)" }} />
                <span className="k">{t("detail.here")}</span>
                <span className="v">
                  {stageNo(h.stage)} {stageLabel(h.stage, locale)}
                  <small>{STAGE_BY_ID[h.stage].label.en}</small>
                </span>
              </div>
              {nowStage && h.current_status ? (
                <div className={tone ? `tone-${tone}` : undefined}>
                  <i style={{ background: "var(--tc)" }} />
                  <span className="k">{t("detail.now")}</span>
                  <span className="v">
                    {stageNo(nowStage)} {stageLabel(nowStage, locale)}
                    <small>{h.current_status}</small>
                  </span>
                </div>
              ) : (
                <div>
                  <i style={{ background: "var(--rule)" }} />
                  <span className="k">{t("detail.now")}</span>
                  <span className="v muted">{t("detail.noWorkflow")}</span>
                </div>
              )}
            </div>
          </section>

          <section>
            <h3>{t("detail.links")}</h3>
            <div className="lk">
              {h.workflow_id ? (
                <Link
                  href={rh(`/workflows/${encodeURIComponent(h.workflow_id)}`)}
                >
                  <GitBranch aria-hidden />
                  <span>
                    {t("detail.openWorkflow")}
                    <span className="s">{h.workflow_id}</span>
                  </span>
                  <ArrowUpRight aria-hidden />
                </Link>
              ) : null}
              <Link href={rh(inspectorHref(h.stage, q || base))}>
                <MapIcon aria-hidden />
                <span>
                  {t("detail.openInspector")}
                  <span className="s">
                    {stageNo(h.stage)} · {stageLabel(h.stage, locale)}
                  </span>
                </span>
                <ArrowUpRight aria-hidden />
              </Link>
              {h.pipeline_job_id && h.workflow_id ? (
                <Link href={rh(jobHref(h.workflow_id, h.pipeline_job_id))}>
                  <WorkflowIcon aria-hidden />
                  <span>
                    {t("detail.openJob")}
                    <span className="s">{h.pipeline_job_id}</span>
                  </span>
                  <ArrowUpRight aria-hidden />
                </Link>
              ) : null}
              {h.workflow_id ? (
                <Link
                  href={rh(`/files?q=${encodeURIComponent(h.workflow_id)}`)}
                >
                  <FolderSearch aria-hidden />
                  <span>
                    {t("detail.sameWorkflow")}
                    <span className="s">q={h.workflow_id}</span>
                  </span>
                  <ArrowUpRight aria-hidden />
                </Link>
              ) : null}
            </div>
          </section>

          <section>
            <h3>{t("detail.metadata")}</h3>
            <dl className="kv">
              <dt>{t("detail.kind")}</dt>
              <dd>{t(`kinds.${h.kind}`)}</dd>
              {h.ref ? (
                <>
                  <dt>{t("detail.ref")}</dt>
                  <dd className="mono">{h.ref}</dd>
                </>
              ) : null}
              <dt>{t("detail.bucket")}</dt>
              <dd className="mono">{h.bucket}</dd>
              <dt>{t("detail.object")}</dt>
              <dd className="mono">{h.object}</dd>
              <dt>{t("detail.generation")}</dt>
              <dd className="mono">{h.generation || "—"}</dd>
              <dt>{t("detail.size")}</dt>
              <dd className="mono">
                {h.size > 0
                  ? `${f.bytes(h.size)} (${f.number(h.size)} B)`
                  : "—"}
              </dd>
              <dt>{t("detail.updated")}</dt>
              <dd className="mono" suppressHydrationWarning>
                {f.dateTimeLabel(h.updated, { seconds: true })} ·{" "}
                {f.relative(h.updated, now)}
              </dd>
              <dt>{t("detail.language")}</dt>
              <dd>
                {h.language ? (
                  <LangBadge lang={h.language} display="both" />
                ) : (
                  "—"
                )}
              </dd>
              <dt>{t("detail.workflowId")}</dt>
              <dd className="mono">{h.workflow_id ?? "—"}</dd>
              <dt>{t("detail.batchId")}</dt>
              <dd className="mono">{h.batch_id ?? "—"}</dd>
              <dt>{t("detail.pipelineJobId")}</dt>
              <dd className="mono">{h.pipeline_job_id ?? "—"}</dd>
              <dt>{t("detail.currentStatus")}</dt>
              <dd>
                {h.current_status ? (
                  <StatusPill status={h.current_status} size="xs" />
                ) : (
                  "—"
                )}
              </dd>
            </dl>
          </section>
        </div>
      </motion.aside>
    </>
  );
}
