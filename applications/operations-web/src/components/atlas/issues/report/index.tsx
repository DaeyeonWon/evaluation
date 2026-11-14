"use client";
/**
 * Issue Report — Report view (/issues/report; "리포트 모드", from candidate B "Market Brief").
 * OWNED BY THE REPORT VIEW ENGINEER. The page header, view switcher, export group and the unified
 * FilterBar come from the frame (../frame); this view renders no filter UI of its own.
 *
 * An editorial intelligence briefing regenerated from /api/v1/issues/* for the frame's range + filters:
 * masthead (period, baseline, model + Bixby versions, conditions, headline, KPI ledger) →
 * executive summary → critical-issue dossiers (impact level · category, → /issues/[id]) →
 * user impact (lens 1) → Bixby must-handle misses (lens 2, dev) → division impact → region impact →
 * Bixby version regression → model / pipeline regression → emerging patterns → market & device →
 * statistical appendix → evidence notes. Sticky TOC with scroll-spy; footnote refs open /results with
 * the brief's row filters carried (./links.ts); ?issue=<id> opens the quick-look dossier drawer.
 */
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import {
  ModuleBadges,
  useIssueBreakdown,
  useIssueFilters,
  useIssueFormat,
  useIssueInsights,
  useIssueLive,
  useIssueMatrix,
  useIssuePatterns,
  useIssues,
  useIssueSummary,
} from "../../issues-shared";
import { ErrorNote, useToast } from "../../ui";
import { NotesCtx, type Note } from "./bits";
import { Appendix } from "./appendix";
import { BixbyRegression, bixbyRegressions } from "./bixby";
import { criticalMisses, DevMiss, focusIssues } from "./dev-miss";
import { DimImpact, noteKey } from "./dim-impact";
import { useBriefLinks } from "./links";
import { UserImpact, worstCases } from "./user-impact";
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

export const SECTIONS = ["exec", "critical", "user", "dev", "division", "region", "bixby", "regression", "patterns", "markets", "appendix", "notes"] as const;
export type SectionId = (typeof SECTIONS)[number];

export function IssuesReport() {
  const t = useT("issuesReport");
  const f = useIssueFilters();
  const fx = useBriefFormat(useIssueFormat());
  const B = useBriefLinks(f);
  const toast = useToast();

  const sum = useIssueSummary(f);
  const ins = useIssueInsights(f);
  // every issue in scope: the impact / must-handle sections pick their worst cases from the full list
  const list = useIssues(f, { pageSize: 200 });
  const pats = useIssuePatterns(f, { limit: 40 });
  const bdUser = useIssueBreakdown(f, "user_impact");
  const bdDev = useIssueBreakdown(f, "dev_miss");
  const bdMust = useIssueBreakdown(f, "must_handle");
  const bdDiv = useIssueBreakdown(f, "division");
  const bdReg = useIssueBreakdown(f, "region");
  const bdBx = useIssueBreakdown(f, "bixby_version");
  const mxBx = useIssueMatrix(f, { x: "bixby_version", y: "division", metric: "fail_rate" });

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
    const items = list.data?.items ?? [];
    const issue = (i: (typeof items)[number]) => add(`iss:${i.id}`, fx.text(i.title), B.results(i));
    const dimNote = (dim: "division" | "region", v: string) => add(noteKey(dim, v), `${fx.column(dim)} ${fx.value(dim, v)} · FAIL`, B.resultsFor({ [dim]: v }));
    // reading order: exec → dossiers → user → dev → division → region → bixby → regression → patterns → markets
    for (const i of (ins.data?.items ?? []).slice(0, 8)) add(`ins:${i.id}`, fx.insight(i), B.evidence(i));
    for (const i of items.slice(0, 12)) issue(i);
    for (const g of worstCases(items, (i) => i.user_impact_type, { perLevel: 3, cap: 8 })) g.issues.forEach(issue);
    criticalMisses(items).forEach(issue);
    for (const ty of ["regression", "guardrail_miss", "new_feature_gap"] as const) focusIssues(items, ty).forEach(issue);
    for (const i of ins.data?.items ?? []) if (i.kind === "division" || i.kind === "region" || i.kind === "bixby_version") add(`ins:${i.id}`, fx.insight(i), B.evidence(i));
    for (const it of bdDiv.data?.items ?? []) dimNote("division", it.value);
    for (const it of bdReg.data?.items ?? []) dimNote("region", it.value);
    for (const i of bixbyRegressions(list.data)) {
      const r = i.bixby_regression!;
      add(`bxi:${i.id}`, `${fx.text(i.title)} — Bixby ${r.current} · ${fx.value("division", r.division)}`, B.resultsFor({ ...i.results_query, division: r.division, bixby_version: r.current }));
    }
    for (const i of items.filter((x) => x.regression)) issue(i);
    for (const p of pats.data?.items ?? []) add(`pat:${p.id}`, `“${p.template}” — ${fx.kind(p.kind)}`, B.resultsFor({ utterance_pattern: p.id }));
    for (const m of sum.data?.market_matrix.cols ?? []) add(`mkt:${m}`, `${fx.column("market")} ${fx.value("market", m)} · FAIL`, B.resultsFor({ market: m }));
    return { list: out, of: (k: string) => seen.get(k) };
  }, [ins.data, list.data, pats.data, sum.data, bdDiv.data, bdReg.data, fx, B]);

  const toc: TocItem[] = SECTIONS.map((id, i) => ({ id: `issb-${id}`, label: t(`toc.${id}`), no: i + 1 }));
  const regenerating = !!(sum.isValidating || list.isValidating || ins.isValidating || pats.isValidating || bdDiv.isValidating || mxBx.isValidating) && !!sum.data;

  // utterance page of the dossier drawer (reset when another issue opens)
  const [drawerPage, setDrawerPage] = useState(1);
  const [drawerFor, setDrawerFor] = useState(f.selected);
  if (drawerFor !== f.selected) {
    setDrawerFor(f.selected);
    setDrawerPage(1);
  }

  const err = sum.error ?? list.error ?? ins.error ?? pats.error ?? bdUser.error ?? bdDev.error ?? bdDiv.error ?? bdReg.error ?? bdBx.error ?? mxBx.error;
  const n = (id: SectionId) => SECTIONS.indexOf(id) + 1;
  const sid = (id: SectionId) => `issb-${id}`;

  return (
    <NotesCtx.Provider value={notes}>
      <div className="iss-b iss-view">
        {err ? <ErrorNote error={err} /> : null}
        <div className="issb-layout">
          <Toc items={toc} />
          <article className="issb-doc" aria-busy={regenerating || undefined} data-regen={regenerating || undefined}>
            <Masthead sum={sum.data} ins={ins.data} f={f} fx={fx} bixby={(bdBx.data?.items ?? []).map((i) => i.value)} regenerating={regenerating} />
            <ExecSummary id={sid("exec")} no={n("exec")} ins={ins.data} f={f} fx={fx} B={B} />
            <Dossiers id={sid("critical")} no={n("critical")} list={list.data} sum={sum.data} insights={ins.data} f={f} fx={fx} B={B} />
            <UserImpact id={sid("user")} no={n("user")} bd={bdUser.data} list={list.data} fx={fx} B={B} />
            <DevMiss id={sid("dev")} no={n("dev")} bd={bdDev.data} bdMust={bdMust.data} list={list.data} fx={fx} B={B} />
            <DimImpact id={sid("division")} no={n("division")} dim="division" bd={bdDiv.data} ins={ins.data} f={f} fx={fx} B={B} />
            <DimImpact id={sid("region")} no={n("region")} dim="region" bd={bdReg.data} ins={ins.data} f={f} fx={fx} B={B} />
            <BixbyRegression id={sid("bixby")} no={n("bixby")} mx={mxBx.data} bd={bdBx.data} ins={ins.data} list={list.data} f={f} fx={fx} B={B} pipelines={sum.data?.columns.pipeline_version.filter((c) => c.total > 0).map((c) => c.value)} />
            <RegressionWatch id={sid("regression")} no={n("regression")} list={list.data} sum={sum.data} f={f} fx={fx} />
            <EmergingPatterns id={sid("patterns")} no={n("patterns")} pats={pats.data} sum={sum.data} f={f} fx={fx} />
            <MarketImpact id={sid("markets")} no={n("markets")} sum={sum.data} f={f} fx={fx} />
            <Appendix id={sid("appendix")} no={n("appendix")} sum={sum.data} f={f} fx={fx} />
            <section id="issb-notes" className="issb-sec issb-notes" aria-labelledby="issb-notes-h">
              <header className="issb-sec-head">
                <span className="issb-sec-no">{t("section.no", { n: n("notes") })}</span>
                <h2 id="issb-notes-h">{t("section.notes.title")}</h2>
                <p>{t("section.notes.lead")}</p>
                <div className="issb-sec-mods">
                  <ModuleBadges feature="report.notes" />
                </div>
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
