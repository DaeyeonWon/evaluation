import { handle, ok } from "@/server/http";
import { alerts } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/alerts?range=&status=&severity=&language= → RangedList<Alert> & { openOutsideRange } (opened_at in range) */
export const GET = handle((req) => ok(alerts(req)));
