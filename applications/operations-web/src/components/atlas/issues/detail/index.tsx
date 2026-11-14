"use client";
/**
 * Issue Report — single-issue page (/issues/[id]). OWNED BY THE DETAIL VIEW ENGINEER.
 * The frame (../frame) renders the page title, the back link to the view the issue was opened from and the
 * active-filter chips; this component owns everything below.
 *
 * TODO(detail): this is a minimal placeholder header. Build: severity/status/score header, score anatomy
 *   waterfall, why-flagged reasons, trend vs baseline, breakdowns (issueBreakdowns(det.data) →
 *   DETAIL_BREAKDOWN_DIMS), utterances table, patterns, related workflows, similar issues, lifecycle/triage
 *   panel + history, issue Markdown export. Styles: src/styles/atlas-issues-detail.css under .iss-det.
 */
import { useFmt, useT } from "@/i18n/client";
import { useIssueDetail, useIssueFilters, useIssueFormat } from "../../issues-shared";
import { ErrorNote, Plate, Skeleton } from "../../ui";
import "@/styles/atlas-issues-detail.css";

export function IssueDetailPage({ id }: { id: string }) {
  const t = useT("issuesDetail");
  const fm = useFmt();
  const fx = useIssueFormat();
  const f = useIssueFilters();
  const det = useIssueDetail(id, f);
  const d = det.data;
  return (
    <div className="iss-det iss-view">
      {det.error ? <ErrorNote error={det.error} /> : null}
      {!d && !det.error ? (
        <Skeleton rows={3} />
      ) : d ? (
        <Plate>
          <div className="iss-det-head">
            <span className="iss-sev" data-sev={d.severity}>
              {d.severity}
            </span>
            <span className="iss-status mono" data-status={d.state.status}>
              {fx.status(d.state.status)}
            </span>
            <span className="mono muted">{d.id}</span>
          </div>
          <h2 className="iss-det-title">{fx.text(d.title)}</h2>
          <p className="iss-det-meta mono">
            {t("score")} {fx.score(d.score)} · {t("fails", { count: d.count })} · {t("failRate", { rate: fx.pct(d.fail_rate) })} · {fm.dateTimeLabel(d.last_seen)}
          </p>
          <p className="muted">{t("placeholder")}</p>
        </Plate>
      ) : null}
    </div>
  );
}
