import { handle, ok } from "@/server/http";
import { meta } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/meta → MetaCatalog (static; same data as '@/lib/catalog') */
export const GET = handle(() => ok(meta()));
