import { handle, ok } from "@/server/http";
import { replays } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/replays?range=&dead_letter_id=&status= → RangedList<Replay> (newest first) */
export const GET = handle((req) => ok(replays(req)));
