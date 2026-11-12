import { handle, ok } from "@/server/http";
import { listPipelines } from "@/server/services/pipelines";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/pipelines?range=&kind=root|sub → RangedList<PipelineSummary & { definition }> */
export const GET = handle((req) => ok(listPipelines(req)));
