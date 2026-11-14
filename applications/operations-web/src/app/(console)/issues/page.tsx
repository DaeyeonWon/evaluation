import type { Metadata } from "next";
import { IssuesTriage } from "@/components/atlas/issues/triage";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, v] = await Promise.all([getT("nav"), getT("issuesTriage")]);
  return { title: `${v("view.tab")} · ${nav("issues.title")}` };
}

/** I-01 · Issue Report — Triage view (default). The frame comes from ./layout.tsx. */
export default function Page() {
  return <IssuesTriage />;
}
