"use client";
/**
 * Issue Report — Triage view (/issues, the default view; from candidate A "Triage Deck").
 * OWNED BY THE TRIAGE VIEW ENGINEER. The page header, view switcher, export buttons and the unified
 * FilterBar (incl. active-filter chips) come from the frame (../frame, mounted by app/(console)/issues/layout.tsx).
 * This view has no filter UI of its own; its view-local URL state is lens · group · subgroup · view (lens.tsx).
 *
 *   lens switch (사용자 영향 | Bixby 미처리) → lens KPI band → impact / factor / mover ribbon → insights ticker →
 *   new-pattern carousel → impact swimlanes (group → subgroup → cards, server grouped listing) or a lifecycle kanban.
 *
 * Both lenses share the impact grouping (severity P0–P3 = 영향도); the lens picks the card type
 * (user_impact_type | dev_miss_type), the KPI emphasis and the default subgroup. The dev lens applies
 * must_handle=true when entered (toggle in the lens bar shows out_of_scope too).
 * A card title opens /issues/[id]; the gauge / panel button opens the quick-look sheet (?issue=).
 */
import { KanbanSquare, Rows3 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import { parseAsString, useQueryStates, useSession } from "@/lib/client";
import type { Issue } from "@/lib/types";
import {
  ISSUE_SORTS,
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
} from "../../issues-shared";
import { ErrorNote, Skeleton, useReducedMotionSafe, useToast } from "../../ui";
import type { CardActions } from "./card";
import { IssueSheet } from "./detail";
import { Hero, Ribbon } from "./hero";
import { Kanban } from "./kanban";
import { GroupPicker, Lanes } from "./lanes";
import { LensSwitch, useTriageState } from "./lens";
import { PatternRow, Ticker } from "./stream";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-triage.css";

const VIEW = { view: parseAsString.withDefault("deck") };
const KANBAN = 100;

export function IssuesTriage() {
  const t = useT("issuesTriage");
  const s = useT("issues");
  const fm = useFmt();
  const f = useIssueFilters();
  const ts = useTriageState();
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
  const facets = useIssueFacets(f);
  const ins = useIssueInsights(f);
  const pats = useIssuePatterns(f, { limit: 24 });
  // kanban: one flat list (the top KANBAN by criticality) split by status
  const list = useIssues(f, { pageSize: kanban ? KANBAN : 1, page: 1 });
  // dev KPI: the regression issues (Bixby-version regressions among them); empty when dev_miss excludes regression
  const regFilter = f.values.dev_miss.length && !f.values.dev_miss.includes("regression") ? null : ["regression"];
  const regs = useIssues({ query: { ...f.query, dev_miss: regFilter ?? ["regression"] }, filterQuery: f.filterQuery, page: 1 }, { pageSize: 30, page: 1 });
  const [ticketFor, setTicketFor] = useState<string | null>(null);
  const [laneIds, setLaneIds] = useState<string[]>([]);

  useIssueLive((m) => {
    if (m.kind === "new_critical" && m.title) toast.ok(t("liveCritical", { severity: m.severity ?? "", title: fx.text(m.title) }));
  });

  const d = sum.data;
  const bucket = d?.trend.bucket ?? "day";
  const labels = useMemo(() => (d?.trend.points ?? []).map((p) => (bucket === "hour" ? fm.hm(p.t) : fm.dateLabel(p.t))), [d, bucket, fm]);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const ids = useMemo(() => (kanban ? items.map((i) => i.id) : laneIds), [kanban, items, laneIds]);
  const total = list.data?.total ?? 0;
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
    <div className="iss-a iss-view" data-lens={ts.lens}>
      {err ? <ErrorNote error={err} /> : null}

      <LensSwitch ts={ts} f={f} facets={facets.data} fx={fx} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={ts.lens}
          className="ia-lens-band"
          initial={rm ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={rm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Hero sum={d} facets={facets.data} regs={regFilter ? (regs.data?.items ?? []) : []} lens={ts.lens} f={f} fx={fx} labels={labels} compact={kanban} />
        </motion.div>
      </AnimatePresence>
      {kanban ? null : <Ribbon sum={d} f={f} fx={fx} />}
      <Ticker ins={ins.data} f={f} fx={fx} L={L} />
      {kanban ? null : <PatternRow pats={pats.data} fx={fx} L={L} now={now} onIssue={open} />}

      <section className="ia-deck" aria-labelledby="ia-deck-h">
        <header className="ia-deck-head">
          <h2 id="ia-deck-h">
            {t(kanban ? "deck.titleKanban" : ts.lens === "dev" ? "deck.titleDev" : "deck.titleUser")}
            {list.data ? <span className="mono muted">{t("deck.total", { total: fm.number(total) })}</span> : null}
            {list.data && list.data.unfiltered_total !== total ? <span className="mono muted ia-unf">{t("deck.unfiltered", { n: fm.number(list.data.unfiltered_total) })}</span> : null}
          </h2>
          <div className="ia-deck-tools">
            {kanban ? null : <GroupPicker ts={ts} />}
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
              <button type="button" aria-pressed={!kanban} onClick={() => setView({ view: null })}>
                <Rows3 aria-hidden /> {t("deck.grid")}
              </button>
              <button type="button" aria-pressed={kanban} onClick={() => setView({ view: "kanban" })}>
                <KanbanSquare aria-hidden /> {t("deck.kanban")}
              </button>
            </div>
          </div>
        </header>
        {kanban ? (
          !list.data ? (
            <Skeleton rows={6} />
          ) : !items.length ? (
            <div className="empty">
              <b>{s("empty.issues")}</b>
            </div>
          ) : (
            <>
              <p className="muted ia-kb-note">{t("deck.kanbanNote", { n: Math.min(KANBAN, total) })}</p>
              <Kanban items={items} labels={labels} fx={fx} act={act} onOpen={open} onTicket={act.ticket} ts={ts} />
            </>
          )
        ) : (
          <Lanes f={f} ts={ts} fx={fx} act={act} labels={labels} onOpen={open} onIds={setLaneIds} />
        )}
      </section>

      <AnimatePresence>{f.selected ? <IssueSheet key="sheet" id={f.selected} f={f} fx={fx} ids={ids} focusTicket={ticketFor === f.selected} onClose={close} ts={ts} /> : null}</AnimatePresence>
    </div>
  );
}
