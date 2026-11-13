# Authentication, RBAC and the Hermes link

The console resolves **who the user is on the server**, maps them to roles and permissions from
`console.config.ts`, and enforces those permissions on the server. The browser never chooses its own
identity. The old `x-operator` header is ignored and stripped by `src/proxy.ts`. This implements
plan.md §6.2 (IAP or org OIDC + application RBAC) and §8 (state-changing APIs need auth, RBAC and audit).

```
request ──▶ src/proxy.ts ─────────────────────────▶ page / route handler ───────────────▶ mock engine
            1. adapter.verify()  (IAP JWT)            hermes/page.tsx: getSession(), forbidden()
            2. adapter.identify() → 401 / →/login     src/server/http.ts: resolveOperator(req) → 401
            3. API permission table → 403             requirePermission(op, key) → 403
            4. page permission → /403                 audit actor = session user
            5. x-console-user-* headers → upstream
```

| Piece | File |
| --- | --- |
| Config (roles, rules, mode, links) | `console.config.ts`, schema in `src/config/schema.ts`, loader in `src/config/index.ts` |
| Identity adapters | `src/server/auth/adapters/{mock,iap,oidc-header}.ts` |
| Role → permission resolution | `src/server/auth/rbac.ts` |
| Request helpers (`sessionFromRequest`, `verifyRequest`, `sessionInfo`) | `src/server/auth/core.ts` |
| `getSession()` for server components | `src/server/auth/index.ts` |
| API permission table used by the proxy | `src/server/auth/policy.ts` |
| Proxy (Next 16's renamed middleware) | `src/proxy.ts` |
| Route-handler RBAC (`resolveOperator`, `requirePermission`, …) | `src/server/http.ts` |
| Client hook | `src/lib/client/session.tsx` (`SessionProvider`, `useSession`) |
| Pages | `src/app/login/page.tsx`, `src/app/forbidden.tsx`, `src/app/403/page.tsx`, `src/app/(console)/hermes/page.tsx` |

## Auth modes

Set the mode with `CONSOLE_AUTH_MODE` (default `mock`).

### `mock`: demo login

- `/login` lists the demo users from `auth.mock.users`, which are the mock engine's operators with their roles.
  It also shows whether each user can open Hermes. Clicking a user posts a plain HTML form to
  `POST /api/v1/auth/login` (no JS needed). The server then sets a signed `HttpOnly; SameSite=Lax` cookie
  (`aipo_session`, 12 h, `Secure` on HTTPS).
- Cookie format: `base64url(JSON {sub, iat, exp}).base64url(HMAC-SHA256)`, keyed by `CONSOLE_SESSION_SECRET`.
  When the secret is unset, a built-in dev secret is used and the server logs a warning. **Set the
  secret anywhere other than a laptop.** Without it, anyone can forge a session.
- The cookie stores only the user id. Roles are recomputed on every request from config and env, so role
  changes apply immediately.
- Demo users (from the engine):

  | User | Role | Hermes |
  | --- | --- | --- |
  | 김서연 `op-kim-sy`, 한도윤 `op-han-dy` | Admin | yes |
  | 박지훈 `op-park-jh`, 이하은 `op-lee-he`, 정유나 `op-jung-yn` | Operator | yes |
  | 최민준 `op-choi-mj`, Kenji Sato `op-sato-k` | Viewer | **no** |

### `iap`: Google Cloud Identity-Aware Proxy

- Identity: `x-goog-authenticated-user-email: accounts.google.com:user@example.com`. The prefix is stripped
  and the email is lower-cased. The user id is the email.
- Verification: when `IAP_AUDIENCE` is set, `src/proxy.ts` verifies `x-goog-iap-jwt-assertion` on every
  request before anything renders. It checks:
  - the ES256 signature against `https://www.gstatic.com/iap/verify/public_key-jwk` (cached 1 h)
  - `iss = https://cloud.google.com/iap` and `aud = IAP_AUDIENCE`
  - `exp` and `iat` (±30 s)
  - that the JWT `email` equals the header

  A missing or invalid JWT gets a 401.
- **Caveat:** without `IAP_AUDIENCE`, the header is trusted as-is, and the server logs a warning once. That is only
  safe if IAP is the only way to reach the service (see "Cloud Run + IAP" below). Anyone who can reach the
  container directly can send the header.
- The JWT check has been exercised only against forged and absent tokens: both are rejected with 401.
  Verify it once against real IAP after the first deployment (see the checklist).
- Logout returns `redirect: "/_gcp_iap/clear_login_cookie"`, which ends the IAP session.

### `oidc-header`: trusted header from an auth proxy

- For oauth2-proxy, Pomerium, an OIDC-enabled ingress, and similar proxies. The email comes from
  `CONSOLE_AUTH_EMAIL_HEADER` (default `x-forwarded-email`; oauth2-proxy uses `x-auth-request-email`). An
  optional display name comes from `CONSOLE_AUTH_NAME_HEADER`.
- **Caveat:** the header is trusted. The app must be reachable only through the proxy, and the proxy must
  overwrite or strip that header on incoming client requests.

`POST /api/v1/auth/login` returns **404** in `iap` and `oidc-header` modes. `/login` then only explains
that the proxy is missing.

## Permissions and roles

| Permission | Meaning | Enforced at |
| --- | --- | --- |
| `view` | read dashboards, logs, all `GET /api/v1/**` | proxy (all GET API + every page) |
| `capacity:write` | `PATCH /languages/{lang}/capacity`, `PATCH /capacity/global` | proxy + `requirePermission` |
| `config:write` | `PATCH /config` (incl. version promotion) | proxy + `requirePermission` |
| `dlq:replay` | DLQ replay, batch replay, close, assign | proxy + `requirePermission` |
| `workflow:cancel` | `POST /workflows/{id}/cancel` | proxy + `requirePermission` |
| `sim:control` | `POST /sim` (pause, resume, speed, step, inject) | proxy |
| `hermes:access` | `/hermes` | proxy + page (`forbidden()`) |
| `admin` | implies every permission | — |

Default role map in `console.config.ts`. Change it there.

| Role | Permissions |
| --- | --- |
| Viewer | `view` |
| Operator | `view`, `capacity:write`, `dlq:replay`, `workflow:cancel`, `hermes:access` |
| Admin | `*` (everything, incl. `config:write`, `sim:control`, `admin`) |
| HermesUser | `view`, `hermes:access` (granted by `CONSOLE_HERMES_USERS`) |

- Alert ack and resolve need at least one of `capacity:write`, `dlq:replay` or `workflow:cancel`.
- **Unknown mutating endpoints are deny-by-default (`admin`).** When you add a POST, PATCH or DELETE route,
  add a row to `src/server/auth/policy.ts`.
- `GET` APIs require `view` (`auth.protectReadApi: true`). `/api/v1/auth/*` is public.
- Route handlers check the **same canonical keys** as the proxy table (`capacity:write`, `config:write`,
  `dlq:replay`, `workflow:cancel`, `sim:control`; alert ack/resolve pass the any-of list
  `OPERATIONAL_PERMISSIONS`): `requirePermission(op, key | keys[])`. There is no per-path special case.
- Legacy catalog keys are still mapped by `canonicalPermission()` for backward compatibility of
  external callers and old UI code (`useSession().can(key)`); new code shouldn't use them:
  - `read`, `export` → `view`
  - `cancel` → `workflow:cancel`
  - `replay.request`, `replay.approve` → `dlq:replay`
  - `language.pause` → `capacity:write`
  - `config.write`, `version.promote` → `config:write`
  - `iam` → `admin`

## Adding users (role assignment)

A user's roles are the union of:

1. their base roles (mock users only)
2. every matching rule in `auth.rules` (exact `emails` or email `domains`, where a subdomain also matches)
3. the env lists in `auth.envOverrides`:

| Env var (comma-separated emails) | Role |
| --- | --- |
| `CONSOLE_ADMINS` | Admin |
| `CONSOLE_OPERATORS` | Operator |
| `CONSOLE_VIEWERS` | Viewer |
| `CONSOLE_HERMES_USERS` | HermesUser |
| `CONSOLE_VIEWER_DOMAINS` (domains) | Viewer, via the domain rule in `console.config.ts` |

If nothing matches, the user gets `auth.defaultRoles`, which is `[]` by default. Such a user is
authenticated but has no permissions, so every page shows 403 and every API call returns 403 (deny by default).

Examples:

```bash
CONSOLE_ADMINS=lead@samsung.com
CONSOLE_OPERATORS=ops1@samsung.com,ops2@samsung.com
CONSOLE_HERMES_USERS=analyst@samsung.com
CONSOLE_VIEWER_DOMAINS=samsung.com
```

To add a role, add it to `auth.roles` and reference it from rules or env overrides. To add a permission,
use any string in a role's `permissions`, then check it with `requirePermission(op, "x:y")` or
`can(session, "x:y")`, or add a row to `policy.ts`.

## Session API and client

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/auth/session` | always 200: `{ authenticated, mode, user, roles, permissions, branding, links: { hermes: { allowed, configured } } }` (no URL) |
| POST | `/api/v1/auth/login` | mock only (404 otherwise). JSON `{ userId, next? }` → 200 SessionInfo, form post → 303 to `next` (same-origin paths only) |
| POST | `/api/v1/auth/logout` | clears the cookie. JSON → `{ ok, redirect }`, form post → 303 |
| GET | `/api/v1/me` | `MeInfo` (`operator`, `permissions` with legacy and new keys) plus `roles` and `user`. 401 without a session |
| GET | `/api/v1/operators` | engine operator roster plus the resolved `roles` and `permissions` tables |

```tsx
import { useSession } from "@/lib/client/session";
const { user, roles, can, logout } = useSession();
{can("hermes:access") && <Link href="/hermes">Hermes</Link>}
```

`SessionProvider` is mounted in `src/app/layout.tsx` with the session resolved on the server, so there
is no loading flash. **Hiding UI is cosmetic. The server checks are the gate.**
`useOperator()` and `setOperatorId()` from `src/lib/client/operator.ts` still exist for older UI code:
`useOperator()` returns the session user, and `setOperatorId()` navigates to `/login`.

Audit: `resolveOperator()` registers the session user in the engine's operator index. Each `AuditEntry`
therefore records `actor` (mock id or email), `actorName` and `role` from the session, plus the request's
`idempotency_key`, `user_agent` and `source_ip` (`x-forwarded-for`) and a `result` of `success`,
`denied` or `error`. Besides every state change, the console audits (`src/server/services/audit.ts`):

| Action | When | `result` |
| --- | --- | --- |
| `AUTH_LOGIN` / `AUTH_LOGOUT` | `POST /api/v1/auth/login` (mock) / `logout` | success |
| `HERMES_ACCESS` | every `/hermes` attempt (proxy for refusals, the page for allowed entries) | success / denied |
| `PERMISSION_DENIED` | 403 on a state-changing API, from the proxy table or a route's `requirePermission` (target `"<METHOD> <path>"`, `after.required`) | denied |

Filter with `GET /api/v1/audit?result=denied`.

## Hermes link

`/hermes` (`src/app/(console)/hermes/page.tsx`, a server component):

| Situation | Result |
| --- | --- |
| no session | 307 → `/login?next=/hermes` (`mock`); 401 (`iap`, `oidc-header`) |
| session without `hermes:access` | **403**. The proxy rewrites to the server-rendered `/403` page with status 403 (theme applied pre-paint). `forbidden()` in the page stays as defense in depth and would render `src/app/forbidden.tsx` |
| allowed, `HERMES_DASHBOARD_URL` set | **307** → that URL |
| allowed, URL unset | "not configured yet" placeholder |

Configure the link in `console.config.ts` → `externalLinks.hermes`:

- `url`: from `HERMES_DASHBOARD_URL`, read at runtime. Restart the server to change it.
- `requiredPermission`: `hermes:access`.
- `allowedRoles`: extra roles that get the permission. They are merged into the role map.

`forbidden()` requires `experimental.authInterrupts: true`, which is set in `next.config.ts`. Hermes runs
its own authentication. This page only guards the entry point inside the console.

## Cloud Run + IAP setup notes

1. Build and push the image (`Dockerfile`, standalone, port 8080, non-root):
   ```bash
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/aipo-ops-web
   ```
2. Deploy with **no public ingress**:
   ```bash
   gcloud run deploy aipo-ops-web --image … --region REGION \
     --ingress internal-and-cloud-load-balancing --no-allow-unauthenticated \
     --set-env-vars CONSOLE_AUTH_MODE=iap,IAP_AUDIENCE=/projects/NUM/global/backendServices/ID,\
   CONSOLE_ADMINS=…,CONSOLE_OPERATORS=…,CONSOLE_VIEWER_DOMAINS=…,HERMES_DASHBOARD_URL=…
   ```
3. Put an external HTTPS load balancer with a serverless NEG in front, and enable IAP on its backend service.
   Alternatively, use Cloud Run's built-in IAP (`gcloud run services update … --iap`); its audience is
   `/projects/NUM/locations/REGION/services/NAME`.
4. Grant `roles/iap.httpsResourceAccessor` to the people or groups who may sign in. Grant the IAP service
   agent `roles/run.invoker` on the service.
5. Get the backend service id (`gcloud compute backend-services describe NAME --global --format='value(id)'`)
   and set `IAP_AUDIENCE`. Then confirm that a direct `curl` without IAP fails with 401 or 403.
6. IAP decides **who may sign in**. Console RBAC decides **what they may do**. Users who pass IAP but
   match no rule get 403 everywhere.

## Testing locally

```bash
NEXT_DIST_DIR=.next-b npx next dev -p 3312
B=http://localhost:3312
curl -i $B/hermes                                                     # 307 → /login?next=/hermes
curl -s -c v.jar -d userId=op-choi-mj $B/api/v1/auth/login -o /dev/null   # Viewer
curl -s -c o.jar -d userId=op-park-jh $B/api/v1/auth/login -o /dev/null   # Operator
curl -i -b v.jar $B/hermes                                            # 403
curl -i -b o.jar $B/hermes                                            # 200 placeholder (307 with HERMES_DASHBOARD_URL)
curl -s -b v.jar -X PATCH -H 'content-type: application/json' \
  -d '{"max_concurrent":9,"reason":"t"}' $B/api/v1/languages/ko/capacity  # 403
curl -s -b o.jar -X PATCH -H 'content-type: application/json' \
  -d '{"max_concurrent":9,"reason":"t"}' $B/api/v1/languages/ko/capacity  # 200
curl -s -b o.jar "$B/api/v1/audit?pageSize=1"                         # actor op-park-jh / 박지훈 / Operator

# iap mode with a forged header (no IAP_AUDIENCE → header trusted, warning logged):
CONSOLE_AUTH_MODE=iap CONSOLE_OPERATORS=me@example.com NEXT_DIST_DIR=.next-b npx next dev -p 3312
curl -s -H 'x-goog-authenticated-user-email: accounts.google.com:me@example.com' $B/api/v1/auth/session
# …and with IAP_AUDIENCE set, the same forged request → 401
```
