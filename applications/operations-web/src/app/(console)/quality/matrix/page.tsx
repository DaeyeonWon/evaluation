import type { Metadata } from "next";
import { QualityMatrixView } from "@/components/atlas/quality/matrix";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const [nav, q] = await Promise.all([getT("nav"), getT("quality")]);
  return { title: `${q("view.matrix.tab")} · ${nav("quality.title")}` };
}

/** Q-01 · Quality dashboard — matrix view. The frame comes from the /quality layout. */
export default function Page() {
  return <QualityMatrixView />;
}
