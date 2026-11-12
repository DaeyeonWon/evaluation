import type { Metadata } from "next";
import { Analytics } from "@/components/flowline/analytics";

export const metadata: Metadata = { title: "Analytics" };

export default function FlowlineAnalyticsPage() {
  return <Analytics />;
}
