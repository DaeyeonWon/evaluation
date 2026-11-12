import type { Metadata } from "next";
import { Suspense } from "react";
import { DlqScreen } from "@/components/atlas/dlq";

export const metadata: Metadata = { title: "DLQ" };

export default function Page() {
  return (
    <Suspense>
      <DlqScreen />
    </Suspense>
  );
}
