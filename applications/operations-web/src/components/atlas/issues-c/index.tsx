"use client";
/**
 * Issue Report — design candidate C "Signal Lab" (/issues/c): an analyst workspace of linked views.
 *
 *   filter bar + metric tiles
 *   signal readouts (auto insights)
 *   heatmap (Agent function × language|market|device|model)  ·  bubble (volume × trend z, quadrants)
 *   treemap (function → intent → reason)                       ·  emerging patterns (stream + ladder + terms)
 *   issue ledger  ──►  split detail pane (?issue=…)
 *
 * Every mark writes the shared URL filters, so all views + the ledger re-query together; the two
 * lab-only brushes (`quad`, `pat`) narrow the issue-level views client-side. Owned by candidate C.
 */
import { ClipboardCopy, Download, FileText, Radio, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import { parseAsString, useQueryState } from "@/lib/client";
import type { IssueStreamMessage } from "@/lib/types";
import {
  useIssueExport,
  useIssueFacets,
  useIssueFilters,
  useIssueFormat,
  useIssueInsights,
  useIssueLive,
  useIssuePatterns,
  useIssues,
  useIssueSummary,
} from "../issues-shared";
import { ErrorNote, Plate, Sheet, SheetHead, Skeleton, useToast } from "../ui";
import { Bubble } from "./bubble";
import { DetailPane } from "./detail";
import { FilterBar } from "./filter-bar";
import { HEAT_MODES, Heatmap, type HeatMode } from "./heatmap";
import { Insights } from "./insights";
import { QUADRANTS, matchesBrush, volumeCut, type LabBrush, type Quadrant } from "./lab";
import { Patterns } from "./patterns";
import { IssueTable } from "./table";
import { MetricTiles } from "./tiles";
import { Treemap } from "./treemap";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-c.css";

export function IssuesCandidateC() {
  const t = useT("issuesC");
  const s = useT("issues");
  const fx = useIssueFormat();
  const toast = useToast();
  const f = useIssueFilters();
  const sum = useIssueSummary(f);
  const fac = useIssueFacets(f);
  const ins = useIssueInsights(f);
  const pats = useIssuePatterns(f);
  const list = useIssues(f, { pageSize: 500, page: 1 });
  const ex = useIssueExport(f);
  const [quadRaw, setQuadRaw] = useQueryState("quad", parseAsString);
  const [patId, setPatId] = useQueryState("pat", parseAsString);
  const [hmRaw, setHm] = useQueryState("hm", parseAsString);
  const [live, setLive] = useState<IssueStreamMessage | null>(null);

  useIssueLive((m) => {
    setLive(m);
    if (m.kind === "new_critical" && m.title) toast.ok(s("live.newCritical", { severity: m.severity ?? "", title: fx.text(m.title) }));
  });

  const mode: HeatMode = HEAT_MODES.includes(hmRaw as HeatMode) ? (hmRaw as HeatMode) : "language";
  const quad = QUADRANTS.includes(quadRaw as Quadrant) ? (quadRaw as Quadrant) : null;
  const pattern = useMemo(() => pats.data?.items.find((p) => p.id === patId) ?? null, [pats.data, patId]);
  const brush: LabBrush = useMemo(() => ({ quad, pattern }), [quad, pattern]);

  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const vCut = useMemo(() => volumeCut(all), [all]);
  const ledger = useMemo(() => (brush.quad || brush.pattern ? all.filter((i) => matchesBrush(i, brush, vCut)) : all), [all, brush, vCut]);
  const ids = useMemo(() => ledger.map((i) => i.id), [ledger]);

  const close = () => f.select(null);
  useEffect(() => {
    if (!f.selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.(".lab-pop, .lab-detail input, .lab-detail textarea, .lab-detail select")) f.select(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [f]);

  const k = sum.data;
  const brushChips = (
    <>
      {quad ? (
        <button type="button" className="lab-chip brush" onClick={() => setQuadRaw(null)}>
          <span className="muted">{t("quad.label")}</span> {t(`quad.${quad}`)} <X aria-hidden />
        </button>
      ) : null}
      {pattern ? (
        <button type="button" className="lab-chip brush" onClick={() => setPatId(null)}>
          <span className="muted">{s("field.pattern")}</span> “{pattern.template}” <X aria-hidden />
        </button>
      ) : null}
    </>
  );

  return (
    <Sheet className="iss-c">
      <div className="lab" data-open={f.selected ? "" : undefined}>
        <div className="lab-main">
          <SheetHead
            dwg={t("dwg")}
            title={
              <>
                {t("title")} <span className="lab-h-sub">{s("title")}</span>
              </>
            }
            desc={t("desc")}
            acts={
              <>
                <span className="lab-live" title={live ? t("live.last") : undefined}>
                  <Radio aria-hidden /> LIVE
                  {live ? <span className="mono">{live.kind === "new_critical" ? `${live.severity} · ${live.issue_id}` : `${live.issue_id} → ${fx.status(live.status)}`}</span> : null}
                </span>
                <a className="btn sm" href={ex.csvUrl} download>
                  <Download aria-hidden /> {s("actions.exportCsv")}
                </a>
                <a className="btn sm" href={ex.markdownUrl} download>
                  <FileText aria-hidden /> {s("actions.downloadMarkdown")}
                </a>
                <button type="button" className="btn sm primary" onClick={() => void ex.copyMarkdown()}>
                  <ClipboardCopy aria-hidden /> {s("actions.copyMarkdown")}
                </button>
              </>
            }
          />

          <FilterBar f={f} facets={fac.data} baseline={k?.baseline} />
          {sum.error ? <ErrorNote error={sum.error} /> : null}
          {k ? <MetricTiles sum={k} f={f} /> : <Skeleton rows={3} />}

          <Plate title={t("ins.title")} refText={t("ins.ref", { n: ins.data?.items.length ?? 0 })} className="lab-plate">
            <Insights data={ins.data} f={f} onIssue={(id) => f.select(id)} />
          </Plate>

          <div className="lab-row r-hm">
            <Plate title={t("heat.title")} refText={t("heat.ref")} className="lab-plate">
              <Heatmap f={f} facets={fac.data} mode={mode} setMode={(m) => setHm(m === "language" ? null : m)} issues={all} />
            </Plate>
            <Plate title={t("bubble.title")} refText={t("bubble.ref", { n: all.length })} className="lab-plate">
              {list.data ? <Bubble issues={all} vCut={vCut} brush={brush} setQuad={(q) => setQuadRaw(q)} selected={f.selected} onSelect={(id) => f.select(id)} /> : <Skeleton rows={8} />}
            </Plate>
          </div>

          <div className="lab-row r-tree">
            <Plate title={t("tree.title")} refText={t("tree.ref")} className="lab-plate">
              {list.data ? <Treemap issues={all} f={f} brush={brush} vCut={vCut} /> : <Skeleton rows={8} />}
            </Plate>
            <Plate title={t("pat.title")} refText={pats.data ? t("pat.ref", { n: pats.data.items.length }) : undefined} className="lab-plate">
              <Patterns data={pats.data} f={f} activeId={patId} onBrush={(p) => setPatId(p?.id ?? null)} />
            </Plate>
          </div>

          <Plate
            title={t("table.title")}
            right={<div className="lab-brushes">{brushChips}</div>}
            className="lab-plate"
            id="lab-ledger"
          >
            {list.error ? <ErrorNote error={list.error} /> : null}
            {list.data ? <IssueTable items={ledger} f={f} page={f.page} setPage={f.setPage} /> : <Skeleton rows={8} />}
          </Plate>
          <p className="lab-foot mono">{t("foot")}</p>
        </div>
        {f.selected ? (
          <>
            <div className="lab-scrim" onClick={close} aria-hidden />
            <DetailPane f={f} onClose={close} siblings={ids} />
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
