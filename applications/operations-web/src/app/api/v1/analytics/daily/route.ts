import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { DailyMetrics } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/daily → DailyMetrics[] (8 days, last one partial) */
export const GET = handle(() => ok<DailyMetrics[]>(getEngine().metrics.daily));
