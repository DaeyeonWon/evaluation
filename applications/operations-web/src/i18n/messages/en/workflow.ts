/** workflow — English. Must have exactly the keys of ../ko/workflow.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/workflow";

const workflow = {} satisfies Messages<typeof ko>;

export default workflow;
