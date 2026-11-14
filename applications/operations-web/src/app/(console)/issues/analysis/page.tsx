import type { Metadata } from "next";
import { IssuesAnalysis } from "@/components/atlas/issues/analysis";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, v] = await Promise.all([getT("nav"), getT("issuesAnalysis")]);
  return { title: `${v("view.tab")} · ${nav("issues.title")}` };
}

/** I-01 · Issue Report — Analysis view. The frame comes from ../layout.tsx. */
export default function Page() {
  return <IssuesAnalysis />;
}
