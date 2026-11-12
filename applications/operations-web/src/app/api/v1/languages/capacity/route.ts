import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { CapacitySnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/languages/capacity → CapacitySnapshot */
export const GET = handle(() => ok<CapacitySnapshot>(getEngine().getCapacity()));
