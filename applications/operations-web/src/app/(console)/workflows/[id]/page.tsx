import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailScreen } from "@/components/atlas/detail";

export const metadata: Metadata = { title: "Pipeline 상세" };

export default function Page() {
  return (
    <Suspense>
      <DetailScreen />
    </Suspense>
  );
}
