import type { Metadata } from "next";
import { IssuesModules } from "@/components/atlas/issues/modules";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, m] = await Promise.all([getT("nav"), getT("modules")]);
  return { title: `${m("page.metaTitle")} · ${nav("issues.title")}` };
}

/** Deep Analysis — analysis-module registry, buckets A/B/C and the feature × module matrix. The frame comes from ../layout.tsx. */
export default function Page() {
  return <IssuesModules />;
}
