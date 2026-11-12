import type { Metadata } from "next";
import { Suspense } from "react";
import { FilesScreen } from "@/components/atlas/files/files-screen";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("files.title") };
}

export default function Page() {
  return (
    <Suspense>
      <FilesScreen />
    </Suspense>
  );
}
