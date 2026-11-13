import { handle, idempotent, ok } from "@/server/http";
import { issueDetail, patchIssue } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/[id] → IssueDetail (factors, paged utterances, trend, breakdowns, workflows, similar) */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return ok(issueDetail(req, decodeURIComponent(id)));
});

/** PATCH /api/v1/issues/[id]  body IssuePatch { status?, owner?, note?, ticket_id?, reason? } → IssuePatchResult (issues:write) */
export const PATCH = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    return ok(await patchIssue(req, decodeURIComponent(id)));
  }),
);
