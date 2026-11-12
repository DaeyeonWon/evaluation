import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsScreen } from "@/components/atlas/analytics";

export const metadata: Metadata = { title: "분석" };

export default function Page() {
  return (
    <Suspense>
      <AnalyticsScreen />
    </Suspense>
  );
}
