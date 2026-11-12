/** dlq — English. Must have exactly the keys of ../ko/dlq.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/dlq";

const dlq = {} satisfies Messages<typeof ko>;

export default dlq;
