import { handle, ok } from "@/server/http";
import { listDeadLetters } from "@/server/services/dlq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dead-letters?status=&language=&category=&error_code=&operator=&q=&from=&to=&sort=&page=&pageSize= → DeadLetterList */
export const GET = handle((req) => ok(listDeadLetters(req)));
