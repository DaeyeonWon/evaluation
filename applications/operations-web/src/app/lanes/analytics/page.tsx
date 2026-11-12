import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsScreen } from "@/components/lanes/analytics";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <AnalyticsScreen />
    </Suspense>
  );
}
