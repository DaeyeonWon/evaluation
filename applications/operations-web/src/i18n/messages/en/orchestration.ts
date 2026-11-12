/** orchestration — English. Must have exactly the keys of ../ko/orchestration.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/orchestration";

const orchestration = {} satisfies Messages<typeof ko>;

export default orchestration;
