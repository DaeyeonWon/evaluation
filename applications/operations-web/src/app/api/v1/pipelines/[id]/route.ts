import { handle, ok } from "@/server/http";
import { pipelineDetail } from "@/server/services/pipelines";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/pipelines/[id]?version=&range= → PipelineDetail */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return ok(pipelineDetail(decodeURIComponent(id), req));
});
