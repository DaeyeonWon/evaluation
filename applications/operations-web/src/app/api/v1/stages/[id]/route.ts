import { handle, ok } from "@/server/http";
import { stageDetail } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/stages/[id]?range=&limit=60&q=&objects_limit=100 → StageDetail (workflows, objects, gcsObjects, events, logs, metrics) */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return ok(stageDetail(id, req));
});
