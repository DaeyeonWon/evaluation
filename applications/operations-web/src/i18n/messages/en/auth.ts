/** auth — English. Must have exactly the keys of ../ko/auth.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/auth";

const auth = {} satisfies Messages<typeof ko>;

export default auth;
