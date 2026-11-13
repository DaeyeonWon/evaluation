import { handle } from "@/server/http";
import { issuesCsv } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/export.csv — every issue matching the filters as CSV (UTF-8 BOM, localized reasons) */
export const GET = handle(async (req) => issuesCsv(req));
