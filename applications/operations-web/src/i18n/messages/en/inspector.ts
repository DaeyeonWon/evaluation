/** inspector — English. Must have exactly the keys of ../ko/inspector.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/inspector";

const inspector = {} satisfies Messages<typeof ko>;

export default inspector;
