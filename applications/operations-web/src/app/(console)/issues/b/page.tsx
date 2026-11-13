import type { Metadata } from "next";
import { Suspense } from "react";
import { IssuesCandidateB } from "@/components/atlas/issues-b";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("issuesB");
  return { title: t("meta.title") };
}

/** Issue Report — design candidate B "Market Brief". Owned by the candidate-B designer. */
export default function Page() {
  return (
    <Suspense>
      <IssuesCandidateB />
    </Suspense>
  );
}
