"use client";
/**
 * Issue Report — triage + export actions with localized toasts. SHARED by every view (issues/*); views do not edit it (ask the framework engineer).
 *
 *   const tri = useIssueTriage();
 *   await tri.setStatus(issue, "TRIAGED", { reason })   // toast "<issue title> → Triaged" (id without a title); 403 → localized toast
 *   await tri.update(issue.id, { owner: "op-park-jh", note: "…", ticket_id: "BIXBY-1" })
 *   tri.pending === issue.id
 *
 *   const ex = useIssueExport(f, { issueBase: "/issues/a" });  // f = useIssueFilters(); issueBase optional (Markdown issue links)
 *   <a href={ex.csvUrl} download>…</a>      // CSV of every issue matching the filters
 *   <a href={ex.markdownUrl} download>…</a>
 *   await ex.copyMarkdown()                 // fetches report.md, copies, toasts
 *
 * Toasts need the shell's ToastProvider (always mounted in the console layout).
 */
import { useCallback, useMemo } from "react";
import { useT } from "@/i18n/client";
import { api } from "@/lib/client";
import { formatIssueText } from "@/lib/issue-text";
import type { Issue, IssuePatch, IssueStatus } from "@/lib/types";
import { copyText, useToast } from "../ui";
import { useIssueActions } from "./data";
import type { IssueFiltersApi } from "./filters";

export function useIssueTriage() {
  const { patch, pending } = useIssueActions();
  const toast = useToast();
  const t = useT("issues");
  const update = useCallback(
    async (id: string, body: IssuePatch, label?: string) => {
      try {
        const r = await patch(id, body);
        toast.ok(body.status ? t("actions.updated", { id: label || id, status: t.dynamic(`status.${r.state.status}`, undefined, r.state.status) }) : t("actions.saved"));
        return r;
      } catch (e) {
        toast.err(e);
        return null;
      }
    },
    [patch, toast, t],
  );
  const setStatus = useCallback(
    // the toast names the issue by its localized title when the caller passes the issue (falls back to the id)
    (issue: Pick<Issue, "id"> & Partial<Pick<Issue, "title">>, status: IssueStatus, extra: Omit<IssuePatch, "status"> = {}) =>
      update(issue.id, { ...extra, status }, issue.title ? formatIssueText(t, issue.title) : undefined),
    [update, t],
  );
  return { update, setStatus, pending };
}

/** `opts.issueBase` (e.g. "/issues/a") adds per-issue deep links to the Markdown report. */
export function useIssueExport(f: Pick<IssueFiltersApi, "query">, opts: { issueBase?: string } = {}) {
  const toast = useToast();
  const t = useT("issues");
  const { issueBase } = opts;
  const mdQuery = useMemo(() => (issueBase ? { ...f.query, issue_base: issueBase } : f.query), [f.query, issueBase]);
  const csvUrl = useMemo(() => api.issuesCsvUrl(f.query), [f.query]);
  const markdownUrl = useMemo(() => api.issueReportUrl(mdQuery), [mdQuery]);
  const copyMarkdown = useCallback(async () => {
    try {
      const md = await api.issueReportMarkdown(mdQuery);
      const ok = await copyText(md);
      if (ok) toast.ok(t("actions.copied"));
      else toast.err(new Error(t("actions.copyFailed")));
      return ok;
    } catch (e) {
      toast.err(e);
      return false;
    }
  }, [mdQuery, toast, t]);
  return { csvUrl, markdownUrl, copyMarkdown };
}
