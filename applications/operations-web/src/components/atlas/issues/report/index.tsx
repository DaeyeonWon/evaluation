"use client";
/**
 * Issue Report — Report view (/issues/report; from candidate B "Market Brief"). OWNED BY THE REPORT VIEW ENGINEER.
 * The page header, view switcher, export buttons and the unified FilterBar come from the frame (../frame).
 *
 * TODO(report): the "brief conditions" filter bar (./filter-bar.tsx) was removed — the frame FilterBar
 *   replaces it. Its `regenerating` indicator is gone; show it inside the article if wanted.
 * TODO(report): Masthead still renders its own CSV / Markdown buttons (duplicates the frame's export
 *   group) — drop them or restyle as an in-document "export this brief" block.
 * TODO(report): add sections for division + region impact, Bixby version regression, "사용자 영향" and
 *   "Bixby 미처리 (개발)" (useIssueBreakdown(f, "division" | "region" | "bixby_version" | "user_impact" | "dev_miss")).
 *
 * An editorial intelligence briefing regenerated from /api/v1/issues/* for the selected range + filters:
 * masthead (period, baseline, models, headline, KPI ledger) → §1 executive summary → §2 critical-issue
 * dossiers → §3 emerging utterance patterns → §4 market & device small multiples → §5 regression watch →
 * §6 statistical appendix → evidence notes. Sticky table of contents with scroll-spy; filter chips on top
 * regenerate the brief; ?issue=<id> opens the full dossier drawer (drill-down + triage).
 *
 * Data, URL state, formatting, links and triage come from ../issues-shared (read-only).
 */
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import {
  useIssueExport,
  useIssueFilters,
  useIssueFormat,
  useIssueInsights,
  useIssueLinks,
  useIssueLive,
  useIssuePatterns,
  useIssues,
  useIssueSummary,
} from "../../issues-shared";
import { ErrorNote, useToast } from "../../ui";
import { NotesCtx, type Note } from "./bits";
import { Appendix } from "./appendix";
import { Dossiers } from "./dossiers";
import { DossierDrawer } from "./drawer";
import { ExecSummary } from "./exec";
import { MarketImpact } from "./markets";
import { Masthead } from "./masthead";
import { EmergingPatterns } from "./patterns";
import { RegressionWatch } from "./regression";
import { useBriefFormat } from "./text";
import { Toc, type TocItem } from "./toc";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-report.css";

export const SECTIONS = ["exec", "critical", "patterns", "markets", "regression", "appendix", "notes"] as const;
export type SectionId = (typeof SECTIONS)[number];

export function IssuesReport() {
  const t = useT("issuesReport");
  const f = useIssueFilters();
  const fx = useBriefFormat(useIssueFormat());
  const L = useIssueLinks();
  const toast = useToast();
  const ex = useIssueExport(f, { issueBase: "/issues" });

  const sum = useIssueSummary(f);
  const ins = useIssueInsights(f);
  const list = useIssues(f, { pageSize: 60 });
  const pats = useIssuePatterns(f, { limit: 40 });

  useIssueLive((m) => {
    if (m.kind === "new_critical" && m.severity) toast.ok(t("live.newCritical", { severity: m.severity }));
  });

  // footnotes, numbered in reading order
  const notes = useMemo(() => {
    const out: Note[] = [];
    const seen = new Map<string, Note>();
    const add = (key: string, label: string, href: string) => {
      if (seen.has(key)) return;
      const n = { n: out.length + 1, key, label, href };
      out.push(n);
      seen.set(key, n);
    };
    for (const i of (ins.data?.items ?? []).slice(0, 8)) add(`ins:${i.id}`, fx.insight(i), L.evidence(i));
    for (const i of (list.data?.items ?? []).slice(0, 12)) add(`iss:${i.id}`, fx.text(i.title), L.results(i));
    for (const p of pats.data?.items ?? []) add(`pat:${p.id}`, `“${p.template}” — ${fx.kind(p.kind)}`, L.resultsFor({ utterance_pattern: p.id }));
    for (const m of sum.data?.market_matrix.cols ?? []) add(`mkt:${m}`, `${fx.column("market")} ${fx.value("market", m)} · FAIL`, L.resultsFor({ market: m }));
    for (const i of (list.data?.items ?? []).filter((x) => x.regression)) add(`iss:${i.id}`, fx.text(i.title), L.results(i));
    return { list: out, of: (k: string) => seen.get(k) };
  }, [ins.data, list.data, pats.data, sum.data, fx, L]);

  const toc: TocItem[] = SECTIONS.map((id, i) => ({ id: `issb-${id}`, label: t(`toc.${id}`), no: i + 1 }));
  const regenerating = !!(sum.isValidating || list.isValidating || ins.isValidating || pats.isValidating) && !!sum.data;

  // utterance page of the dossier drawer (reset when another issue opens)
  const [drawerPage, setDrawerPage] = useState(1);
  const [drawerFor, setDrawerFor] = useState(f.selected);
  if (drawerFor !== f.selected) {
    setDrawerFor(f.selected);
    setDrawerPage(1);
  }

  const err = sum.error ?? list.error ?? ins.error ?? pats.error;

  return (
    <NotesCtx.Provider value={notes}>
      <div className="iss-b iss-view">
        {err ? <ErrorNote error={err} /> : null}
        <div className="issb-layout">
          <Toc items={toc} />
          <article className="issb-doc" aria-busy={regenerating || undefined} data-regen={regenerating || undefined}>
            <Masthead sum={sum.data} ins={ins.data} f={f} fx={fx} ex={ex} />
            <ExecSummary id="issb-exec" no={1} ins={ins.data} f={f} fx={fx} />
            <Dossiers id="issb-critical" no={2} list={list.data} sum={sum.data} insights={ins.data} f={f} fx={fx} />
            <EmergingPatterns id="issb-patterns" no={3} pats={pats.data} sum={sum.data} f={f} fx={fx} />
            <MarketImpact id="issb-markets" no={4} sum={sum.data} f={f} fx={fx} />
            <RegressionWatch id="issb-regression" no={5} list={list.data} sum={sum.data} f={f} fx={fx} />
            <Appendix id="issb-appendix" no={6} sum={sum.data} f={f} fx={fx} />
            <section id="issb-notes" className="issb-sec issb-notes" aria-labelledby="issb-notes-h">
              <header className="issb-sec-head">
                <span className="issb-sec-no">{t("section.no", { n: 7 })}</span>
                <h2 id="issb-notes-h">{t("section.notes.title")}</h2>
                <p>{t("section.notes.lead")}</p>
              </header>
              <ol className="issb-notes-list">
                {notes.list.map((n) => (
                  <li key={n.key} id={`issb-note-${n.n}`}>
                    <span className="issb-notes-n">{n.n}</span>
                    <a href={n.href}>{n.label}</a>
                  </li>
                ))}
              </ol>
            </section>
          </article>
        </div>
        <AnimatePresence>{f.selected ? <DossierDrawer key="drawer" id={f.selected} f={f} fx={fx} page={drawerPage} setPage={setDrawerPage} /> : null}</AnimatePresence>
      </div>
    </NotesCtx.Provider>
  );
}
