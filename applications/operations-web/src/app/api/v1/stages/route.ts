import { handle, ok } from "@/server/http";
import { stages } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/stages?range= → RangedList<StageSummary> */
export const GET = handle((req) => ok(stages(req)));
