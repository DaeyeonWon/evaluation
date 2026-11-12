import { handle, ok } from "@/server/http";
import { deadLetterDetail } from "@/server/services/dlq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dead-letters/[id] → DeadLetterDetail  ([id] may also be the workflow_id) */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return ok(deadLetterDetail(decodeURIComponent(id)));
});
