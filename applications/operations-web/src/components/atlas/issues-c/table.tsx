"use client";
/**
 * Signal Lab — the issue ledger under the linked views: every issue that survives the URL filters
 * and the lab brushes (quadrant / pattern), ranked, with the score anatomy strip per row.
 */
import clsx from "clsx";
import { CheckCircle2, CircleDot, ClipboardCheck, MinusCircle, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { Issue, IssueStatus } from "@/lib/types";
import { ISSUE_SORTS, useIssueFormat, type IssueFiltersApi, type IssueSort } from "../issues-shared";
import { Empty } from "../ui";
import { FACTOR_KEYS, deltaDir, factor, sparkPath } from "./lab";

const ST_ICON: Record<IssueStatus, ReactNode> = {
  NEW: <CircleDot aria-hidden />,
  TRIAGED: <ClipboardCheck aria-hidden />,
  TICKETED: <Ticket aria-hidden />,
  RESOLVED: <CheckCircle2 aria-hidden />,
  IGNORED: <MinusCircle aria-hidden />,
};

export function StatusPill({ status }: { status: IssueStatus }) {
  const fx = useIssueFormat();
  return (
    <span className="lab-st" data-status={status} title={fx.statusHelp(status)}>
      {ST_ICON[status]} {fx.status(status)}
    </span>
  );
}

export function Anatomy({ i, compact }: { i: Issue; compact?: boolean }) {
  const fx = useIssueFormat();
  const tip = FACTOR_KEYS.map((k) => `${fx.factor(k)} ${factor(i, k)?.contribution.toFixed(1) ?? 0}`).join(" · ");
  return (
    <span className={clsx("lab-anat", compact && "compact")} title={tip} aria-label={tip}>
      {FACTOR_KEYS.map((k) => {
        const c = factor(i, k)?.contribution ?? 0;
        return c > 0 ? <i key={k} data-k={k} style={{ width: `${c}%` }} /> : null;
      })}
    </span>
  );
}

const PAGE = 25;

export function IssueTable({ items, f, page, setPage }: { items: Issue[]; f: IssueFiltersApi; page: number; setPage: (p: number) => void }) {
  const t = useT("issuesC");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const p = Math.min(page, pages);
  const rows = items.slice((p - 1) * PAGE, p * PAGE);

  return (
    <div className="lab-table">
      <div className="lab-viewbar">
        <span className="mono muted">{t("table.count", { n: fm.number(items.length) })}</span>
        <label className="lab-sort">
          <span className="sr">{s("filters.sort")}</span>
          <select className="in" value={f.values.sort} onChange={(e) => f.set({ sort: e.target.value as IssueSort })} aria-label={s("filters.sort")}>
            {ISSUE_SORTS.map((x) => (
              <option key={x} value={x}>
                {s(`sort.${x}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!items.length ? (
        <Empty title={s("empty.issues")}>{t("table.emptyHint")}</Empty>
      ) : (
        <div className="tbl-wrap lab-t-wrap">
          <table className="t lab-t">
            <thead>
              <tr>
                <th className="r">#</th>
                <th>{s("field.severity")}</th>
                <th>{s("field.issue")}</th>
                <th>{s("field.score")}</th>
                <th className="r">FAIL</th>
                <th className="r">{s("field.failRate")}</th>
                <th className="r">{s("field.delta")}</th>
                <th>{t("table.trend")}</th>
                <th>{s("field.markets")}</th>
                <th>{s("field.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const dd = deltaDir(i.delta);
                const sel = f.selected === i.id;
                return (
                  <tr
                    key={i.id}
                    className={clsx("click", sel && "sel")}
                    tabIndex={0}
                    aria-selected={sel}
                    onClick={() => f.select(sel ? null : i.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        f.select(sel ? null : i.id);
                      }
                    }}
                  >
                    <td className="r mono muted c-rank">{i.rank}</td>
                    <td className="c-sev">
                      <span className="iss-sev" data-sev={i.severity} title={fx.severityHelp(i.severity)}>
                        {i.severity}
                      </span>
                    </td>
                    <td className="cellwrap lab-t-issue c-issue">
                      <b>{fx.text(i.title)}</b>
                      <span className="lab-t-sig mono">
                        <span className="lab-cls" data-cls={i.severity_class}>
                          {fx.cls(i.severity_class)}
                        </span>{" "}
                        {fx.fn(i.signature.agent_function)} · {fx.reason(i.signature.failure_reason)}
                        {i.novelty === "new" ? <span className="lab-newtag">{t("tag.novel")}</span> : null}
                        {i.regression ? <span className="lab-regtag">{fx.factor("regression")}</span> : null}
                      </span>
                      {i.reasons[0] ? <span className="lab-t-why">{fx.text(i.reasons[0])}</span> : null}
                    </td>
                    <td className="c-score">
                      <span className="lab-t-score">
                        <b className="mono">{fx.score(i.score)}</b>
                        <Anatomy i={i} compact />
                      </span>
                    </td>
                    <td className="r mono c-n" data-label="FAIL">{fm.number(i.count)}</td>
                    <td className="r mono c-rate" data-label={s("field.failRate")}>{fx.pct(i.fail_rate)}</td>
                    <td className="r mono c-delta" data-label={s("field.delta")}>
                      <span className="lab-delta" data-dir={i.delta == null ? "flat" : dd}>
                        {i.delta == null ? fx.value("novelty", "new") : fx.pp(i.delta)}
                      </span>
                    </td>
                    <td className="c-trend" data-label={t("table.trend")}>
                      <svg className="lab-tspark" viewBox="0 0 64 18" preserveAspectRatio="none" aria-hidden style={{ ["--tc" as string]: `var(--sev-${i.severity.toLowerCase()})` }}>
                        <polyline points={sparkPath(i.spark, 64, 18)} />
                      </svg>
                    </td>
                    <td className="mono lab-t-mk c-mk">{i.markets.join(" ")}</td>
                    <td className="c-st">
                      <StatusPill status={i.state.status} />
                      {i.state.owner_name ? <span className="lab-t-owner">{i.state.owner_name}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <div className="lab-pager">
          <button type="button" className="btn sm" disabled={p <= 1} onClick={() => setPage(p - 1)}>
            ←
          </button>
          <span className="mono">
            {p} / {pages}
          </span>
          <button type="button" className="btn sm" disabled={p >= pages} onClick={() => setPage(p + 1)}>
            →
          </button>
        </div>
      ) : null}
    </div>
  );
}
