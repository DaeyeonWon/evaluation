import { handle, ok } from "@/server/http";
import { gcsList } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/gcs/objects?bucket=&prefix=&delimiter=/&limit=&q=&range= (range=all disables) → GcsListing & { range } */
export const GET = handle((req) => ok(gcsList(req)));
