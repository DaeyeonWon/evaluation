import { handle, ok } from "@/server/http";
import { workflowLogs } from "@/server/services/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id]/logs?component=&severity=&min_severity=&q=&attempt=&event_type=&trace_id=&order=&limit= → LogPage */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return ok(workflowLogs(decodeURIComponent(id), req));
});
