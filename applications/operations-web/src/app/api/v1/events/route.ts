import { handle, ok } from "@/server/http";
import { recentEvents } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/events?limit=50&stage=&language=&severity=&name= → WorkflowEvent[] (newest first, ts <= now) */
export const GET = handle((req) => ok(recentEvents(req)));
