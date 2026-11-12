import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailScreen } from "@/components/atlas/detail";
import { getT } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/workflows/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = await getT("nav");
  return { title: t("workflow.title", { id: decodeURIComponent(id) }) };
}

export default function Page() {
  return (
    <Suspense>
      <DetailScreen />
    </Suspense>
  );
}
