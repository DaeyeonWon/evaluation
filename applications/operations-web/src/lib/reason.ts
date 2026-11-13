/**
 * Locale-neutral reason codes stored in data (audit entries, Workflow.cancel_reason) instead of
 * display text, so stored records don't depend on who wrote them. Render with reasonText().
 *
 *   const te = useT("errors");
 *   reasonText(wf.cancel_reason, te)   // "운영자 요청에 의한 취소" / "Cancelled at operator request"
 */
export const DEFAULT_CANCEL_REASON = "code:OPERATOR_REQUEST";

const REASON_KEYS: Record<string, "domain.defaultCancelReason"> = {
  [DEFAULT_CANCEL_REASON]: "domain.defaultCancelReason",
};

/** Stored reason → display text: known codes are translated with an `errors` translator, free text passes through. */
export function reasonText<R extends string | null | undefined>(reason: R, t: (key: "domain.defaultCancelReason") => string): R | string {
  if (typeof reason === "string" && REASON_KEYS[reason]) return t(REASON_KEYS[reason]);
  return reason;
}
