import type { Metadata } from "next";
import { Suspense } from "react";
import { ExplorerScreen } from "@/components/lanes/explorer";

export const metadata: Metadata = { title: "Pipeline Explorer" };

export default function LanesExplorerPage() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <ExplorerScreen />
    </Suspense>
  );
}
