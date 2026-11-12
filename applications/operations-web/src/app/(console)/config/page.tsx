import type { Metadata } from "next";
import { Suspense } from "react";
import { getT } from "@/i18n/server";
import { ConfigScreen } from "@/components/atlas/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("config.title") };
}

export default function Page() {
  return (
    <Suspense>
      <ConfigScreen />
    </Suspense>
  );
}
