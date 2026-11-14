import { handle, ok } from "@/server/http";
import { issueBreakdown } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/breakdown?dim=<IssueDim>&<filters> → IssueBreakdown (docs/data-contract.md §8.11) */
export const GET = handle(async (req) => ok(issueBreakdown(req)));
