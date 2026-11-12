/** files — English. Must have exactly the keys of ../ko/files.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/files";

const files = {} satisfies Messages<typeof ko>;

export default files;
