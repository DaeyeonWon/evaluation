import type { Metadata } from "next";
import { IssuesReport } from "@/components/atlas/issues/report";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, v] = await Promise.all([getT("nav"), getT("issuesReport")]);
  return { title: `${v("view.tab")} · ${nav("issues.title")}` };
}

/** I-01 · Issue Report — Report view. The frame comes from ../layout.tsx. */
export default function Page() {
  return <IssuesReport />;
}
