import type { Metadata } from "next";
import { Suspense } from "react";
import { CapacityScreen } from "@/components/atlas/capacity";

export const metadata: Metadata = { title: "Capacity" };

export default function Page() {
  return (
    <Suspense>
      <CapacityScreen />
    </Suspense>
  );
}
