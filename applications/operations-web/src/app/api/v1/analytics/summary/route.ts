import { handle, ok } from "@/server/http";
import { summary } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/summary?range= → AnalyticsSummary (everything S7 needs, one call) */
export const GET = handle((req) => ok(summary(req)));
