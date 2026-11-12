import { Query, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";
import { parseLang, patchLanguageCapacity } from "@/server/services/capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/languages/[lang]/capacity → LanguageCapacity */
export const GET = handle<{ lang: string }>(async (_req, ctx) => {
  const { lang } = await ctx.params;
  const code = parseLang(lang);
  return ok(getEngine().getCapacity().languages.find((l) => l.code === code));
});

/**
 * PATCH /api/v1/languages/[lang]/capacity?dry_run=1
 * body { max_concurrent?, priority_weight?, max_starts_per_minute?, paused?, enabled?, reason }
 * → CapacityChangeResult (reason required unless dry_run)
 */
export const PATCH = handle<{ lang: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { lang } = await ctx.params;
    const op = resolveOperator(req);
    const body = await readJson(req);
    const onlyPause = Object.keys(body).every((k) => k === "paused" || k === "reason");
    requirePermission(op, onlyPause ? "language.pause" : "config.write");
    const dryRun = Query.of(req).bool("dry_run") ?? false;
    return ok(patchLanguageCapacity(lang, body, op.id, dryRun));
  }),
);
