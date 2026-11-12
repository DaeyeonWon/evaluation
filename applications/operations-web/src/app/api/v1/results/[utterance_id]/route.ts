import { handle, ok } from "@/server/http";
import { resultDetail } from "@/server/services/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/results/[utterance_id] → ResultDetail */
export const GET = handle<{ utterance_id: string }>(async (_req, ctx) => {
  const { utterance_id } = await ctx.params;
  return ok(resultDetail(decodeURIComponent(utterance_id)));
});
