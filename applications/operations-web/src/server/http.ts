/**
 * Route-handler helpers: JSON responses, localized 4xx errors, query parsing, operator/RBAC,
 * idempotency. Server-only.
 *
 * Errors: throw badRequest/notFound/… with either a plain string (sent as-is) or an `errors.*`
 * message key `{ key, vars }`. errorResponse() translates keys into the request's locale
 * (cookie `console_locale` → Accept-Language → default) and echoes the key in the body.
 *
 * Identity: the acting operator comes from the SERVER-SIDE session (src/server/auth — signed cookie in
 * mock mode, IAP / trusted OIDC header otherwise). The legacy client `x-operator` header is ignored.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextRequest } from "next/server";
import { ROLE_PERMISSIONS } from "@/lib/catalog";
import type { ApiErrorBody, Operator, Role } from "@/lib/types";
import { BUILTIN_PERMISSIONS, canonicalPermission, hasPermission, legacyRoleOf } from "@/config/schema";
import { sessionFromRequest } from "./auth/core";
import type { Session } from "./auth/types";
import { OPERATIONAL_PERMISSIONS } from "./auth/policy";
import { getRuntime } from "./mock/runtime";
import { recordAudit, requestAuditMeta } from "./services/audit";
import { translatorFor, tFor } from "@/i18n/request";
import type { Translator } from "@/i18n";

/** A var value may itself be a message key (resolved with the same translator), e.g. { key: "validation.reasonLabel" }. */
export type ErrorVars = Record<string, string | number | null | undefined | { key: string }>;
/** Plain text (sent as-is) or a key under the `errors` namespace. */
export type ErrorText = string | { key: string; vars?: ErrorVars };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public text: ErrorText,
    public details?: unknown,
  ) {
    super(typeof text === "string" ? text : text.key);
  }
}

export const badRequest = (m: ErrorText, details?: unknown) => new ApiError(400, "INVALID_ARGUMENT", m, details);
export const notFound = (m: ErrorText, details?: unknown) => new ApiError(404, "NOT_FOUND", m, details);
export const conflict = (m: ErrorText, details?: unknown) => new ApiError(409, "CONFLICT", m, details);
export const forbidden = (m: ErrorText, details?: unknown) => new ApiError(403, "FORBIDDEN", m, details);
export const unauthorized = (m: ErrorText = { key: "code.UNAUTHENTICATED" }) => new ApiError(401, "UNAUTHENTICATED", m);

const NO_STORE = { "cache-control": "no-store" };

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/** Translate an ErrorText with an `errors` translator (unknown key → the code's fallback text). */
export function errorMessage(text: ErrorText, code: string, t: Pick<Translator, "dynamic">): string {
  if (typeof text === "string") return text;
  const vars = text.vars
    ? Object.fromEntries(Object.entries(text.vars).map(([k, v]) => [k, v && typeof v === "object" ? t.dynamic(v.key, undefined, v.key) : v]))
    : undefined;
  return t.dynamic(text.key, vars, t.dynamic(`code.${code}`, undefined, code));
}

/** JSON error body in the request's locale (ko without a request). */
export function errorResponse(e: ApiError, req?: Request): Response {
  const t = req ? tFor(req, "errors") : translatorFor("ko", "errors");
  const key = typeof e.text === "string" ? undefined : e.text.key;
  const body: ApiErrorBody = {
    error: { code: e.code, message: errorMessage(e.text, e.code, t), ...(key ? { key } : {}), ...(e.details !== undefined ? { details: e.details } : {}) },
  };
  return Response.json(body, { status: e.status, headers: NO_STORE });
}

type Ctx<P> = { params: Promise<P> };

/** Current request for helpers that only receive an Operator (see requirePermission). */
const requestScope = new AsyncLocalStorage<{ req: NextRequest }>();

/** Wrap a handler: marks simulator activity, converts ApiError → JSON, hides internals on 500. */
export function handle<P = Record<string, never>>(fn: (req: NextRequest, ctx: Ctx<P>) => Promise<Response> | Response) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      // engine actions inside this request record its Idempotency-Key / User-Agent / IP in the audit log
      getRuntime().engine._internal.setAuditMeta(currentAuditMeta);
      return await requestScope.run({ req }, () => fn(req, ctx));
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e, req);
      console.error("[api]", req.method, req.nextUrl.pathname, e);
      return errorResponse(new ApiError(500, "INTERNAL", { key: "code.INTERNAL" }), req);
    }
  };
}

// ───────────────────────────────────────── query parsing ──
export class Query {
  constructor(private sp: URLSearchParams) {}
  static of(req: NextRequest) {
    return new Query(req.nextUrl.searchParams);
  }
  has(name: string) {
    return this.sp.has(name) && this.sp.get(name) !== "";
  }
  str(name: string): string | undefined {
    const v = this.sp.get(name);
    return v == null || v === "" ? undefined : v.trim();
  }
  /** comma-separated and/or repeated params → array (undefined if absent) */
  list(name: string): string[] | undefined {
    const all = this.sp.getAll(name).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    return all.length ? all : undefined;
  }
  enumList<T extends string>(name: string, allowed: readonly T[], label = name): T[] | undefined {
    const l = this.list(name);
    if (!l) return undefined;
    const bad = l.filter((v) => !allowed.includes(v as T));
    if (bad.length) throw badRequest({ key: "validation.enumInvalid", vars: { name: label, values: bad.join(", ") } }, { allowed });
    return l as T[];
  }
  enumOne<T extends string>(name: string, allowed: readonly T[], def?: T): T | undefined {
    const v = this.str(name);
    if (v == null) return def;
    if (!allowed.includes(v as T)) throw badRequest({ key: "validation.enumInvalid", vars: { name, values: v } }, { allowed });
    return v as T;
  }
  int(name: string, opts: { min?: number; max?: number; def?: number } = {}): number | undefined {
    const v = this.str(name);
    if (v == null) return opts.def;
    const n = Number(v);
    if (!Number.isInteger(n)) throw badRequest({ key: "validation.integer", vars: { name } });
    if (opts.min != null && n < opts.min) throw badRequest({ key: "validation.min", vars: { name, min: opts.min } });
    if (opts.max != null && n > opts.max) throw badRequest({ key: "validation.max", vars: { name, max: opts.max } });
    return n;
  }
  num(name: string, opts: { min?: number; max?: number } = {}): number | undefined {
    const v = this.str(name);
    if (v == null) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw badRequest({ key: "validation.number", vars: { name } });
    if (opts.min != null && n < opts.min) throw badRequest({ key: "validation.min", vars: { name, min: opts.min } });
    if (opts.max != null && n > opts.max) throw badRequest({ key: "validation.max", vars: { name, max: opts.max } });
    return n;
  }
  bool(name: string): boolean | undefined {
    const v = this.str(name);
    if (v == null) return undefined;
    if (["1", "true", "yes", "y"].includes(v.toLowerCase())) return true;
    if (["0", "false", "no", "n"].includes(v.toLowerCase())) return false;
    throw badRequest({ key: "validation.boolean", vars: { name } });
  }
  /** epoch ms number OR ISO-8601 string */
  time(name: string): number | undefined {
    const v = this.str(name);
    if (v == null) return undefined;
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (!Number.isFinite(n)) throw badRequest({ key: "validation.timestamp", vars: { name } });
    return n;
  }
  page(defSize = 50, maxSize = 500) {
    return { page: this.int("page", { min: 1, def: 1 })!, pageSize: this.int("pageSize", { min: 1, max: maxSize, def: defSize })! };
  }
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

// ───────────────────────────────────────── body parsing / validation ──
export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw badRequest({ key: "validation.invalidJson" });
  }
}

/** Field label for V.*: the field name, or an `errors.*` key resolved in the request locale. */
type Label = string | { key: string };

export const V = {
  int(body: Record<string, unknown>, key: string, min: number, max: number, label: Label = key): number | undefined {
    const v = body[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isInteger(v)) throw badRequest({ key: "validation.integer", vars: { name: label } }, { field: key });
    if (v < min || v > max) throw badRequest({ key: "validation.range", vars: { name: label, min, max } }, { field: key, min, max });
    return v;
  },
  bool(body: Record<string, unknown>, key: string, label: Label = key): boolean | undefined {
    const v = body[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "boolean") throw badRequest({ key: "validation.boolean", vars: { name: label } }, { field: key });
    return v;
  },
  str(body: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number; label?: Label } = {}): string | undefined {
    const v = body[key];
    const label = opts.label ?? key;
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      if (opts.required) throw badRequest({ key: "validation.required", vars: { name: label } }, { field: key });
      return undefined;
    }
    if (typeof v !== "string") throw badRequest({ key: "validation.string", vars: { name: label } }, { field: key });
    if (opts.max && v.length > opts.max) throw badRequest({ key: "validation.maxLength", vars: { name: label, max: opts.max } }, { field: key });
    return v.trim();
  },
  /** change reason — required for every state-changing call (plan §6.3 / §8 audit) */
  reason(body: Record<string, unknown>, key = "reason"): string {
    return V.str(body, key, { required: true, max: 500, label: { key: "validation.reasonLabel" } })!;
  },
};

// ───────────────────────────────────────── operator / RBAC ──
/** Session behind each Operator object handed out by resolveOperator (for requirePermission). */
const sessionOf = new WeakMap<Operator, Session>();

const legacyRole = (s: Session): Role => legacyRoleOf(s.permissions);

/** Session for this request, or 401. */
export function requireSession(req: NextRequest): Session {
  const s = sessionFromRequest(req);
  if (!s) throw unauthorized();
  return s;
}

/**
 * Resolve the acting operator from the server-side session (401 if none). Mock users map to the
 * engine's own operator; IAP/OIDC users become a synthetic operator (id = email). Either way the
 * operator is registered in the engine's operator index so audit entries record the session user's
 * name and role (not "System").
 */
export function resolveOperator(req: NextRequest): Operator {
  const s = requireSession(req);
  const e = getRuntime().engine;
  const role = legacyRole(s);
  const base = e.operators.find((o) => o.id === s.user.id) ?? e.operators.find((o) => o.email.toLowerCase() === s.user.email.toLowerCase());
  const op: Operator = base
    ? { ...base, role }
    : { id: s.user.id, name: s.user.name, email: s.user.email, role, team: s.user.team ?? "", lastActiveAt: e.now() };
  const known = e._internal.OP[op.id];
  if (!known || known.role !== op.role || known.name !== op.name) e._internal.OP[op.id] = op;
  sessionOf.set(op, s);
  return op;
}

/** Audit metadata of the request being handled (null outside handle()). */
function currentAuditMeta() {
  const r = requestScope.getStore()?.req;
  return r ? requestAuditMeta(r) : null;
}

/** Record a PERMISSION_DENIED audit entry for the current request (route-level 403). */
function auditDenied(op: Operator, required: string) {
  const r = requestScope.getStore()?.req;
  recordAudit({
    action: "PERMISSION_DENIED",
    actor: op.id,
    actorName: op.name,
    role: op.role,
    target: r ? `${r.method} ${r.nextUrl.pathname}` : "-",
    after: { required },
    result: "denied",
    req: r,
  });
}

/**
 * Throws 403 (and audits the denial) unless the operator holds `key` — or, for an array, at least
 * one of the keys. Route handlers pass the canonical console permissions used by
 * src/server/auth/policy.ts (`capacity:write`, `config:write`, `dlq:replay`, `workflow:cancel`,
 * `sim:control`, …). Legacy catalog keys (`config.write`, `cancel`, …) are still mapped through
 * canonicalPermission() for backward compatibility of external callers only.
 */
export function requirePermission(op: Operator, key: string | readonly string[]): void {
  const wanted = (typeof key === "string" ? [key] : [...key]).map(canonicalPermission);
  const perms = permissionsOfOperator(op);
  if (wanted.some((p) => hasPermission(perms, p))) return;
  const permission = wanted.join(" | ");
  auditDenied(op, permission);
  throw forbidden({ key: "permission.denied", vars: { action: permission, operator: op.name, role: op.role, permission } });
}

/** @deprecated use requirePermission(op, OPERATIONAL_PERMISSIONS) — any operational write permission. */
export function requireOperatorRole(op: Operator): void {
  requirePermission(op, OPERATIONAL_PERMISSIONS);
}

function permissionsOfOperator(op: Operator): string[] {
  const s = sessionOf.get(op);
  if (s) return s.permissions;
  // Operator object not from resolveOperator (should not happen in handlers): derive from legacy role.
  if (op.role === "Admin") return [...BUILTIN_PERMISSIONS];
  if (op.role === "Operator") return ["view", "capacity:write", "dlq:replay", "workflow:cancel"];
  return ["view"];
}

/**
 * Permission map for MeInfo: legacy catalog keys (read, cancel, config.write, …) as used by the UI,
 * plus every console permission key (view, capacity:write, hermes:access, …).
 */
export function permissionsOf(op: Operator): Record<string, boolean> {
  const perms = permissionsOfOperator(op);
  const out: Record<string, boolean> = Object.fromEntries(ROLE_PERMISSIONS.map((p) => [p.key, hasPermission(perms, p.key)]));
  for (const p of BUILTIN_PERMISSIONS) out[p] = hasPermission(perms, p);
  for (const p of perms) out[p] = true;
  return out;
}

// ───────────────────────────────────────── idempotency ──
const IDEM_TTL = 10 * 60_000;
/**
 * Optional `Idempotency-Key` header on POST/PATCH: the first 2xx/4xx JSON response for a key
 * (including ApiErrors thrown by the handler) is cached for 10 minutes and replayed verbatim (with
 * `idempotent-replay: true`) for retries. 5xx responses are not stored. The client keeps one key per
 * user action until it gets a 2xx/4xx (src/lib/client/api.ts).
 */
export async function idempotent(req: NextRequest, fn: () => Promise<Response>): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key) return fn();
  const rt = getRuntime();
  const now = Date.now();
  for (const [k, v] of rt.idempotency) if (now - v.at > IDEM_TTL) rt.idempotency.delete(k);
  const cacheKey = `${req.method} ${req.nextUrl.pathname} ${key}`;
  const hit = rt.idempotency.get(cacheKey);
  if (hit) return Response.json(hit.body, { status: hit.status, headers: { ...NO_STORE, "idempotent-replay": "true" } });
  let res: Response;
  try {
    res = await fn();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e; // unexpected → handle() answers 500, nothing cached
    res = errorResponse(e, req);
  }
  // 2xx and 4xx are final answers for this key; 5xx is not stored so a retry can succeed
  if (res.status < 500) {
    try {
      const body = await res.clone().json();
      rt.idempotency.set(cacheKey, { at: now, status: res.status, body });
    } catch {
      /* non-JSON: not cached */
    }
  }
  return res;
}
