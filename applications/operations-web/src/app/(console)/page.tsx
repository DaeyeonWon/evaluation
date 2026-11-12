import type { Metadata } from "next";
import { Suspense } from "react";
import { CanvasScreen } from "@/components/atlas/canvas/canvas";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("orchestration.title") };
}

export default function Page() {
  return (
    <Suspense>
      <CanvasScreen />
    </Suspense>
  );
}
