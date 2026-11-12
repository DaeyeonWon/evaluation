import type { Metadata } from "next";
import { Suspense } from "react";
import { OrchestrationHome } from "@/components/flowline/orchestration/home";

export const metadata: Metadata = { title: "관제" };

export default function FlowlinePage() {
  return (
    <Suspense>
      <OrchestrationHome />
    </Suspense>
  );
}
