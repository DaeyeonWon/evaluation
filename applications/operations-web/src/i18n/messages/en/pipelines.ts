/** pipelines — English. Must have exactly the keys of ../ko/pipelines.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/pipelines";

const pipelines = {} satisfies Messages<typeof ko>;

export default pipelines;
