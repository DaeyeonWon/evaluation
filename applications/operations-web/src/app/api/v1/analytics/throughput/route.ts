import { handle, ok } from "@/server/http";
import { throughput } from "@/server/services/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/throughput?granularity=hour|5m&range=6h|12h|24h|48h|7d → ThroughputSeries */
export const GET = handle((req) => ok(throughput(req)));
