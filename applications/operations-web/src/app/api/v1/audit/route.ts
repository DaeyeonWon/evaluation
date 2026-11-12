import { handle, ok } from "@/server/http";
import { auditPage } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/audit?actor=&action=&target=&q=&from=&to=&page=&pageSize= → Paginated<AuditEntry> (newest first) */
export const GET = handle((req) => ok(auditPage(req)));
