import type { Metadata } from "next";
import { Suspense } from "react";
import { IssuesCandidateA } from "@/components/atlas/issues-a";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("issuesA.title") };
}

/** Issue Report — design candidate A. Owned by the candidate-A designer. */
export default function Page() {
  return (
    <Suspense>
      <IssuesCandidateA />
    </Suspense>
  );
}
