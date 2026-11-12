import { handle, ok } from "@/server/http";
import { capacityHistory } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/capacity/history?range=&granularity=auto|5m|1h|6h → CapacityHistory */
export const GET = handle((req) => ok(capacityHistory(req)));
