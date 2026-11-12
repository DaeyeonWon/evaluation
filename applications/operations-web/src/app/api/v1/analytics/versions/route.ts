import { handle, ok } from "@/server/http";
import { versions } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/versions?range= → RangedList<VersionComparison> */
export const GET = handle((req) => ok(versions(req)));
