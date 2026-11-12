import { handle, ok } from "@/server/http";
import { languages } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/languages?range= → RangedList<LanguageSummary> */
export const GET = handle((req) => ok(languages(req)));
