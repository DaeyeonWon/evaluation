/**
 * Route-handler helpers: JSON responses, Korean 4xx errors, query parsing, operator/RBAC,
 * idempotency. Server-only.
 */
import type { NextRequest } from "next/server";
import { DEFAULT_OPERATOR_ID, ROLE_PERMISSIONS } from "@/lib/catalog";
import type { ApiErrorBody, Operator } from "@/lib/types";
import { getRuntime } from "./mock/runtime";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "INVALID_ARGUMENT", message, details);
export const notFound = (message: string) => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, "CONFLICT", message, details);
export const forbidden = (message: string) => new ApiError(403, "FORBIDDEN", message);

const NO_STORE = { "cache-control": "no-store" };

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function errorResponse(e: ApiError): Response {
  const body: ApiErrorBody = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } };
  return Response.json(body, { status: e.status, headers: NO_STORE });
}

type Ctx<P> = { params: Promise<P> };

/** Wrap a handler: marks simulator activity, converts ApiError → JSON, hides internals on 500. */
export function handle<P = Record<string, never>>(fn: (req: NextRequest, ctx: Ctx<P>) => Promise<Response> | Response) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      getRuntime();
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      console.error("[api]", req.method, req.nextUrl.pathname, e);
      return errorResponse(new ApiError(500, "INTERNAL", "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."));
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
    if (bad.length) throw badRequest(`${label} 값이 올바르지 않습니다: ${bad.join(", ")}`, { allowed });
    return l as T[];
  }
  enumOne<T extends string>(name: string, allowed: readonly T[], def?: T): T | undefined {
    const v = this.str(name);
    if (v == null) return def;
    if (!allowed.includes(v as T)) throw badRequest(`${name} 값이 올바르지 않습니다: ${v}`, { allowed });
    return v as T;
  }
  int(name: string, opts: { min?: number; max?: number; def?: number } = {}): number | undefined {
    const v = this.str(name);
    if (v == null) return opts.def;
    const n = Number(v);
    if (!Number.isInteger(n)) throw badRequest(`${name}는 정수여야 합니다.`);
    if (opts.min != null && n < opts.min) throw badRequest(`${name}는 ${opts.min} 이상이어야 합니다.`);
    if (opts.max != null && n > opts.max) throw badRequest(`${name}는 ${opts.max} 이하여야 합니다.`);
    return n;
  }
  num(name: string, opts: { min?: number; max?: number } = {}): number | undefined {
    const v = this.str(name);
    if (v == null) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw badRequest(`${name}는 숫자여야 합니다.`);
    if (opts.min != null && n < opts.min) throw badRequest(`${name}는 ${opts.min} 이상이어야 합니다.`);
    if (opts.max != null && n > opts.max) throw badRequest(`${name}는 ${opts.max} 이하여야 합니다.`);
    return n;
  }
  bool(name: string): boolean | undefined {
    const v = this.str(name);
    if (v == null) return undefined;
    if (["1", "true", "yes", "y"].includes(v.toLowerCase())) return true;
    if (["0", "false", "no", "n"].includes(v.toLowerCase())) return false;
    throw badRequest(`${name}는 true/false 여야 합니다.`);
  }
  /** epoch ms number OR ISO-8601 string */
  time(name: string): number | undefined {
    const v = this.str(name);
    if (v == null) return undefined;
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (!Number.isFinite(n)) throw badRequest(`${name}는 epoch ms 또는 ISO-8601 시각이어야 합니다.`);
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
    throw badRequest("요청 본문이 올바른 JSON 객체가 아닙니다.");
  }
}

export const V = {
  int(body: Record<string, unknown>, key: string, min: number, max: number, label = key): number | undefined {
    const v = body[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isInteger(v)) throw badRequest(`${label}는 정수여야 합니다.`, { field: key });
    if (v < min || v > max) throw badRequest(`${label}는 ${min}~${max} 범위여야 합니다.`, { field: key, min, max });
    return v;
  },
  bool(body: Record<string, unknown>, key: string, label = key): boolean | undefined {
    const v = body[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "boolean") throw badRequest(`${label}는 true/false 여야 합니다.`, { field: key });
    return v;
  },
  str(body: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number; label?: string } = {}): string | undefined {
    const v = body[key];
    const label = opts.label ?? key;
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      if (opts.required) throw badRequest(`${label}을(를) 입력해 주세요.`, { field: key });
      return undefined;
    }
    if (typeof v !== "string") throw badRequest(`${label}는 문자열이어야 합니다.`, { field: key });
    if (opts.max && v.length > opts.max) throw badRequest(`${label}는 ${opts.max}자 이하여야 합니다.`, { field: key });
    return v.trim();
  },
  /** change reason — required for every state-changing call (plan §6.3 / §8 audit) */
  reason(body: Record<string, unknown>, key = "reason"): string {
    return V.str(body, key, { required: true, max: 500, label: "변경 사유(reason)" })!;
  },
};

// ───────────────────────────────────────── operator / RBAC ──
/**
 * Resolve the acting operator from the `x-operator` header (operator id, name or email;
 * may be URI-encoded because browsers cannot send raw Korean header values).
 * Defaults to 김서연 (op-kim-sy, Admin).
 */
export function resolveOperator(req: NextRequest): Operator {
  const e = getRuntime().engine;
  const raw = req.headers.get("x-operator");
  if (!raw) return e._internal.OP[DEFAULT_OPERATOR_ID];
  let v = raw.trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep raw */
  }
  const op = e.operators.find((o) => o.id === v || o.name === v || o.email === v);
  if (!op) throw badRequest(`알 수 없는 운영자입니다: ${v}`, { header: "x-operator" });
  return op;
}

export function requirePermission(op: Operator, key: string): void {
  const p = ROLE_PERMISSIONS.find((r) => r.key === key);
  if (!p) return;
  if (!p[op.role]) throw forbidden(`'${p.permission}' 권한이 없습니다 (${op.name} · ${op.role}).`);
}

/** Alert ack/resolve and other operational actions without a catalog permission key: Operator or Admin. */
export function requireOperatorRole(op: Operator, what: string): void {
  if (op.role === "Viewer") throw forbidden(`'${what}' 권한이 없습니다 (${op.name} · ${op.role}). Operator 이상 필요합니다.`);
}

export function permissionsOf(op: Operator): Record<string, boolean> {
  return Object.fromEntries(ROLE_PERMISSIONS.map((p) => [p.key, !!p[op.role]]));
}

// ───────────────────────────────────────── idempotency ──
const IDEM_TTL = 10 * 60_000;
/**
 * Optional `Idempotency-Key` header on POST/PATCH: the first response for a key is cached for
 * 10 minutes and replayed verbatim (with `idempotent-replay: true`) for retries.
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
  const res = await fn();
  try {
    const body = await res.clone().json();
    rt.idempotency.set(cacheKey, { at: now, status: res.status, body });
  } catch {
    /* non-JSON: not cached */
  }
  return res;
}
