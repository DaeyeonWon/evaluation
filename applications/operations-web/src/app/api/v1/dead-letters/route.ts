import { handle, ok } from "@/server/http";
import { listDeadLetters } from "@/server/services/dlq";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dead-letters?range=&status=&language=&category=&error_code=&operator=&pipeline_id=&q=&sort=&page=&pageSize= → DeadLetterList (created_at in range) */
export const GET = handle((req) => ok(listDeadLetters(req)));
