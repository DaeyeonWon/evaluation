import { handle, ok } from "@/server/http";
import { daily } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/daily?range= → RangedList<DailyMetrics> (KST days intersecting the range; today partial) */
export const GET = handle((req) => ok(daily(req)));
