import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { Overview } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/overview → Overview */
export const GET = handle(() => ok<Overview>(getEngine().overview()));
