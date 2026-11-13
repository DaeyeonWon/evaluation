import type { Metadata } from "next";
import { Suspense } from "react";
import { IssuesIndex } from "@/components/atlas/issues-index";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("issues.title") };
}

/** I-01 · Issue Report — design candidate chooser (A/B/C). */
export default function Page() {
  return (
    <Suspense>
      <IssuesIndex />
    </Suspense>
  );
}
