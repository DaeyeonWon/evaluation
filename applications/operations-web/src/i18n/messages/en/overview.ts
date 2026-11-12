/** overview — English. Must have exactly the keys of ../ko/overview.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/overview";

const overview = {} satisfies Messages<typeof ko>;

export default overview;
