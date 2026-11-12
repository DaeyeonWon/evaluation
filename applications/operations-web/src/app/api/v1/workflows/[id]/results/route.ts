import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import { getWorkflowOr404 } from "@/server/services/workflows";
import type { ResultRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/[id]/results → { rows: ResultRow[]; summary: ResultsSummary | null } (only for SUCCEEDED workflows) */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const w = getWorkflowOr404(decodeURIComponent(id));
  const e = getEngine();
  const rows: ResultRow[] = e.results.byWorkflow(w.workflow_id);
  return ok({ rows, summary: rows.length ? e.results.summary(rows) : null });
});
