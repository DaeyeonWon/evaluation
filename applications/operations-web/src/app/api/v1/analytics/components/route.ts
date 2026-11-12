import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { ComponentDuration } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/components → ComponentDuration[] */
export const GET = handle(() => ok<ComponentDuration[]>(getEngine().metrics.componentDurations()));
