import { handle, ok } from "@/server/http";
import { stageDetail } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/stages/[id]?limit=60 → StageDetail (workflows in stage, gcsObjects, events, logs, metrics) */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return ok(stageDetail(id, req));
});
