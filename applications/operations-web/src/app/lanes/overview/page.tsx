import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewScreen } from "@/components/lanes/overview";

export const metadata: Metadata = { title: "Global Overview" };

export default function Page() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <OverviewScreen />
    </Suspense>
  );
}
