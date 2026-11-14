"use client";
/**
 * Issue Report — Triage view (/issues, the default view; from candidate A "Triage Deck").
 * OWNED BY THE TRIAGE VIEW ENGINEER. The page header, view switcher, export buttons and the unified
 * FilterBar (incl. active-filter chips) come from the frame (../frame, mounted by app/(console)/issues/layout.tsx).
 *
 * TODO(triage): lenses — useTriageLens() (lens user|dev, group default "severity" = 영향도, subgroup) +
 *   useIssueGroups(); swimlanes/sections per impact level; card type badge from tl.typeDim.
 * TODO(triage): the left filter rail (rail.tsx, deleted — see git history) and the active-filter chips
 *   were removed; filters live in the frame. Dead: .ia-rail* / .ia-chips CSS, issuesTriage rail.* / baseline.* / export.* keys.
 * TODO(triage): IssueSheet quick-look → add an "전체 분석 열기" link to useIssueViewLinks().issueHref(id).
 *
 * Card-first command board: oversized KPI tiles → severity / factor / mover ribbon → insights ticker →
 * filter rail + new-pattern carousel + criticality-ranked issue cards (or a lifecycle kanban). A card
 * opens a full-height sheet with the score anatomy, utterances and triage. Data, URL filters, formatting,
 * links and triage come from ../issues-shared.
 */
import { KanbanSquare, LayoutGrid } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import { parseAsString, useQueryStates, useSession } from "@/lib/client";
import type { Issue } from "@/lib/types";
import {
  ISSUE_SORTS,
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
} from "../../issues-shared";
import { ErrorNote, Skeleton, useReducedMotionSafe, useToast } from "../../ui";
import { IssueCard, type CardActions } from "./card";
import { IssueSheet } from "./detail";
import { Hero, Ribbon } from "./hero";
import { Kanban } from "./kanban";
import { PatternRow, Ticker } from "./stream";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-triage.css";

const VIEW = { view: parseAsString.withDefault("deck") };
const PAGE = 24;
const KANBAN = 100;

export function IssuesTriage() {
  const t = useT("issuesTriage");
  const s = useT("issues");
  const fm = useFmt();
  const f = useIssueFilters();
  const fx = useIssueFormat();
  const L = useIssueLinks();
  const rm = useReducedMotionSafe();
  const toast = useToast();
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const { user } = useSession();
  const [{ view }, setView] = useQueryStates(VIEW);
  const kanban = view === "kanban";
  const sum = useIssueSummary(f);
  const ins = useIssueInsights(f);
  const pats = useIssuePatterns(f, { limit: 24 });
  const list = useIssues(f, kanban ? { pageSize: KANBAN, page: 1 } : { pageSize: PAGE });
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

  const err = sum.error ?? list.error;
  return (
    <div className="iss-a iss-view">
      {err ? <ErrorNote error={err} /> : null}

      <Hero sum={d} f={f} fx={fx} labels={labels} compact={kanban} />
      {kanban ? null : <Ribbon sum={d} f={f} fx={fx} />}
      <Ticker ins={ins.data} f={f} fx={fx} L={L} />

      <div className="ia-body" data-view={kanban ? "kanban" : "deck"} data-rail="off">
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
    </div>
  );
}
