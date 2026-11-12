import { handle, ok } from "@/server/http";
import { overview } from "@/server/services/overview";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/overview?range= → Overview (live today KPIs + inRange KPIs) */
export const GET = handle((req) => ok(overview(req)));
