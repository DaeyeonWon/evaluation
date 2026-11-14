/**
 * Issue Report — the ONE colour vocabulary every view uses for impact levels, the two type taxonomies
 * and the score factors. Tokens live in src/styles/atlas-issues.css (light + dark):
 *
 *   --sev-p0 … --sev-p3     영향도 / Impact levels (reserved: always with icon + "P0 Critical" label)
 *   --ut-<user_impact>      사용자 영향 types  (7 validated categorical slots --ty-1…7)
 *   --dm-<dev_miss>         Bixby 미처리 types (same 7 slots + neutral steps for asr / performance, ink for out_of_scope)
 *   --fa-<factor>           score factors volume → novelty (a separate validated 6-slot set, so a factor hue is
 *                           never mistaken for a type hue)
 *
 *   import { typeVar, TypeDot, USER_IMPACT_ORDER, factorVar } from "../../issues-shared";
 *   <i style={{ background: typeVar("dev_miss", "regression") }} />
 *   <TypeDot dim="user_impact" value="safety_privacy" />        // swatch + icon, label next to it is yours
 */
import {
  AudioLines,
  Ban,
  Braces,
  CircleSlash,
  CircleX,
  GitCompareArrows,
  Hourglass,
  Languages,
  MessageCircleQuestion,
  MessageSquareWarning,
  PenLine,
  Route,
  ShieldAlert,
  ShieldOff,
  Shuffle,
  Sparkles,
  Timer,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { DevMissType, IssueFactorKey, IssueSeverity, UserImpactType } from "@/lib/types";

export const IMPACT_LEVELS: IssueSeverity[] = ["P0", "P1", "P2", "P3"];
export const sevVar = (s: IssueSeverity) => `var(--sev-${s.toLowerCase()})`;

export const USER_IMPACT_ORDER: UserImpactType[] = ["safety_privacy", "wrong_action", "task_blocked", "misunderstood", "inappropriate_content", "degraded", "minor"];
/** must-handle misses first (by how directly they are a Bixby defect), out_of_scope last */
export const DEV_MISS_ORDER: DevMissType[] = [
  "guardrail_miss",
  "regression",
  "new_feature_gap",
  "locale_gap",
  "supported_intent_failed",
  "routing",
  "slot_extraction",
  "asr_robustness",
  "performance",
  "out_of_scope",
];
export type TypeDim = "user_impact" | "dev_miss";
export const isTypeDim = (d: string | null | undefined): d is TypeDim => d === "user_impact" || d === "dev_miss";
export const typeOrder = (d: TypeDim): string[] => (d === "user_impact" ? USER_IMPACT_ORDER : DEV_MISS_ORDER);
/** CSS custom property of a type value, e.g. `--ut-safety_privacy` */
export const typeToken = (d: TypeDim, v: string) => `--${d === "user_impact" ? "ut" : "dm"}-${v}`;
/** CSS colour of a type value */
export const typeVar = (d: TypeDim, v: string) => `var(${typeToken(d, v)}, var(--ink-3))`;

export const TYPE_ICON: Record<UserImpactType | DevMissType, ReactNode> = {
  safety_privacy: <ShieldAlert aria-hidden />,
  wrong_action: <Shuffle aria-hidden />,
  task_blocked: <Ban aria-hidden />,
  misunderstood: <MessageCircleQuestion aria-hidden />,
  inappropriate_content: <MessageSquareWarning aria-hidden />,
  degraded: <Hourglass aria-hidden />,
  minor: <PenLine aria-hidden />,
  guardrail_miss: <ShieldOff aria-hidden />,
  regression: <GitCompareArrows aria-hidden />,
  new_feature_gap: <Sparkles aria-hidden />,
  locale_gap: <Languages aria-hidden />,
  supported_intent_failed: <CircleX aria-hidden />,
  routing: <Route aria-hidden />,
  slot_extraction: <Braces aria-hidden />,
  asr_robustness: <AudioLines aria-hidden />,
  performance: <Timer aria-hidden />,
  out_of_scope: <CircleSlash aria-hidden />,
};

export const FACTOR_ORDER: IssueFactorKey[] = ["volume", "severity", "trend", "regression", "reach", "novelty"];
export const factorVar = (k: IssueFactorKey) => `var(--fa-${k})`;

/** Type swatch + icon (`.iss-tyd` in atlas-issues.css). Put the visible label next to it. */
export function TypeDot({ dim, value, className }: { dim: TypeDim; value: string; className?: string }) {
  return (
    <span className={className ? `iss-tyd ${className}` : "iss-tyd"} data-dim={dim} data-v={value} style={{ ["--tyc" as string]: typeVar(dim, value) } as CSSProperties} aria-hidden>
      {TYPE_ICON[value as UserImpactType] ?? null}
    </span>
  );
}
