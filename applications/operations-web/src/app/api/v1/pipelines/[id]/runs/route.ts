import { handle, ok } from "@/server/http";
import { pipelineRuns } from "@/server/services/pipelines";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/pipelines/[id]/runs?range=&status=&version=&language=&workflow_id=&sort=start_desc|start_asc|duration_desc&page=&pageSize= → PipelineRunsPage */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return ok(pipelineRuns(decodeURIComponent(id), req));
});
