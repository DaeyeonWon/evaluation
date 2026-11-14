import type { Metadata } from "next";
import { IssuesCategories } from "@/components/atlas/issues/categories";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, v] = await Promise.all([getT("nav"), getT("issuesCategories")]);
  return { title: `${v("view.tab")} · ${nav("issues.title")}` };
}

/** I-01 · Issue Report — Categories view. The frame comes from ../layout.tsx. */
export default function Page() {
  return <IssuesCategories />;
}
