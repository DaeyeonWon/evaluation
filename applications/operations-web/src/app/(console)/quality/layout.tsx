import { Suspense, type ReactNode } from "react";
import { QualityFrame } from "@/components/atlas/quality/frame";

/**
 * Q-01 · Quality dashboard — shared frame (header, view tabs, row-dim FilterBar) for every /quality/** page.
 * A layout so the frame persists across view switches. Built only on result-row aggregation + reference tables
 * (GET /api/v1/quality/*); no analysis module.
 */
export default function QualityLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <QualityFrame>{children}</QualityFrame>
    </Suspense>
  );
}
