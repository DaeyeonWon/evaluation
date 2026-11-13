import { handle, ok } from "@/server/http";
import { issueInsights } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/insights → InsightList (docs/data-contract.md "Issue Report") */
export const GET = handle(async (req) => ok(issueInsights(req)));
