import { Query, handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import type { Replay } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/replays?dead_letter_id=&status= → Replay[] (newest first) */
export const GET = handle((req) => {
  const q = Query.of(req);
  const dl = q.str("dead_letter_id");
  const st = q.list("status");
  const rows = getEngine().replays.filter((r) => (!dl || r.dead_letter_id === dl) && (!st || st.includes(r.status)));
  return ok<Replay[]>([...rows].sort((a, b) => b.created_at - a.created_at));
});
