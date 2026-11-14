"use client";
/**
 * Issue Report — single-issue deep analysis (/issues/[id]). OWNED BY THE DETAIL VIEW ENGINEER.
 * The frame (../frame) renders the page title, the back link to the view the issue was opened from and the
 * active-filter chips; this component owns everything below:
 *
 *   Hero         impact level · status · criticality gauge · title · signature · taxonomy + reasons · KPIs · prev/next · export
 *   Anatomy      waterfall of the six factor contributions + why flagged
 *   Trend        FAIL count and FAIL rate vs baseline (two single-axis charts), spike, Bixby / release regression
 *   Breakdowns   this issue by DETAIL_BREAKDOWN_DIMS (drill to Triage / /results)
 *   Utterances   GET /results with the issue's results_query (paged, searchable, diff)
 *   Patterns · Similar · Workflows · Triage panel (issues:write) + history
 *
 * Export: Markdown built client side from the detail; CSV = /results/csv with the issue's filters.
 */
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useMemo, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import { API_BASE, ApiClientError, qs } from "@/lib/client";
import { issueBreakdowns, useDimLabel, useIssueDetail, useIssueFilters, useIssueFormat, useIssues, useIssueViewLinks } from "../../issues-shared";
import { Empty, ErrorNote, Plate, Skeleton, copyText, useReducedMotionSafe, useToast } from "../../ui";
import { Anatomy } from "./anatomy";
import { Breakdowns } from "./breakdowns";
import { Hero } from "./header";
import { RESULTS_PARAM, issueMarkdown } from "./lib";
import { useDetailLinks } from "./links";
import { Patterns, Similar, Workflows } from "./related";
import { TriagePanel } from "./triage";
import { Trend } from "./trend";
import { Utterances } from "./utterances";
import "@/styles/atlas-issues-detail.css";

function Reveal({ children, i, className }: { children: ReactNode; i: number; className?: string }) {
  const rm = useReducedMotionSafe();
  return (
    <motion.div className={className} initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: rm ? 0 : 0.42, delay: rm ? 0 : Math.min(i, 8) * 0.05, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

export function IssueDetailPage({ id }: { id: string }) {
  const t = useT("issuesDetail");
  const fm = useFmt();
  const fx = useIssueFormat();
  const dl = useDimLabel();
  const f = useIssueFilters();
  const V = useIssueViewLinks();
  const L = useDetailLinks();
  const toast = useToast();
  const det = useIssueDetail(id, f, { pageSize: 10 });
  const d = det.data && det.data.id === id ? det.data : undefined;
  // the current filtered + sorted list (prev / next)
  const list = useIssues(f, { page: 1, pageSize: 200 });
  const ids = useMemo(() => list.data?.items.map((i) => i.id) ?? [], [list.data]);
  const at = ids.indexOf(id);
  const nav = {
    prev: at > 0 ? V.issueHref(ids[at - 1]) : null,
    next: at >= 0 && at < ids.length - 1 ? V.issueHref(ids[at + 1]) : null,
    pos: at + 1,
    total: list.data?.total ?? ids.length,
  };
  const range = L.range;
  const base = useMemo(() => d?.results_query ?? {}, [d?.results_query]);
  const csvUrl = useMemo(() => API_BASE + "/results/csv" + qs({ ...base, ...range, filename: `issue-${id}.csv` }), [base, range, id]);
  const resultsUrl = L.results(base);
  const bds = useMemo(() => issueBreakdowns(d), [d]);
  const drill = useCallback((dim: string, v: string) => V.drillHref(dim, v), [V]);
  const resultsFor = useCallback((dim: string, v: string) => L.results({ ...base, [RESULTS_PARAM[dim] ?? dim]: v }), [L, base]);
  const current = useCallback((dim: string) => (f.values as unknown as Record<string, string[] | undefined>)[dim] ?? [], [f.values]);
  const copyMd = useCallback(async () => {
    if (!d) return;
    const md = issueMarkdown(d, bds, {
      t: (k, v) => t.dynamic(k, v),
      fx,
      dim: dl.dim,
      val: dl.value,
      date: fm.dateTimeLabel,
      num: fm.number,
      url: typeof window !== "undefined" ? window.location.href : `/issues/${id}`,
    });
    const ok = await copyText(md);
    if (ok) toast.ok(t("export.copied"));
    else toast.err(new Error(fx.t("actions.copyFailed")));
  }, [d, bds, t, fx, dl, fm, id, toast]);

  const notFound = det.error instanceof ApiClientError && det.error.status === 404;
  if (!d) {
    return (
      <div className="iss-det iss-view">
        {notFound ? (
          <Plate>
            <Empty title={t("notFound", { id })}>
              <p>
                <Link href={V.backHref}>{t("backToList")}</Link>
              </p>
            </Empty>
          </Plate>
        ) : det.error ? (
          <ErrorNote error={det.error} />
        ) : (
          <Plate>
            <Skeleton rows={8} />
          </Plate>
        )}
      </div>
    );
  }
  return (
    <div className="iss-det iss-view" data-sev={d.severity}>
      <Reveal i={0}>
        <Hero d={d} fx={fx} drill={drill} nav={nav} onCopy={() => void copyMd()} csvUrl={csvUrl} resultsUrl={resultsUrl} />
      </Reveal>
      <div className="idt-grid">
        <div className="idt-main">
          <Reveal i={1}>
            <Anatomy d={d} fx={fx} />
          </Reveal>
          <Reveal i={2}>
            <Trend d={d} fx={fx} />
          </Reveal>
          <Reveal i={3}>
            <Breakdowns d={d} fx={fx} items={bds} drill={drill} results={resultsFor} current={current} />
          </Reveal>
          <Reveal i={4}>
            <Utterances base={base} range={range} resultsUrl={resultsUrl} csvUrl={csvUrl} />
          </Reveal>
          <Reveal i={5}>
            <Patterns d={d} base={base} />
          </Reveal>
        </div>
        <aside className="idt-side" aria-label={t("side")}>
          <Reveal i={2}>
            <TriagePanel d={d} fx={fx} />
          </Reveal>
          <Reveal i={3}>
            <Workflows d={d} />
          </Reveal>
          <Reveal i={4}>
            <Similar d={d} fx={fx} href={V.issueHref} />
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
