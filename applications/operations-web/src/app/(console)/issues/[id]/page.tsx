import type { Metadata } from "next";
import { IssueDetailPage } from "@/components/atlas/issues/detail";
import { getT } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/issues/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [nav, d] = await Promise.all([getT("nav"), getT("issuesDetail")]);
  return { title: `${d("metaTitle", { id: decodeURIComponent(id) })} · ${nav("issues.title")}` };
}

/** I-01 · Issue Report — single-issue deep analysis. The frame (back link instead of the switcher) comes from ../layout.tsx. */
export default async function Page({ params }: PageProps<"/issues/[id]">) {
  const { id } = await params;
  return <IssueDetailPage id={decodeURIComponent(id)} />;
}
