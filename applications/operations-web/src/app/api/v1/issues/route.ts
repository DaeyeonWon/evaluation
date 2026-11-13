import { handle, ok } from "@/server/http";
import { ensureIssueWatcher, listIssues } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues — ranked issue candidates (filters, sort, paging) → IssueListResponse */
export const GET = handle(async (req) => {
  ensureIssueWatcher();
  return ok(listIssues(req));
});
