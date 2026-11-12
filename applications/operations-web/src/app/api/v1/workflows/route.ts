import { handle, ok } from "@/server/http";
import { listWorkflows } from "@/server/services/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows → WorkflowListResponse */
export const GET = handle((req) => ok(listWorkflows(req)));
