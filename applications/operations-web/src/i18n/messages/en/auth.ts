/** auth — English. Must have exactly the keys of ../ko/auth.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/auth";

const auth = {
  login: {
    title: "Choose an operator account",
    lead: "This is a demo sign-in. The account you pick is kept in a server-signed HttpOnly cookie, and every permission check and audit entry uses it.",
    current: "Signed in as {name} ({roles}).",
    noRole: "no role",
    next: "After signing in you'll go to: {path}",
    hermesTitle: "Access to the Hermes dashboard",
    logout: "Sign out",
    logoutHint: "Deletes the session cookie.",
  },
  roles: {
    admin: "Everything, including runtime config, versions and simulator control",
    operator: "Capacity changes, DLQ Replay, Workflow cancel, Hermes access",
    viewer: "View dashboards and logs, export CSV",
  },
  proxy: {
    title: "No identity found",
    leadIap: "This console only runs behind Google Cloud IAP. Open it again through IAP.",
    leadOidc: "This console only runs behind your organization's OIDC auth proxy. Open it again through the proxy.",
  },
  forbidden: {
    metaTitle: "Access denied",
    title: "You don't have permission to open this page",
    lead: "If you need access, ask a console administrator to add a role. Include the account details below in your request.",
    account: "Account",
    roles: "Roles",
    perms: "Permissions",
    back: "Back to the console",
    switch: "Sign in as someone else",
  },
} satisfies Messages<typeof ko>;

export default auth;
