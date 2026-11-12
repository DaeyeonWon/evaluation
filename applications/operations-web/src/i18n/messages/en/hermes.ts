/** hermes — English. Must have exactly the keys of ../ko/hermes.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/hermes";

const hermes = {
  status: "NOT CONFIGURED",
  title: "The Hermes dashboard isn't connected yet",
  lead: "Hermes runs at its own URL. Once the address is set, this page checks your permission and sends you straight to Hermes.",
  step1: "Set the server environment variable:",
  step2: "Restart the server (the URL is read at startup).",
  step3: "Permission required for access:",
  access: "Your account {name} ({roles}) can open Hermes.",
  back: "Back to the console",
} satisfies Messages<typeof ko>;

export default hermes;
