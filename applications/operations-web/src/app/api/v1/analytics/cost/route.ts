import { handle, ok } from "@/server/http";
import { cost } from "@/server/services/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/cost → CostAnalytics */
export const GET = handle(() => ok(cost()));
