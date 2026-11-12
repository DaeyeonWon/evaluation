import type { Metadata } from "next";
import { Suspense } from "react";
import { DlqScreen } from "@/components/lanes/dlq";

export const metadata: Metadata = { title: "DLQ Operations" };

export default function Page() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <DlqScreen />
    </Suspense>
  );
}
