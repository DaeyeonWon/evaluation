import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsScreen } from "@/components/atlas/results";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("results.title") };
}

export default function Page() {
  return (
    <Suspense>
      <ResultsScreen />
    </Suspense>
  );
}
