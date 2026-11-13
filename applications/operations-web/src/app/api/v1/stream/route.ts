import type { NextRequest } from "next/server";
import type { StreamEventType } from "@/lib/types";
import { currentStreamSeq, currentTick, replaySince, simState, streamId, subscribe } from "@/server/mock/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;
const ALL: StreamEventType[] = ["tick", "transition", "event", "log", "alert", "audit", "dlq", "sim", "job"];

/**
 * GET /api/v1/stream?types=tick,transition,event,log,alert,audit,dlq,sim,job
 *
 * Server-Sent Events. Each message is `id: <epoch>-<seq>\nevent: <type>\ndata: <json>\n\n` where the
 * payload type is StreamEventMap[type] (src/lib/types.ts) and seq is monotonic across all types for
 * this server process. `retry: 3000` sets the browser's native reconnect delay.
 *
 * On connect the server sends `hello` ({ sim, serverTime, lastEventId, resumed, resync }), then:
 * - reconnect with a known id (`Last-Event-ID` header, which EventSource sends automatically, or
 *   `?last_event_id=` for a manually recreated EventSource): every buffered message after that id is
 *   replayed in order (`resumed: true`; see replaySince() — non-tick messages, ≤ 5,000 / ≤ 5 min);
 * - unknown / too old / other-process id: nothing is replayed and `hello.resync` is true → the
 *   client must refetch its data;
 * - then an immediate `tick` snapshot and live messages. `: keep-alive` comments every 15 s.
 * Subscribers are removed on abort. `types` filters the stream (default: all). `log` is high-volume
 * (~20-40/tick) — omit it if unused.
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
      const sendEvent = (type: string, data: unknown, seq?: number) =>
        send(`${seq != null ? `id: ${streamId(seq)}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

      // subscribe first and queue, so nothing published while we replay is lost or reordered
      let queue: { type: StreamEventType; data: unknown; seq: number }[] | null = [];
      const unsub = subscribe((type, data, seq) => {
        if (!want.has(type)) return;
        if (queue) queue.push({ type, data, seq });
        else sendEvent(type, data, seq);
      });

      const lastEventId = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("last_event_id");
      const replay = lastEventId ? replaySince(lastEventId) : null;
      const resync = !!lastEventId && replay === null;
      const upTo = currentStreamSeq();
      send(`retry: 3000\n: connected ${new Date().toISOString()}\n\n`);
      // hello carries the current id so a client that never saw a message can still resume later
      sendEvent("hello", { sim: simState(), serverTime: Date.now(), lastEventId: streamId(upTo), resumed: !!replay, resync }, upTo);
      for (const m of replay ?? []) if (m.seq <= upTo && want.has(m.type)) sendEvent(m.type, m.data, m.seq);
      if (want.has("tick")) sendEvent("tick", currentTick());
      const pending = queue;
      queue = null;
      for (const m of pending) if (m.seq > upTo) sendEvent(m.type, m.data, m.seq);
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
