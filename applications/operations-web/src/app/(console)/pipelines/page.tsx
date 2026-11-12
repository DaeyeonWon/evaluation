import type { Metadata } from "next";
import { Suspense } from "react";
import { PipelinesCatalog } from "@/components/atlas/pipelines/catalog";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("pipelines.title") };
}

export default function Page() {
  return (
    <Suspense>
      <PipelinesCatalog />
    </Suspense>
  );
}
