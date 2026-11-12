/** analytics — English. Must have exactly the keys of ../ko/analytics.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/analytics";

const analytics = {} satisfies Messages<typeof ko>;

export default analytics;
