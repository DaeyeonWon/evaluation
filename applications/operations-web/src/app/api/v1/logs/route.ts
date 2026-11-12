import { handle, ok } from "@/server/http";
import { globalLogs } from "@/server/services/workflows";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/logs?range=&system=1&workflow_id=&service=&component=&severity=&min_severity=&language=&pipeline_job_id=&job_scope=&pipeline_id=&node_path=&q=&limit=200&order=desc → LogPage */
export const GET = handle((req) => ok(globalLogs(req)));
