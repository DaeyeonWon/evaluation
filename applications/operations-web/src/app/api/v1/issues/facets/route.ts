import { handle, ok } from "@/server/http";
import { issueFacets } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/facets → IssueFacets (docs/data-contract.md "Issue Report") */
export const GET = handle(async (req) => ok(issueFacets(req)));
