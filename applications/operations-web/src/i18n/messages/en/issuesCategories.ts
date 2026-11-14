import type { Messages } from "../../core";
import type ko from "../ko/issuesCategories";

const issuesCategories = {
  view: { tab: "Breakdown", desc: "Break issues down by category, agent function, division, region or Bixby version to compare where FAILs concentrate" },
  placeholder: "The breakdown view is being built. The filters and view switcher above already work.",
} satisfies Messages<typeof ko>;

export default issuesCategories;
