import type { Metadata } from "next";
import { Suspense } from "react";
import { ExplorerScreen } from "@/components/atlas/explorer";

export const metadata: Metadata = { title: "Pipeline Explorer" };

export default function Page() {
  return (
    <Suspense>
      <ExplorerScreen />
    </Suspense>
  );
}
