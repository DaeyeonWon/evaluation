import { Suspense } from "react";
import { IssuesFrame } from "@/components/atlas/issues/frame";

/**
 * I-01 · Issue Report — shared frame (header, view switcher, unified FilterBar) for every /issues/** page.
 * A layout so the frame persists across view switches (no remount flicker); the frame reads the pathname
 * to hide the switcher on /issues/[id].
 */
export default function IssuesLayout({ children }: LayoutProps<"/issues">) {
  return (
    <Suspense>
      <IssuesFrame>{children}</IssuesFrame>
    </Suspense>
  );
}
