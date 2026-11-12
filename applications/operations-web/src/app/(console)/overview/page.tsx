import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewScreen } from "@/components/atlas/overview";

export const metadata: Metadata = { title: "개요" };

export default function Page() {
  return (
    <Suspense>
      <OverviewScreen />
    </Suspense>
  );
}
