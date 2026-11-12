import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { VersionComparison } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/versions → VersionComparison[] */
export const GET = handle(() => ok<VersionComparison[]>(getEngine().metrics.versionComparison()));
