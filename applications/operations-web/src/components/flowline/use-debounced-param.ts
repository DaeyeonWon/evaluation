"use client";
import { useEffect, useState } from "react";

/**
 * Local text state mirrored to a URL param with a debounce. External URL changes (back/forward,
 * reset) flow back into the input via the "derive from previous value" pattern (no effect setState).
 */
export function useDebouncedParam(value: string | null, write: (v: string | null) => void, ms = 300): [string, (v: string) => void] {
  const [local, setLocal] = useState(value ?? "");
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setLocal(value ?? "");
  }
  useEffect(() => {
    const v = local.trim();
    if (v === (value ?? "")) return;
    const t = setTimeout(() => write(v || null), ms);
    return () => clearTimeout(t);
  }, [local, value, write, ms]);
  return [local, setLocal];
}
