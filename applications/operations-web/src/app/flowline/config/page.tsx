import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfigScreen } from "@/components/flowline/config";

export const metadata: Metadata = { title: "System Configuration" };

export default function FlowlineConfigPage() {
  return (
    <Suspense>
      <ConfigScreen />
    </Suspense>
  );
}
