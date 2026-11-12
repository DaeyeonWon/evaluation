import { handle, ok } from "@/server/http";
import { auditPage } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/audit?range=&actor=&action=&target=&q=&page=&pageSize= → Paginated<AuditEntry> & { range } (newest first) */
export const GET = handle((req) => ok(auditPage(req)));
