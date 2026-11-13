"use client";
/**
 * One shared EventSource to /api/v1/stream for the whole app (mounted in the root layout).
 *
 *   const { snapshot, status } = useLiveStream();        // latest `tick` (TickSnapshot | null)
 *   const now = useSimNow();                              // virtual clock (ms) — use for relative times
 *   useStreamEvent("transition", (t) => flash(t.workflow_id));   // subscribe to a message type
 *   const { subscribe } = useLiveStream();                // imperative: subscribe(type, cb) → unsubscribe
 *
 * Reconnect: transient drops use the browser's native EventSource reconnect (server `retry: 3000`),
 * which sends `Last-Event-ID`, so the server replays what was missed (ids "<epoch>-<seq>", see
 * src/app/api/v1/stream/route.ts). Only when the EventSource gives up (readyState CLOSED, e.g. an
 * HTTP error status) is it recreated manually with exponential backoff (1s → 30s) and
 * `?last_event_id=<last seen id>` so backfill still works. A `hello` with `resync: true` (id unknown /
 * expired) revalidates every useApi query. EventSource can't see HTTP status, so after a connection
 * error the store asks /api/v1/auth/session; if the session is gone it redirects to /login?next=…
 * (src/lib/client/auth-redirect.ts). Snapshot/status are exposed through
 * useSyncExternalStore so components re-render only when they change.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { BASE_NOW } from "@/lib/catalog";
import type { StreamEventMap, StreamEventType, TickSnapshot } from "@/lib/types";
import { API_BASE } from "./api";
import { redirectToLogin, sessionExpired } from "./auth-redirect";
import { revalidateKey } from "./use-api";

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

type Handler<K extends StreamEventType> = (data: StreamEventMap[K]) => void;

const STREAM_TYPES: StreamEventType[] = ["hello", "tick", "transition", "event", "log", "alert", "audit", "dlq", "sim", "job"];

class LiveStreamStore {
  private es: EventSource | null = null;
  private handlers = new Map<StreamEventType, Set<Handler<StreamEventType>>>();
  private stateListeners = new Set<() => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refs = 0;
  /** last SSE id seen (for ?last_event_id= when the EventSource has to be recreated) */
  private lastEventId: string | null = null;
  snapshot: TickSnapshot | null = null;
  status: StreamStatus = "idle";
  lastMessageAt = 0;

  constructor(private url: string) {}

  private setStatus(s: StreamStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emitState();
  }
  private emitState() {
    this.stateListeners.forEach((l) => l());
  }
  subscribeState = (cb: () => void) => {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  };
  getSnapshot = () => this.snapshot;
  getStatus = () => this.status;

  subscribe = <K extends StreamEventType>(type: K, cb: Handler<K>): (() => void) => {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(cb as Handler<StreamEventType>);
    return () => {
      set!.delete(cb as Handler<StreamEventType>);
    };
  };

  private dispatch(type: StreamEventType, data: unknown) {
    this.lastMessageAt = Date.now();
    if (type === "tick") {
      this.snapshot = data as TickSnapshot;
      this.emitState();
    }
    this.handlers.get(type)?.forEach((h) => {
      try {
        h(data as never);
      } catch (e) {
        console.error("[live-stream handler]", type, e);
      }
    });
  }

  retain() {
    this.refs++;
    if (this.refs === 1) this.connect();
  }
  release() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0) this.disconnect();
  }

  private connect() {
    if (typeof window === "undefined" || this.es) return;
    this.setStatus(this.retry ? "reconnecting" : "connecting");
    const url = this.lastEventId ? `${this.url}${this.url.includes("?") ? "&" : "?"}last_event_id=${encodeURIComponent(this.lastEventId)}` : this.url;
    const es = new EventSource(url);
    this.es = es;
    es.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
    };
    for (const t of STREAM_TYPES) {
      es.addEventListener(t, (ev) => {
        const me = ev as MessageEvent<string>;
        if (me.lastEventId) this.lastEventId = me.lastEventId;
        let data: unknown;
        try {
          data = JSON.parse(me.data);
        } catch (e) {
          console.error("[live-stream parse]", t, e);
          return;
        }
        // the server couldn't replay what we missed → refetch everything that is mounted
        if (t === "hello" && (data as { resync?: boolean }).resync) revalidateKey(() => true);
        this.dispatch(t, data);
      });
    }
    es.onerror = () => {
      // the stream 401s when the session expires; EventSource only reports "error"
      void sessionExpired(API_BASE).then((gone) => gone && redirectToLogin());
      if (es.readyState !== EventSource.CLOSED) {
        // transient drop: the browser reconnects by itself and sends Last-Event-ID
        this.setStatus("reconnecting");
        return;
      }
      // hard failure (HTTP error / bad content type): recreate with backoff + ?last_event_id=
      es.close();
      this.es = null;
      if (this.refs === 0) return this.setStatus("closed");
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.setStatus("reconnecting");
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, delay);
    };
  }

  private disconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.es?.close();
    this.es = null;
    this.setStatus("closed");
  }
}

interface LiveStreamCtx {
  store: LiveStreamStore;
}

const Ctx = createContext<LiveStreamCtx | null>(null);

export function LiveStreamProvider({ children, types }: { children: ReactNode; types?: StreamEventType[] }) {
  const url = API_BASE + "/stream" + (types?.length ? "?types=" + types.join(",") : "");
  const storeRef = useRef<LiveStreamStore | null>(null);
  // eslint-disable-next-line react-hooks/refs -- lazy, stable singleton per provider
  if (!storeRef.current) storeRef.current = new LiveStreamStore(url);
  // eslint-disable-next-line react-hooks/refs -- stable after first render
  const store = storeRef.current;
  useEffect(() => {
    store.retain();
    return () => store.release();
  }, [store]);
  const value = useMemo(() => ({ store }), [store]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useStore(): LiveStreamStore {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLiveStream must be used inside <LiveStreamProvider> (mounted in the root layout).");
  return c.store;
}

export interface LiveStream {
  /** latest `tick` snapshot (null until the first one arrives — usually within ~100 ms) */
  snapshot: TickSnapshot | null;
  status: StreamStatus;
  subscribe: <K extends StreamEventType>(type: K, cb: (data: StreamEventMap[K]) => void) => () => void;
}

export function useLiveStream(): LiveStream {
  const store = useStore();
  const snapshot = useSyncExternalStore(store.subscribeState, store.getSnapshot, () => null);
  const status = useSyncExternalStore(store.subscribeState, store.getStatus, () => "idle" as StreamStatus);
  return { snapshot, status, subscribe: store.subscribe };
}

/** Simulator virtual "now" (epoch ms). Falls back to BASE_NOW before the first tick. */
export function useSimNow(): number {
  const { snapshot } = useLiveStream();
  return snapshot?.now ?? BASE_NOW;
}

/** Subscribe to one SSE message type for the component's lifetime. The latest `cb` is always used. */
export function useStreamEvent<K extends StreamEventType>(type: K, cb: (data: StreamEventMap[K]) => void): void {
  const store = useStore();
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => store.subscribe(type, (d) => ref.current(d)), [store, type]);
}

/** Non-hook access for code that already has the store (e.g. useApi). */
export function useLiveStreamSubscribe() {
  return useStore().subscribe;
}

export { LiveStreamStore };
