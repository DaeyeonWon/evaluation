/** hermes — English. Must have exactly the keys of ../ko/hermes.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/hermes";

const hermes = {} satisfies Messages<typeof ko>;

export default hermes;
