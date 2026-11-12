import type { Metadata } from "next";
import { Suspense } from "react";
import { PipelineStatus } from "@/components/atlas/pipelines/status";
import { getT } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/pipelines/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = await getT("pipelines");
  return { title: t("meta.status", { id: decodeURIComponent(id) }) };
}

export default function Page() {
  return (
    <Suspense>
      <PipelineStatus />
    </Suspense>
  );
}
