import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkflowDetail } from "@/components/flowline/detail/detail";

export async function generateMetadata({ params }: PageProps<"/flowline/workflows/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `${decodeURIComponent(id)} · Pipeline Detail` };
}

export default function FlowlineWorkflowPage() {
  return (
    <Suspense>
      <WorkflowDetail />
    </Suspense>
  );
}
