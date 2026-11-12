import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { LanguageSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/languages → LanguageSummary[] */
export const GET = handle(() => ok<LanguageSummary[]>(getEngine().metrics.languageSummary()));
