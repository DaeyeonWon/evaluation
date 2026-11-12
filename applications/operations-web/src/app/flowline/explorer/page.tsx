import type { Metadata } from "next";
import { Suspense } from "react";
import { Explorer } from "@/components/flowline/explorer";

export const metadata: Metadata = { title: "Pipeline Explorer" };

export default function FlowlineExplorerPage() {
  return (
    <Suspense>
      <Explorer />
    </Suspense>
  );
}
