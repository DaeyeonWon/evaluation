import { handle, ok } from "@/server/http";
import { workflowPipelineRuns } from "@/server/services/workflows";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id]/pipeline-runs → WorkflowPipelineRuns (root + child job tree per attempt; ignores range) */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return ok(workflowPipelineRuns(decodeURIComponent(id)));
});
