import { handle, ok } from "@/server/http";
import { fileSearch } from "@/server/services/files";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/files/search?q=&stage=&bucket=&language=&range=|from=&to=&limit=100 → FileSearchResult */
export const GET = handle((req) => ok(fileSearch(req)));
