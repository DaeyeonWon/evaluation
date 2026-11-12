import { handle, ok } from "@/server/http";
import { resultsPage } from "@/server/services/results";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/results?range=&language=&capsule=&intent=&device=&version=&model_version=&pipeline_id=&result=PASS|FAIL&failure_reason=
 *   &workflow_id=&batch_id=&q=&min_score=&max_score=&min_latency=&max_latency=&ids=&sort=&page=&pageSize= → ResultsPage (eval_ts in range)
 */
export const GET = handle((req) => ok(resultsPage(req)));
