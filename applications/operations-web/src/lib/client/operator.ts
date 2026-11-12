"use client";
/**
 * Current operator (the "who am I" dropdown). Persisted in localStorage, sent as `x-operator`
 * (URI-encoded id) on every mutating request by the api client. Default: op-kim-sy (김서연, Admin).
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_OPERATOR_ID, OPERATORS } from "@/lib/catalog";
import type { Operator } from "@/lib/types";

const KEY = "aipo.operator";
const listeners = new Set<() => void>();
let current: string | null = null;

function read(): string {
  if (current) return current;
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    current = v && OPERATORS.some((o) => o.id === v) ? v : DEFAULT_OPERATOR_ID;
  } catch {
    current = DEFAULT_OPERATOR_ID;
  }
  return current;
}

export function getOperatorId(): string {
  return typeof window === "undefined" ? DEFAULT_OPERATOR_ID : read();
}

export function setOperatorId(id: string): void {
  if (!OPERATORS.some((o) => o.id === id)) throw new Error("unknown operator " + id);
  current = id;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** [operator, setOperatorId] — SSR renders the default operator, then hydrates to the stored one. */
export function useOperator(): [Operator, (id: string) => void] {
  const id = useSyncExternalStore(subscribe, getOperatorId, () => DEFAULT_OPERATOR_ID);
  return [OPERATORS.find((o) => o.id === id) ?? OPERATORS[0], setOperatorId];
}
