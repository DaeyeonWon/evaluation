import type { Metadata } from "next";
import { QualityVersionsView } from "@/components/atlas/quality/versions";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, q] = await Promise.all([getT("nav"), getT("quality")]);
  return { title: `${q("view.versions.tab")} · ${nav("quality.title")}` };
}

/** Q-01 · Quality dashboard — versions view. The frame comes from the /quality layout. */
export default function Page() {
  return <QualityVersionsView />;
}
