import { handle, ok } from "@/server/http";
import { workflowAttempts } from "@/server/services/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id]/attempts → AttemptHistory */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return ok(workflowAttempts(decodeURIComponent(id)));
});
