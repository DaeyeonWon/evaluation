import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsScreen } from "@/components/atlas/results";

export const metadata: Metadata = { title: "평가 결과" };

export default function Page() {
  return (
    <Suspense>
      <ResultsScreen />
    </Suspense>
  );
}
