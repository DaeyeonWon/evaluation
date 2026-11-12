import { handle, ok } from "@/server/http";
import { alerts } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/alerts?status=OPEN,ACKNOWLEDGED&severity=&language= → Alert[] (newest first) */
export const GET = handle((req) => ok(alerts(req)));
