import { handle, ok } from "@/server/http";
import { getWorkflowOr404 } from "@/server/services/workflows";
import type { Workflow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id] → Workflow (full document incl. attempts + dag) */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return ok<Workflow>(getWorkflowOr404(decodeURIComponent(id)));
});
