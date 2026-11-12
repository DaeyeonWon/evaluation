/**
 * Server-side singleton: one mock engine + one simulator per Node process.
 *
 * - Cached on globalThis so dev HMR and multiple route bundles share the SAME state.
 * - The simulator ticks every TICK_MS (1.2 s) and advances the VIRTUAL clock by 20 s × speed.
 * - Idle guard: when nobody is connected to /api/v1/stream and no API request arrived for
 *   IDLE_AFTER_MS, ticks are skipped (memory stays bounded on a forgotten dev server).
 *   The next request or stream connection resumes it automatically.
 * - Demo day loop: at 1× the virtual clock crosses KST midnight after ~34 real minutes, which
 *   would zero every "오늘" KPI and let result rows grow without bound. When the virtual date
 *   leaves the seeded day, the engine is re-seeded (same deterministic data) and SSE
 *   subscribers, speed and pause carry over; a "sim" message tells clients to refetch.
 * - Every engine bus event is re-broadcast to SSE subscribers in a compact, JSON-safe form.
 */
import type {
  ActiveWorkflowPos,
  Alert,
  AuditEntry,
  DeadLetter,
  LogEntry,
  SimState,
  StreamEventMap,
  StreamEventType,
  TickSnapshot,
  TransitionMessage,
  Workflow,
  WorkflowEvent,
} from "@/lib/types";
import { createMockEngine } from "./engine";
import type { MockEngine, MockSimulator } from "./engine-types";
import { buildTick, toActivePos } from "./projections";

export const TICK_MS = 1200;
export const IDLE_AFTER_MS = 120_000;
export const SIM_SEED = 4242;

type Listener = <K extends StreamEventType>(type: K, data: StreamEventMap[K]) => void;

export interface Runtime {
  engine: MockEngine;
  sim: MockSimulator;
  paused: boolean;
  speed: number;
  tickNo: number;
  lastActivity: number;
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<Listener>;
  lastTick: TickSnapshot | null;
  idempotency: Map<string, { at: number; status: number; body: unknown }>;
  createdAt: number;
}

const G = globalThis as unknown as { __aipoRuntime?: Runtime };

function broadcast<K extends StreamEventType>(rt: Runtime, type: K, data: StreamEventMap[K]) {
  for (const l of rt.listeners) {
    try {
      l(type, data);
    } catch {
      /* a broken subscriber must never break the simulator */
    }
  }
}

function kstDay(rt: Runtime, t: number): string {
  return rt.engine._internal.isoKst(t).slice(0, 10);
}

function createRuntime(carry?: Pick<Runtime, "listeners" | "speed" | "paused" | "tickNo">): Runtime {
  const engine = createMockEngine(globalThis) as unknown as MockEngine;
  const sim = engine.createSimulator({ seed: SIM_SEED, tickMs: TICK_MS });
  if (carry && carry.speed !== 1) sim.setSpeed(carry.speed);
  const rt: Runtime = {
    engine,
    sim,
    paused: carry?.paused ?? false,
    speed: carry?.speed ?? 1,
    tickNo: carry?.tickNo ?? 0,
    lastActivity: Date.now(),
    timer: null,
    listeners: carry?.listeners ?? new Set(),
    lastTick: null,
    idempotency: new Map(),
    createdAt: Date.now(),
  };

  engine.on("transition", (p: { workflow: Workflow; from: TransitionMessage["from"]; to: TransitionMessage["to"]; stage: TransitionMessage["stage"]; at: number; workflow_id: string; language: TransitionMessage["language"] }) => {
    const msg: TransitionMessage = {
      workflow_id: p.workflow_id,
      language: p.language,
      from: p.from,
      to: p.to,
      stage: p.stage,
      at: p.at,
      workflow: toActivePos(p.workflow),
    };
    broadcast(rt, "transition", msg);
  });
  engine.on("event", (e: WorkflowEvent) => broadcast(rt, "event", e));
  engine.on("log", (l: LogEntry) => broadcast(rt, "log", l));
  engine.on("alert", (a: Alert) => broadcast(rt, "alert", a));
  engine.on("audit", (a: AuditEntry) => broadcast(rt, "audit", a));
  engine.on("dlq", (d: DeadLetter) => broadcast(rt, "dlq", d));

  rt.timer = setInterval(() => {
    if (rt.paused || isIdle(rt)) return;
    rt.sim.tick();
    rt.tickNo++;
    if (rollDayIfNeeded(rt)) return;
    const snap = buildTick(rt);
    rt.lastTick = snap;
    broadcast(rt, "tick", snap);
  }, TICK_MS);
  // never keep the process alive just for the simulator
  (rt.timer as unknown as { unref?: () => void }).unref?.();
  return rt;
}

/** Re-seed the runtime once the virtual clock leaves the seeded KST day. Returns true if it did. */
function rollDayIfNeeded(rt: Runtime): boolean {
  if (kstDay(rt, rt.engine.now()) === kstDay(rt, rt.engine.meta.baseNow)) return false;
  if (rt.timer) clearInterval(rt.timer);
  const next = createRuntime({ listeners: rt.listeners, speed: rt.speed, paused: rt.paused, tickNo: rt.tickNo });
  G.__aipoRuntime = next;
  const snap = buildTick(next);
  next.lastTick = snap;
  broadcast(next, "sim", simState(next));
  broadcast(next, "tick", snap);
  return true;
}

function isIdle(rt: Runtime): boolean {
  return rt.listeners.size === 0 && Date.now() - rt.lastActivity > IDLE_AFTER_MS;
}

/** Get (lazily create) the process-wide runtime. Marks activity (keeps the simulator awake). */
export function getRuntime(): Runtime {
  if (!G.__aipoRuntime) G.__aipoRuntime = createRuntime();
  G.__aipoRuntime.lastActivity = Date.now();
  return G.__aipoRuntime;
}

export function getEngine(): MockEngine {
  return getRuntime().engine;
}

export function subscribe(listener: Listener): () => void {
  const rt = getRuntime();
  rt.listeners.add(listener);
  return () => {
    rt.listeners.delete(listener);
    rt.lastActivity = Date.now();
  };
}

export function simState(rt: Runtime = getRuntime()): SimState {
  const now = rt.engine.now();
  return {
    running: !rt.paused,
    speed: rt.speed,
    tick: rt.tickNo,
    now,
    nowIso: rt.engine._internal.isoKst(now),
    baseNow: rt.engine.meta.baseNow,
    idle: isIdle(rt),
    subscribers: rt.listeners.size,
  };
}

export function setPaused(paused: boolean): SimState {
  const rt = getRuntime();
  rt.paused = paused;
  const s = simState(rt);
  broadcast(rt, "sim", s);
  return s;
}

export function setSpeed(speed: number): SimState {
  const rt = getRuntime();
  rt.speed = speed;
  rt.sim.setSpeed(speed);
  const s = simState(rt);
  broadcast(rt, "sim", s);
  return s;
}

/** Advance the simulator synchronously by n ticks (works while paused). */
export function step(n: number): TickSnapshot {
  const rt = getRuntime();
  let cur = rt;
  for (let i = 0; i < n; i++) {
    cur.sim.tick();
    cur.tickNo++;
    if (rollDayIfNeeded(cur)) cur = G.__aipoRuntime!;
  }
  const rtNow = cur;
  const snap = buildTick(rtNow);
  rtNow.lastTick = snap;
  broadcast(rtNow, "tick", snap);
  return snap;
}

/** Latest tick snapshot (computed on demand if the simulator has not ticked yet). */
export function currentTick(): TickSnapshot {
  const rt = getRuntime();
  return buildTick(rt);
}

export type { ActiveWorkflowPos };
