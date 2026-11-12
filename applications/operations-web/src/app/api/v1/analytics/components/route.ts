import { handle, ok } from "@/server/http";
import { components } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/components?range= → RangedList<ComponentDuration> (per leaf component, all pipelines) */
export const GET = handle((req) => ok(components(req)));
