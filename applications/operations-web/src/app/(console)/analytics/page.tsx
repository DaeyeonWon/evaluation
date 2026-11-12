import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsScreen } from "@/components/atlas/analytics";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("analytics.title") };
}

export default function Page() {
  return (
    <Suspense>
      <AnalyticsScreen />
    </Suspense>
  );
}
