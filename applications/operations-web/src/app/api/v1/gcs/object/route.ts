import { handle, ok } from "@/server/http";
import { gcsObject } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/gcs/object?bucket=&name=&limit=20 → GcsObjectContent (metadata + text preview) */
export const GET = handle((req) => ok(gcsObject(req)));
