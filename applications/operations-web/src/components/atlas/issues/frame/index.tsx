"use client";
/**
 * Issue Report frame — the persistent page chrome of /issues/** (mounted once by
 * app/(console)/issues/layout.tsx, so it does not remount or flicker when the view changes):
 *
 *   header      title · one-line view description · baseline badge · export (CSV, Markdown download / copy)
 *   switcher    Triage · 분해 보기 · Analysis · Report (links carry the full filter query; animated indicator)
 *               + a trailing 분석 모듈 tab (/issues/modules — the module registry; no FilterBar / exports there)
 *   badges      the view's analysis modules (union over its features, src/config/analysis-modules.ts)
 *   FilterBar   the unified, dimension-driven filter UI (./filter-bar.tsx)
 *   {children}  the view
 *
 * On /issues/[id] the switcher and FilterBar are replaced by a back link to the view (+ query) the issue
 * was opened from, plus the active-filter chips (they still scope the issue's utterances and trend).
 */
import clsx from "clsx";
import { ArrowLeft, Boxes, ClipboardCopy, Download, FileDown, FileText, LayoutGrid, ListChecks, ScatterChart } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import { featuresOf, type FeaturePage } from "@/config/analysis-modules";
import { ISSUE_VIEWS, MODULES_PATH, ModuleBadges, issuePageOf, useIssueExport, useIssueFilters, useIssueSummary, useIssueViewLinks, type IssueFiltersApi, type IssuePageKind, type IssueView } from "../../issues-shared";
import { Sheet, useReducedMotionSafe } from "../../ui";
import { ActiveChips, FilterBar } from "./filter-bar";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-frame.css";

const ICON: Record<IssueView, typeof ListChecks> = { triage: ListChecks, categories: LayoutGrid, analysis: ScatterChart, report: FileText };

/** tab label + one-line description of every page kind (each view namespace owns its `view` block) */
function useViewText() {
  const tr = useT("issuesTriage");
  const ca = useT("issuesCategories");
  const an = useT("issuesAnalysis");
  const re = useT("issuesReport");
  const de = useT("issuesDetail");
  return (p: IssuePageKind) => {
    const t = { triage: tr, categories: ca, analysis: an, report: re, detail: de }[p];
    return { tab: t("view.tab"), desc: t("view.desc") };
  };
}

function Baseline({ f }: { f: IssueFiltersApi }) {
  const t = useT("issues");
  const fm = useFmt();
  const b = useIssueSummary(f).data?.baseline;
  if (!b) return <span className="isf-base skel-line" aria-hidden />;
  return (
    <span className={clsx("isf-base", !b.sufficient && "warn")} title={`${fm.dateTimeLabel(b.from)} ~ ${fm.dateTimeLabel(b.to)} · ${Math.round(b.coverage * 100)}%${b.sufficient ? "" : " · " + t("baseline.insufficient")}`}>
      <span className="isf-base-dot" aria-hidden />
      {t("frame.baselineTag", { mode: t(`baseline.mode.${b.mode}`) })}
      {!b.sufficient ? <span className="isf-base-warn"> · {t("frame.baselineInsufficient")}</span> : null}
    </span>
  );
}

function Exports({ f }: { f: IssueFiltersApi }) {
  const t = useT("issues");
  const ex = useIssueExport(f, { issueBase: "/issues" });
  return (
    <div className="isf-export" role="group" aria-label={t("frame.exportGroup")}>
      <ModuleBadges features={["export.csv", "export.markdown"]} className="isf-mods-exp" />
      <a className="btn sm" href={ex.csvUrl} download aria-label={t("actions.exportCsv")}>
        <Download aria-hidden />
        <span>{t("actions.exportCsv")}</span>
      </a>
      <a className="btn sm" href={ex.markdownUrl} download aria-label={t("actions.downloadMarkdown")}>
        <FileDown aria-hidden />
        <span>{t("actions.downloadMarkdown")}</span>
      </a>
      <button type="button" className="btn sm" onClick={() => void ex.copyMarkdown()} aria-label={t("actions.copyMarkdown")}>
        <ClipboardCopy aria-hidden />
        <span>{t("actions.copyMarkdown")}</span>
      </button>
    </div>
  );
}

function ViewSwitcher({ current }: { current: IssueView | "modules" }) {
  const t = useT("issues");
  const m = useT("modules");
  const qs = useSearchParams().toString();
  const vt = useViewText();
  const V = useIssueViewLinks();
  const rm = useReducedMotionSafe();
  // optimistic: move the indicator on click, before the route resolves
  const [pending, setPending] = useState<IssueView | "modules" | null>(null);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPending(null);
  }
  const active = pending ?? current;
  return (
    <nav className="isf-views" aria-label={t("frame.switcher")}>
      <LayoutGroup id="isf-views">
        {ISSUE_VIEWS.map((v) => {
          const Icon = ICON[v];
          const on = v === active;
          return (
            <Link key={v} href={V.viewHref(v)} className={clsx("isf-view", on && "on")} aria-current={v === current ? "page" : undefined} onClick={() => setPending(v)} scroll={false}>
              <Icon aria-hidden />
              <span>{vt(v).tab}</span>
              {on ? <motion.span className="isf-view-ind" layoutId="isf-view-ind" transition={rm ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }} aria-hidden /> : null}
            </Link>
          );
        })}
        <Link href={qs ? `${MODULES_PATH}?${qs}` : MODULES_PATH} className={clsx("isf-view isf-view-mod", active === "modules" && "on")} aria-current={current === "modules" ? "page" : undefined} onClick={() => setPending("modules")} scroll={false}>
          <Boxes aria-hidden />
          <span>{m("page.tab")}</span>
          {active === "modules" ? <motion.span className="isf-view-ind" layoutId="isf-view-ind" transition={rm ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }} aria-hidden /> : null}
        </Link>
      </LayoutGroup>
    </nav>
  );
}

function BackLink() {
  const t = useT("issues");
  const vt = useViewText();
  const V = useIssueViewLinks();
  return (
    <Link href={V.backHref} className="isf-back">
      <ArrowLeft aria-hidden />
      <span>{t("frame.backTo", { view: vt(V.view).tab })}</span>
    </Link>
  );
}

export function IssuesFrame({ children }: { children: ReactNode }) {
  const t = useT("issues");
  const nav = useT("nav");
  const vt = useViewText();
  const mt = useT("modules");
  const f = useIssueFilters();
  const pathname = usePathname();
  const mod = pathname.replace(/\/+$/, "") === MODULES_PATH;
  const page = issuePageOf(pathname) ?? "triage";
  const detail = page === "detail" && !mod;
  const text = mod ? { tab: mt("page.tab"), desc: mt("page.desc") } : vt(page);
  return (
    <Sheet className="iss-frame">
      <header className="isf-head" data-page={page}>
        <div className="isf-title">
          <span className="dwg">
            {t("frame.dwg")} · {text.tab.toUpperCase()}
            <span className="phase-tag" data-phase="2" title={t("frame.phaseTip")}>
              {t("frame.phase")}
            </span>
          </span>
          <h1>
            {nav("issues.title")}
            {!detail ? <span className="isf-h-view">{text.tab}</span> : null}
          </h1>
          <p>{text.desc}</p>
          {!mod ? (
            <div className="isf-mods">
              <span className="isf-mods-k">{mt("badge.view")}</span>
              <ModuleBadges features={featuresOf(page as FeaturePage)} view />
            </div>
          ) : null}
        </div>
        {!mod ? (
          <div className="isf-acts">
            <Baseline f={f} />
            {!detail ? <Exports f={f} /> : null}
          </div>
        ) : null}
      </header>
      {mod ? (
        <ViewSwitcher current="modules" />
      ) : detail ? (
        <div className="isf-crumb">
          <BackLink />
          <ActiveChips f={f} />
        </div>
      ) : (
        <>
          <ViewSwitcher current={page as IssueView} />
          <FilterBar f={f} />
        </>
      )}
      <div className="isf-body">{children}</div>
    </Sheet>
  );
}
