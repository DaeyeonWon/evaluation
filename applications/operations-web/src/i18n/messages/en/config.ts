/** config — English. Must have exactly the keys of ../ko/config.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/config";

const config = {} satisfies Messages<typeof ko>;

export default config;
