import { handle, ok } from "@/server/http";
import { recentEvents } from "@/server/services/misc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/events?range=&limit=50&stage=&language=&severity=&name=&workflow_id=&pipeline_id=&component=&pipeline_job_id=&job_scope= → RangedList<WorkflowEvent> (newest first) */
export const GET = handle((req) => ok(recentEvents(req)));
