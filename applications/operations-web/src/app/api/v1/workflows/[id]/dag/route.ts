import { handle, ok } from "@/server/http";
import { workflowDag } from "@/server/services/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id]/dag → WorkflowDag */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return ok(workflowDag(decodeURIComponent(id)));
});
