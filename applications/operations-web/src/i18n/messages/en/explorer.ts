/** explorer — English. Must have exactly the keys of ../ko/explorer.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/explorer";

const explorer = {} satisfies Messages<typeof ko>;

export default explorer;
