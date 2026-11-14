import { handle, ok } from "@/server/http";
import { issueMatrix } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/matrix?x=<IssueDim>&y=<IssueDim>&metric=fail_rate|fail_count|delta|issue_count&<filters> → IssueDimMatrix (§8.11) */
export const GET = handle(async (req) => ok(issueMatrix(req)));
