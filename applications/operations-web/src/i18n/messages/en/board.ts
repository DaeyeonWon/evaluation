/** board — English. Must have exactly the keys of ../ko/board.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/board";

const board = {} satisfies Messages<typeof ko>;

export default board;
