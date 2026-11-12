import type { Metadata } from "next";
import { Suspense } from "react";
import { Results } from "@/components/flowline/results";

export const metadata: Metadata = { title: "평가 결과" };

export default function FlowlineResultsPage() {
  return (
    <Suspense>
      <Results />
    </Suspense>
  );
}
