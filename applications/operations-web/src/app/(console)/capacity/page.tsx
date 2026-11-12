import type { Metadata } from "next";
import { Suspense } from "react";
import { getT } from "@/i18n/server";
import { CapacityScreen } from "@/components/atlas/capacity";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("capacity.title") };
}

export default function Page() {
  return (
    <Suspense>
      <CapacityScreen />
    </Suspense>
  );
}
