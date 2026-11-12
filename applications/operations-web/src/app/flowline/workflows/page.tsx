import { redirect } from "next/navigation";

/** /flowline/workflows without an id → the explorer (pick a workflow there). */
export default function FlowlineWorkflowsIndex() {
  redirect("/flowline/explorer");
}
