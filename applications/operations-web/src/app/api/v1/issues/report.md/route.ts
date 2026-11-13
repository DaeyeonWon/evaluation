import { handle } from "@/server/http";
import { issuesMarkdown } from "@/server/services/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/issues/report.md — Markdown summary of the report in the request locale */
export const GET = handle(async (req) => issuesMarkdown(req));
