"use client";
/**
 * Issue Report — design candidate A "Triage Deck" (/issues/a). OWNED BY THE CANDIDATE-A DESIGNER.
 *
 * Card-first command board: oversized KPI tiles → severity / factor / mover ribbon → insights ticker →
 * filter rail + new-pattern carousel + criticality-ranked issue cards (or a lifecycle kanban). A card
 * opens a full-height sheet with the score anatomy, utterances and triage. Data, URL filters, formatting,
 * links and triage come from ../issues-shared.
 */
import clsx from "clsx";
import { ClipboardCopy, Download, FileDown, KanbanSquare, LayoutGrid, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import { parseAsString, useQueryStates, useSession } from "@/lib/client";
import type { Issue } from "@/lib/types";
import {
  ISSUE_COLUMNS,
  ISSUE_LEVEL_FILTERS,
  ISSUE_SORTS,
  useIssueExport,
  useIssueFacets,
  useIssueFilters,
  useIssueFormat,
  useIssueInsights,
  useIssueLinks,
  useIssueLive,
  useIssuePatterns,
  useIssuePermission,
  useIssueSummary,
  useIssueTriage,
  useIssues,
  type IssueSort,
} from "../issues-shared";
import { ErrorNote, Sheet, SheetHead, Skeleton, useReducedMotionSafe, useToast } from "../ui";
import { IssueCard, type CardActions } from "./card";
import { IssueSheet } from "./detail";
import { Hero, Ribbon } from "./hero";
import { Kanban } from "./kanban";
import { Rail } from "./rail";
import { PatternRow, Ticker } from "./stream";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-a.css";

const VIEW = { view: parseAsString.withDefault("deck") };
const PAGE = 24;
const KANBAN = 100;

export function IssuesCandidateA() {
  const t = useT("issuesA");
  const s = useT("issues");
  const nav = useT("nav");
  const fm = useFmt();
  const f = useIssueFilters();
  const fx = useIssueFormat();
  const L = useIssueLinks();
  const rm = useReducedMotionSafe();
  const toast = useToast();
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const ex = useIssueExport(f, { issueBase: "/issues/a" });
  const { user } = useSession();
  const [{ view }, setView] = useQueryStates(VIEW);
  const kanban = view === "kanban";
  const sum = useIssueSummary(f);
  const fac = useIssueFacets(f);
  const ins = useIssueInsights(f);
  const pats = useIssuePatterns(f, { limit: 24 });
  const list = useIssues(f, kanban ? { pageSize: KANBAN, page: 1 } : { pageSize: PAGE });
  const [railOpen, setRailOpen] = useState(false);
  const [ticketFor, setTicketFor] = useState<string | null>(null);

  useIssueLive((m) => {
    if (m.kind === "new_critical" && m.title) toast.ok(t("liveCritical", { severity: m.severity ?? "", title: fx.text(m.title) }));
  });

  const d = sum.data;
  const bucket = d?.trend.bucket ?? "day";
  const labels = useMemo(() => (d?.trend.points ?? []).map((p) => (bucket === "hour" ? fm.hm(p.t) : fm.dateLabel(p.t))), [d, bucket, fm]);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const now = d?.range.to ?? 0;
  const baseline = d?.baseline ?? list.data?.baseline;

  const open = useCallback(
    (id: string) => {
      setTicketFor(null);
      f.select(id);
    },
    [f],
  );
  const close = useCallback(() => {
    setTicketFor(null);
    f.select(null);
  }, [f]);
  const act: CardActions = {
    canWrite: perm.canWrite,
    readOnly: perm.reason,
    pending: tri.pending,
    me: user?.id ?? null,
    triage: (i: Issue) => void tri.setStatus(i, "TRIAGED", user?.id && !i.state.owner ? { owner: user.id } : {}),
    assignMe: (i: Issue) => {
      if (user?.id) void tri.update(i.id, { owner: user.id });
    },
    ticket: (i: Issue) => {
      setTicketFor(i.id);
      f.select(i.id);
    },
  };

  // active filter chips (removable)
  const chips: { k: string; v: string; label: string; clear: () => void }[] = [];
  for (const k of [...ISSUE_COLUMNS, ...ISSUE_LEVEL_FILTERS])
    for (const v of f.values[k]) chips.push({ k, v, label: `${fx.column(k)}: ${fx.value(k, v)}`, clear: () => f.toggle(k, v) });
  if (f.values.q) chips.push({ k: "q", v: f.values.q, label: `“${f.values.q}”`, clear: () => f.set({ q: null }) });
  if (f.values.min_score != null) chips.push({ k: "min_score", v: String(f.values.min_score), label: `${t("rail.minScore")} ≥${f.values.min_score}`, clear: () => f.set({ min_score: null }) });

  const err = sum.error ?? list.error;
  return (
    <Sheet className="iss-a">
      <SheetHead
        dwg={t("dwg")}
        title={nav("issuesA.title")}
        desc={t("lead")}
        acts={
          <>
            {baseline ? (
              <span className={clsx("ia-base", !baseline.sufficient && "warn")} title={`${fm.dateTimeLabel(baseline.from)} ~ ${fm.dateTimeLabel(baseline.to)} · ${Math.round(baseline.coverage * 100)}%`}>
                {t("baseline.tag", { mode: s(`baseline.mode.${baseline.mode}`) })}
                {!baseline.sufficient ? ` · ${t("baseline.insufficient")}` : ""}
              </span>
            ) : null}
            <div className="ia-export" role="group" aria-label={t("export.title")}>
              <a className="btn sm" href={ex.csvUrl} download>
                <Download aria-hidden />
                {s("actions.exportCsv")}
              </a>
              <a className="btn sm" href={ex.markdownUrl} download>
                <FileDown aria-hidden />
                {s("actions.downloadMarkdown")}
              </a>
              <button type="button" className="btn sm" onClick={() => void ex.copyMarkdown()}>
                <ClipboardCopy aria-hidden />
                {s("actions.copyMarkdown")}
              </button>
            </div>
          </>
        }
      />
      {err ? <ErrorNote error={err} /> : null}

      <Hero sum={d} f={f} fx={fx} labels={labels} compact={kanban} />
      {kanban ? null : <Ribbon sum={d} f={f} fx={fx} />}
      <Ticker ins={ins.data} f={f} fx={fx} L={L} />

      <div className="ia-body" data-view={kanban ? "kanban" : "deck"}>
        <Rail f={f} fx={fx} facets={fac.data} sum={d} open={railOpen} onClose={() => setRailOpen(false)} />
        {railOpen ? <div className="ia-rail-scrim" onClick={() => setRailOpen(false)} aria-hidden /> : null}
        <div className="ia-main">
          {kanban ? null : <PatternRow pats={pats.data} fx={fx} L={L} now={now} onIssue={open} />}

          <section className="ia-deck" aria-labelledby="ia-deck-h" aria-busy={list.isValidating || undefined}>
            <header className="ia-deck-head">
              <h2 id="ia-deck-h">
                {t("deck.title")}
                <span className="mono muted">{t("deck.count", { shown: fm.number(items.length), total: fm.number(total) })}</span>
                {list.data && list.data.unfiltered_total !== total ? <span className="mono muted ia-unf">{t("deck.unfiltered", { n: fm.number(list.data.unfiltered_total) })}</span> : null}
              </h2>
              <div className="ia-deck-tools">
                <button type="button" className="btn sm ia-rail-btn" onClick={() => setRailOpen(true)} aria-expanded={railOpen}>
                  <SlidersHorizontal aria-hidden />
                  {t("rail.open")}
                  {f.activeCount ? <span className="ia-fc-n">{f.activeCount}</span> : null}
                </button>
                <label className="ia-sort">
                  <span className="sr">{s("filters.sort")}</span>
                  <select className="in" value={f.values.sort} onChange={(e) => f.set({ sort: e.target.value as IssueSort })} disabled={kanban}>
                    {ISSUE_SORTS.map((x) => (
                      <option key={x} value={x}>
                        {s(`sort.${x}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="seg ia-view" role="group" aria-label={t("deck.view")}>
                  <button type="button" aria-pressed={!kanban} onClick={() => setView({ view: "deck" })}>
                    <LayoutGrid aria-hidden /> {t("deck.grid")}
                  </button>
                  <button type="button" aria-pressed={kanban} onClick={() => setView({ view: "kanban" })}>
                    <KanbanSquare aria-hidden /> {t("deck.kanban")}
                  </button>
                </div>
              </div>
            </header>
            {chips.length ? (
              <ul className="ia-chips">
                {chips.map((c) => (
                  <li key={c.k + c.v}>
                    <button type="button" onClick={c.clear}>
                      {c.label}
                      <X aria-hidden />
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className="ia-chip-reset" onClick={f.reset}>
                    {s("filters.reset")}
                  </button>
                </li>
              </ul>
            ) : null}

            {!list.data ? (
              <Skeleton rows={6} />
            ) : !items.length ? (
              <div className="empty">
                <b>{s("empty.issues")}</b>
              </div>
            ) : kanban ? (
              <>
                <p className="muted ia-kb-note">{t("deck.kanbanNote", { n: Math.min(KANBAN, total) })}</p>
                <Kanban items={items} labels={labels} fx={fx} act={act} onOpen={open} onTicket={act.ticket} />
              </>
            ) : (
              <LayoutGroup>
                <div className="ia-grid">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {items.map((i, n) => (
                      <motion.div
                        key={i.id}
                        className="ia-cell"
                        layout={!rm}
                        initial={rm ? false : { opacity: 0, y: 14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={rm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.34, delay: rm ? 0 : Math.min(n, 10) * 0.025, ease: [0.2, 0.75, 0.2, 1] }}
                      >
                        <IssueCard issue={i} labels={labels} fx={fx} onOpen={open} act={act} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </LayoutGroup>
            )}
            {!kanban && pages > 1 ? (
              <nav className="ia-pager" aria-label={t("deck.title")}>
                <button type="button" className="btn sm" disabled={f.page <= 1} onClick={() => f.setPage(f.page - 1)}>
                  ← {t("deck.prev")}
                </button>
                <span className="mono">{t("deck.page", { page: f.page, pages })}</span>
                <button type="button" className="btn sm" disabled={f.page >= pages} onClick={() => f.setPage(f.page + 1)}>
                  {t("deck.next")} →
                </button>
              </nav>
            ) : null}
          </section>
        </div>
      </div>

      <AnimatePresence>{f.selected ? <IssueSheet key="sheet" id={f.selected} f={f} fx={fx} ids={ids} focusTicket={ticketFor === f.selected} onClose={close} /> : null}</AnimatePresence>
    </Sheet>
  );
}
