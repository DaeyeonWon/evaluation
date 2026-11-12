import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkflowDetailScreen } from "@/components/lanes/workflow-detail";

export const metadata: Metadata = { title: "Pipeline Detail" };

export default function LanesWorkflowPage() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <WorkflowDetailScreen />
    </Suspense>
  );
}
