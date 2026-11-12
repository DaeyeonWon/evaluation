import { handle, ok } from "@/server/http";
import { quality } from "@/server/services/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/quality?range= → QualitySeries (success rate, retry rate, avg/p95 duration per hour) */
export const GET = handle((req) => ok(quality(req)));
