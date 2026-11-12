import { handle, ok } from "@/server/http";
import { incidents } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/incidents?range= → RangedList<Incident> (incidents overlapping the range) */
export const GET = handle((req) => ok(incidents(req)));
