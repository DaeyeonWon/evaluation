import type { NextRequest } from "next/server";
import type { StreamEventType } from "@/lib/types";
import { currentTick, simState, subscribe } from "@/server/mock/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;
const ALL: StreamEventType[] = ["tick", "transition", "event", "log", "alert", "audit", "dlq", "sim"];

/**
 * GET /api/v1/stream?types=tick,transition,event,log,alert,audit,dlq,sim
 *
 * Server-Sent Events. Each message is `event: <type>\ndata: <json>\n\n` where the payload type is
 * StreamEventMap[type] (src/lib/types.ts). On connect the server sends `hello` (sim state) and an
 * immediate `tick` snapshot. `: keep-alive` comments every 15 s. Subscribers are removed on abort.
 * `types` filters the stream (default: all). `log` is high-volume (~20-40/tick) — omit it if unused.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requested = (req.nextUrl.searchParams.get("types") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as StreamEventType[];
  const want = new Set<StreamEventType>(requested.length ? requested.filter((t) => ALL.includes(t)) : ALL);
  const enc = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          stop();
        }
      };
      const sendEvent = (type: string, data: unknown) => send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

      send(`retry: 3000\n: connected ${new Date().toISOString()}\n\n`);
      sendEvent("hello", { sim: simState(), serverTime: Date.now() });
      if (want.has("tick")) sendEvent("tick", currentTick());

      const unsub = subscribe((type, data) => {
        if (want.has(type)) sendEvent(type, data);
      });
      const ka = setInterval(() => send(`: keep-alive ${Date.now()}\n\n`), KEEPALIVE_MS);

      function stop() {
        if (closed) return;
        closed = true;
        clearInterval(ka);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      cleanup = stop;
      req.signal.addEventListener("abort", stop, { once: true });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
