import { V, badRequest, handle, ok, readJson } from "@/server/http";
import { currentTick, getEngine, setPaused, setSpeed, simState, step } from "@/server/mock/runtime";
import { toSummary } from "@/server/mock/projections";
import { LANG_CODES } from "@/lib/catalog";
import type { LangCode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/sim → { sim: SimState; snapshot: TickSnapshot } */
export const GET = handle(() => ok({ sim: simState(), snapshot: currentTick() }));

/**
 * POST /api/v1/sim  body:
 *   { action: "pause" } | { action: "resume" } | { action: "speed", speed: 0.25..20 }
 *   | { action: "step", steps?: 1..50 } | { action: "inject", language?: "ko"|"en"|"ja"|"es" }
 * → { sim: SimState; snapshot?: TickSnapshot; workflow?: WorkflowSummary }
 */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const action = V.str(body, "action", { required: true });
  switch (action) {
    case "pause":
      return ok({ sim: setPaused(true) });
    case "resume":
      return ok({ sim: setPaused(false) });
    case "speed": {
      const s = body.speed;
      if (typeof s !== "number" || !Number.isFinite(s) || s < 0.25 || s > 20) throw badRequest("speed는 0.25~20 사이 숫자여야 합니다.");
      return ok({ sim: setSpeed(s) });
    }
    case "step": {
      const n = V.int(body, "steps", 1, 50) ?? 1;
      const snapshot = step(n);
      return ok({ sim: simState(), snapshot });
    }
    case "inject": {
      const lang = V.str(body, "language");
      if (lang && !LANG_CODES.includes(lang as LangCode)) throw badRequest("language는 ko, en, ja, es 중 하나입니다.");
      const wf = getEngine().actions.injectBatch(lang ? { language: lang as LangCode } : {});
      return ok({ sim: simState(), workflow: toSummary(wf) }, 201);
    }
    default:
      throw badRequest("action은 pause, resume, speed, step, inject 중 하나입니다.");
  }
});
