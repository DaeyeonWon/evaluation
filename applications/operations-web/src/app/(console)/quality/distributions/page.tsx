import type { Metadata } from "next";
import { QualityDistributionsView } from "@/components/atlas/quality/distributions";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, q] = await Promise.all([getT("nav"), getT("quality")]);
  return { title: `${q("view.distributions.tab")} · ${nav("quality.title")}` };
}

/** Q-01 · Quality dashboard — distributions view. The frame comes from the /quality layout. */
export default function Page() {
  return <QualityDistributionsView />;
}
