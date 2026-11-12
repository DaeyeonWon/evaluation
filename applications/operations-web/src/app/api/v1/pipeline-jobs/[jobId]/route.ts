import { handle, ok } from "@/server/http";
import { pipelineJobDetail } from "@/server/services/pipelines";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/pipeline-jobs/[jobId]?job_scope=self|tree&limit=100 → PipelineJobDetail (root or child job; ignores range) */
export const GET = handle<{ jobId: string }>(async (req, ctx) => {
  const { jobId } = await ctx.params;
  return ok(pipelineJobDetail(decodeURIComponent(jobId), req));
});
