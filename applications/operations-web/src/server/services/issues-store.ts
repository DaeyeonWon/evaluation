/**
 * Issue Report — triage lifecycle store (in-memory, audited). Server-only.
 *
 * State lives on globalThis (NOT on the Runtime, which is rebuilt when the virtual day rolls over), keyed
 * by the stable issue id, so it survives day re-seeds and is shared by every route bundle in dev.
 * A real deployment persists this as the `issue_triage` table (docs/integration-spec.md §Issue Report).
 *
 * Lifecycle:  NEW → TRIAGED → TICKETED → RESOLVED
 *             NEW | TRIAGED | TICKETED → IGNORED
 *             TRIAGED → NEW (un-triage) · TICKETED → TRIAGED · RESOLVED | IGNORED → NEW (reopen)
 * TICKETED needs a ticket_id (already set or in the same PATCH).
 */
import type { IssueHistoryEntry, IssuePatch, IssuePatchResult, IssueState, IssueStatus, IssueStreamMessage, Operator } from "@/lib/types";
import { badRequest, conflict } from "../http";
import { getEngine, publish } from "../mock/runtime";
import { recordAudit } from "./audit";
import { hash36 } from "./issues-text";

export const ISSUE_STATUSES: IssueStatus[] = ["NEW", "TRIAGED", "TICKETED", "RESOLVED", "IGNORED"];
export const OPEN_STATUSES: IssueStatus[] = ["NEW", "TRIAGED", "TICKETED"];

export const TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  NEW: ["TRIAGED", "IGNORED"],
  TRIAGED: ["TICKETED", "RESOLVED", "IGNORED", "NEW"],
  TICKETED: ["RESOLVED", "IGNORED", "TRIAGED"],
  RESOLVED: ["NEW"],
  IGNORED: ["NEW"],
};

interface Store {
  states: Map<string, IssueState>;
  seeded: boolean;
  /** P0/P1 ids already announced on the `issue` SSE channel (null = not primed yet) */
  announced: Set<string> | null;
}
const G = globalThis as unknown as { __aipoIssueStore?: Store };
function store(): Store {
  return (G.__aipoIssueStore ??= { states: new Map(), seeded: false, announced: null });
}

/** Stable id for a group key (see issues-engine.ts groupKey). */
export function issueIdOf(groupKey: string): string {
  return "iss-" + hash36(groupKey);
}

const EMPTY = (): IssueState => ({ status: "NEW", owner: null, owner_name: null, note: null, ticket_id: null, updated_at: null, updated_by: null, history: [] });

function opName(id: string | null): string | null {
  if (!id) return null;
  return getEngine().operators.find((o) => o.id === id)?.name ?? id;
}

/** A few pre-triaged issues so the lifecycle has realistic content on first load. */
function seed(s: Store) {
  if (s.seeded) return;
  s.seeded = true;
  const now = getEngine().now();
  const H = 3_600_000;
  const put = (key: string, steps: { dt: number; by: string; field: IssueHistoryEntry["field"]; to: string | null; from?: string | null; reason?: string }[], final: Partial<IssueState>) => {
    const st = EMPTY();
    for (const x of steps) st.history.push({ at: now - x.dt * H, by: x.by, by_name: opName(x.by) ?? x.by, field: x.field, from: x.from ?? null, to: x.to, reason: x.reason ?? null });
    Object.assign(st, final);
    const last = steps[steps.length - 1];
    st.updated_at = now - last.dt * H;
    st.updated_by = last.by;
    st.owner_name = opName(st.owner);
    s.states.set(issueIdOf(key), st);
  };
  put(
    "signature|alarm_timer|alarm.create|alarm.create|SLOT_ERROR",
    [
      { dt: 20, by: "op-park-jh", field: "status", from: "NEW", to: "TRIAGED", reason: "Galaxy Watch 한정 재현" },
      { dt: 20, by: "op-park-jh", field: "owner", to: "op-park-jh" },
      { dt: 19, by: "op-park-jh", field: "note", to: "One UI 8 Watch 배포 이후 알람 시각이 9시간 어긋남 — Wear OS 팀에 timezone 처리 확인 요청" },
    ],
    { status: "TRIAGED", owner: "op-park-jh", note: "One UI 8 Watch 배포 이후 알람 시각이 9시간 어긋남 — Wear OS 팀에 timezone 처리 확인 요청" },
  );
  put(
    "signature|general_qa|qa.health|qa.health|POLICY_VIOLATION",
    [
      { dt: 70, by: "op-jung-yn", field: "status", from: "NEW", to: "TRIAGED" },
      { dt: 69, by: "op-jung-yn", field: "owner", to: "op-jung-yn" },
      { dt: 46, by: "op-jung-yn", field: "ticket_id", to: "BIXBY-4821" },
      { dt: 46, by: "op-jung-yn", field: "status", from: "TRIAGED", to: "TICKETED", reason: "의료 조언 가드레일 보강 요청" },
    ],
    { status: "TICKETED", owner: "op-jung-yn", ticket_id: "BIXBY-4821", note: "의료 조언 가드레일(policy-guard) 프롬프트 보강 요청" },
  );
  put(
    "signature|general_qa|qa.chitchat|qa.chitchat|RESPONSE_QUALITY",
    [{ dt: 120, by: "op-lee-he", field: "status", from: "NEW", to: "IGNORED", reason: "Chitchat은 응답 품질 기준 완화 대상 (Judge 기준 개정 예정)" }],
    { status: "IGNORED", note: "Chitchat은 응답 품질 기준 완화 대상 (Judge 기준 개정 예정)" },
  );
  put(
    "signature|media_play|music.play_artist|music.play_artist|SLOT_ERROR",
    [
      { dt: 200, by: "op-han-dy", field: "status", from: "NEW", to: "TRIAGED" },
      { dt: 199, by: "op-han-dy", field: "ticket_id", to: "BIXBY-4710" },
      { dt: 199, by: "op-han-dy", field: "status", from: "TRIAGED", to: "TICKETED" },
      { dt: 30, by: "op-han-dy", field: "status", from: "TICKETED", to: "RESOLVED", reason: "아티스트명 사전 갱신 배포 완료" },
    ],
    { status: "RESOLVED", owner: "op-han-dy", ticket_id: "BIXBY-4710", note: "아티스트명 사전 갱신 배포 완료" },
  );
}

export function issueState(id: string): IssueState {
  const s = store();
  seed(s);
  return s.states.get(id) ?? EMPTY();
}

export function allIssueStates(): Map<string, IssueState> {
  const s = store();
  seed(s);
  return s.states;
}

/**
 * Announce P0/P1 issues not seen before on the `issue` SSE channel. The first call only primes the set
 * (so a fresh server doesn't flood clients). Called after each default-scope analysis.
 */
export function announceCritical(items: { id: string; severity: string; score: number; title: IssueStreamMessage["title"]; status: IssueStatus }[]) {
  const s = store();
  const crit = items.filter((i) => i.severity === "P0" || i.severity === "P1");
  if (!s.announced) {
    s.announced = new Set(crit.map((i) => i.id));
    return;
  }
  const at = getEngine().now();
  for (const i of crit) {
    if (s.announced.has(i.id)) continue;
    s.announced.add(i.id);
    publish("issue", { kind: "new_critical", issue_id: i.id, status: i.status, severity: i.severity as "P0" | "P1", score: i.score, title: i.title, by: null, at });
  }
}

const TICKET_RE = /^[A-Za-z][A-Za-z0-9_]*-\d{1,7}$/;

/** Apply a PATCH (caller already checked issues:write). Audits ISSUE_UPDATE and publishes `issue`. */
export function patchIssueState(
  id: string,
  body: IssuePatch,
  op: Operator,
  req: { headers: Headers },
  meta: { severity?: string; score?: number; title?: IssueStreamMessage["title"] } = {},
): IssuePatchResult {
  const s = store();
  seed(s);
  const cur = s.states.get(id) ?? EMPTY();
  const next: IssueState = { ...cur, history: [...cur.history] };
  const at = getEngine().now();
  const changed: string[] = [];
  const reason = body.reason?.trim() || null;
  const push = (field: IssueHistoryEntry["field"], from: string | null, to: string | null) =>
    next.history.push({ at, by: op.id, by_name: op.name, field, from, to, reason });

  if (body.owner !== undefined && body.owner !== cur.owner) {
    if (body.owner !== null && !getEngine().operators.some((o) => o.id === body.owner)) throw badRequest({ key: "domain.unknownOperator", vars: { id: String(body.owner) } }, { field: "owner" });
    next.owner = body.owner;
    next.owner_name = opName(body.owner);
    push("owner", cur.owner, body.owner);
    changed.push("owner");
  }
  if (body.ticket_id !== undefined && body.ticket_id !== cur.ticket_id) {
    if (body.ticket_id !== null && !TICKET_RE.test(body.ticket_id)) throw badRequest({ key: "domain.issueTicketInvalid", vars: { value: body.ticket_id } }, { field: "ticket_id" });
    next.ticket_id = body.ticket_id;
    push("ticket_id", cur.ticket_id, body.ticket_id);
    changed.push("ticket_id");
  }
  if (body.note !== undefined && (body.note ?? null) !== cur.note) {
    next.note = body.note ?? null;
    push("note", cur.note, next.note);
    changed.push("note");
  }
  if (body.status !== undefined && body.status !== cur.status) {
    if (!TRANSITIONS[cur.status].includes(body.status))
      throw conflict({ key: "domain.issueTransition", vars: { from: cur.status, to: body.status, allowed: TRANSITIONS[cur.status].join(", ") } }, { from: cur.status, allowed: TRANSITIONS[cur.status] });
    if (body.status === "TICKETED" && !next.ticket_id) throw badRequest({ key: "domain.issueTicketRequired" }, { field: "ticket_id" });
    next.status = body.status;
    push("status", cur.status, body.status);
    changed.push("status");
  }
  if (!changed.length) throw badRequest({ key: "validation.nothingToChangeFields", vars: { fields: "status, owner, note, ticket_id" } });
  next.updated_at = at;
  next.updated_by = op.id;
  s.states.set(id, next);

  recordAudit({
    action: "ISSUE_UPDATE",
    actor: op.id,
    actorName: op.name,
    role: op.role,
    target: id,
    before: { status: cur.status, owner: cur.owner, ticket_id: cur.ticket_id, note: cur.note },
    after: { status: next.status, owner: next.owner, ticket_id: next.ticket_id, note: next.note, changed },
    reason,
    req,
  });
  publish("issue", {
    kind: changed.includes("status") ? "status" : "update",
    issue_id: id,
    status: next.status,
    prev_status: cur.status,
    ...(meta.severity ? { severity: meta.severity as "P0" } : {}),
    ...(meta.score != null ? { score: meta.score } : {}),
    ...(meta.title ? { title: meta.title } : {}),
    by: op.id,
    at,
  });
  return { issue_id: id, state: next, changed };
}
