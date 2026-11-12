import { handle, ok } from "@/server/http";
import { resultFileMeta } from "@/server/services/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/results/file → ResultFileMeta */
export const GET = handle(() => ok(resultFileMeta()));
