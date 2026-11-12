import type { Metadata } from "next";
import { Suspense } from "react";
import { DlqScreen } from "@/components/atlas/dlq";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("dlq.title") };
}

export default function Page() {
  return (
    <Suspense>
      <DlqScreen />
    </Suspense>
  );
}
