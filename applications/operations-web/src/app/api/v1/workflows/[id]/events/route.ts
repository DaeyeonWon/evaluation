import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import { getWorkflowOr404 } from "@/server/services/workflows";
import type { WorkflowEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id]/events → WorkflowEvent[] (ascending by ts, only ts <= now) */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const w = getWorkflowOr404(decodeURIComponent(id));
  const e = getEngine();
  const now = e.now();
  return ok<WorkflowEvent[]>(e.getEvents(w.workflow_id).filter((ev) => ev.ts <= now));
});
