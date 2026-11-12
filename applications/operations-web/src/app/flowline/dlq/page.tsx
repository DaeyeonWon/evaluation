import type { Metadata } from "next";
import { Suspense } from "react";
import { DlqOps } from "@/components/flowline/dlq";

export const metadata: Metadata = { title: "DLQ Operations" };

export default function FlowlineDlqPage() {
  return (
    <Suspense>
      <DlqOps />
    </Suspense>
  );
}
