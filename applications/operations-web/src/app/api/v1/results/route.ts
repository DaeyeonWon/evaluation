import { handle, ok } from "@/server/http";
import { resultsPage } from "@/server/services/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/results?language=&capsule=&intent=&device=&version=&result=PASS|FAIL&failure_reason=&workflow_id=&batch_id=
 *   &q=&min_score=&max_score=&min_latency=&max_latency=&from=&to=&ids=&sort=&page=&pageSize= → ResultsPage
 */
export const GET = handle((req) => ok(resultsPage(req)));
