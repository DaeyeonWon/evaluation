import type { Metadata } from "next";
import { Suspense } from "react";
import { IssuesCandidateC } from "@/components/atlas/issues-c";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("issuesC.title") };
}

/** Issue Report — design candidate C. Owned by the candidate-C designer. */
export default function Page() {
  return (
    <Suspense>
      <IssuesCandidateC />
    </Suspense>
  );
}
