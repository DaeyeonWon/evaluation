import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { IssueDetailPage } from "@/components/atlas/issues/detail";
import { getT } from "@/i18n/server";
import { formatIssueText } from "@/lib/issue-text";
import { issueDetail } from "@/server/services/issues";

/** Localized issue title for the tab (same range + filters as the page); null when the issue is not in that range. */
async function issueTitle(id: string, search: Record<string, string | string[] | undefined>): Promise<string | null> {
  try {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) if (typeof v === "string") sp.set(k, v);
    sp.set("pageSize", "1");
    const d = issueDetail(new NextRequest(new URL(`http://local/api/v1/issues/${encodeURIComponent(id)}?${sp}`)), id);
    return formatIssueText(await getT("issues"), d.title);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: PageProps<"/issues/[id]">): Promise<Metadata> {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const [nav, d, title] = await Promise.all([getT("nav"), getT("issuesDetail"), searchParams.then((s) => issueTitle(id, s))]);
  return { title: `${title ? d("metaTitle", { title }) : d("metaFallback", { id })} · ${nav("issues.title")}` };
}

/** I-01 · Issue Report — single-issue deep analysis. The frame (back link instead of the switcher) comes from ../layout.tsx. */
export default async function Page({ params }: PageProps<"/issues/[id]">) {
  const { id } = await params;
  return <IssueDetailPage id={decodeURIComponent(id)} />;
}
