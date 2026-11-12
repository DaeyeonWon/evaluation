import { handle, ok } from "@/server/http";
import { buckets } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/gcs/buckets → GcsBucket[] */
export const GET = handle(() => ok(buckets()));
