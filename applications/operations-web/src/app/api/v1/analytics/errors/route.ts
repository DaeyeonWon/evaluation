import { handle, ok } from "@/server/http";
import { errors } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/errors?range=&top= → ErrorAnalytics */
export const GET = handle((req) => ok(errors(req)));
