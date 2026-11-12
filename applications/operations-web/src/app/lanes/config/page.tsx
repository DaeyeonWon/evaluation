import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfigScreen } from "@/components/lanes/config";

export const metadata: Metadata = { title: "System Configuration" };

export default function Page() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <ConfigScreen />
    </Suspense>
  );
}
