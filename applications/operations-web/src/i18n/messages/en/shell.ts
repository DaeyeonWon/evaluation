/** shell — English. Must have exactly the keys of ../ko/shell.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/shell";

const shell = {} satisfies Messages<typeof ko>;

export default shell;
