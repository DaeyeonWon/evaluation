import { handle, ok } from "@/server/http";
import { throughput } from "@/server/services/analytics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/throughput?range=&granularity=auto|hour|5m → ThroughputSeries */
export const GET = handle((req) => ok(throughput(req)));
