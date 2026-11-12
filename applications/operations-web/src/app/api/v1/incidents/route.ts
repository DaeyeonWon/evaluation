import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { Incident } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/incidents → Incident[] */
export const GET = handle(() => ok<Incident[]>(getEngine().incidents));
