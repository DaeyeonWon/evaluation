import type { Metadata } from "next";
import { Suspense } from "react";
import { CapacityScreen } from "@/components/lanes/capacity";

export const metadata: Metadata = { title: "Language Capacity" };

export default function Page() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <CapacityScreen />
    </Suspense>
  );
}
