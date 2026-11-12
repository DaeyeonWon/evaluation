import { handle, ok } from "@/server/http";
import { reservations } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/reservations?status=ACTIVE,ORPHANED&language= → Reservation[] (newest first) */
export const GET = handle((req) => ok(reservations(req)));
