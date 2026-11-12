/** results — English. Must have exactly the keys of ../ko/results.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/results";

const results = {} satisfies Messages<typeof ko>;

export default results;
