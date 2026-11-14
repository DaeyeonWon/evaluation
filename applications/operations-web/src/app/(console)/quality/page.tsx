import type { Metadata } from "next";
import { QualityOverview } from "@/components/atlas/quality/overview";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, q] = await Promise.all([getT("nav"), getT("quality")]);
  return { title: `${q("view.overview.tab")} · ${nav("quality.title")}` };
}

/** Q-01 · Quality dashboard — overview view. The frame comes from the /quality layout. */
export default function Page() {
  return <QualityOverview />;
}
