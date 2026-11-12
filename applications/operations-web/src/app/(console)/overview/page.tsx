import type { Metadata } from "next";
import { Suspense } from "react";
import { getT } from "@/i18n/server";
import { OverviewScreen } from "@/components/atlas/overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("overview.title") };
}

export default function Page() {
  return (
    <Suspense>
      <OverviewScreen />
    </Suspense>
  );
}
