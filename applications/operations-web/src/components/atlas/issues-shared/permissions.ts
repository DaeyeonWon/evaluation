"use client";
/**
 * Issue Report — triage permission helper. SHARED by every view (issues/*); views do not edit it (ask the framework engineer).
 *
 *   const perm = useIssuePermission();
 *   <button disabled={!perm.canWrite} title={perm.reason ?? undefined}>Triage</button>
 *   perm.next("NEW")  → ["TRIAGED", "IGNORED"]   (allowed transitions, same table as the server)
 *
 * UI hint only — the server enforces issues:write (proxy policy + route) and audits every change.
 */
import { useMemo } from "react";
import { useT } from "@/i18n/client";
import { useSession } from "@/lib/client";
import type { IssueStatus } from "@/lib/types";

export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  NEW: ["TRIAGED", "IGNORED"],
  TRIAGED: ["TICKETED", "RESOLVED", "IGNORED", "NEW"],
  TICKETED: ["RESOLVED", "IGNORED", "TRIAGED"],
  RESOLVED: ["NEW"],
  IGNORED: ["NEW"],
};
export const ISSUE_STATUS_ORDER: IssueStatus[] = ["NEW", "TRIAGED", "TICKETED", "RESOLVED", "IGNORED"];

export function useIssuePermission() {
  const { can } = useSession();
  const t = useT("issues");
  const canWrite = can("issues:write");
  return useMemo(
    () => ({
      canWrite,
      /** localized read-only reason (null when allowed) */
      reason: canWrite ? null : t("triage.readOnly"),
      next: (s: IssueStatus) => ISSUE_TRANSITIONS[s],
    }),
    [canWrite, t],
  );
}
