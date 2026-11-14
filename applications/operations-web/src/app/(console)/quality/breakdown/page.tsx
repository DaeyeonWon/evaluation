import type { Metadata } from "next";
import { QualityBreakdownView } from "@/components/atlas/quality/breakdown";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, q] = await Promise.all([getT("nav"), getT("quality")]);
  return { title: `${q("view.breakdown.tab")} · ${nav("quality.title")}` };
}

/** Q-01 · Quality dashboard — breakdown view. The frame comes from the /quality layout. */
export default function Page() {
  return <QualityBreakdownView />;
}
