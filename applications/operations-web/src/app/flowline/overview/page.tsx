import { redirect } from "next/navigation";

/** The Flowline IA puts the global overview (S1) on the orchestration home. */
export default function FlowlineOverviewPage() {
  redirect("/flowline");
}
