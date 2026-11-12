import { handle } from "@/server/http";
import { resultsCsv } from "@/server/services/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/results/csv?<same filters as /results>&ids=&columns=&filename= → text/csv (UTF-8 BOM, attachment) */
export const GET = handle((req) => resultsCsv(req));
