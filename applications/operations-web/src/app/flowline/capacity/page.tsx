import type { Metadata } from "next";
import { CapacityScreen } from "@/components/flowline/capacity";

export const metadata: Metadata = { title: "Language Capacity" };

export default function FlowlineCapacityPage() {
  return <CapacityScreen />;
}
