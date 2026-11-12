import type { Metadata } from "next";
import { Suspense } from "react";
import { getT } from "@/i18n/server";
import { WorkflowsIndex } from "@/components/atlas/detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("workflows.title") };
}

export default function Page() {
  return (
    <Suspense>
      <WorkflowsIndex />
    </Suspense>
  );
}
