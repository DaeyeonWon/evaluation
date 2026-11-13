# AIPO Operations Console — Architecture

How the app is put together: where code lives, how a request and a live update travel, which parts are
swappable, and how to add a screen. For the API itself see `docs/data-contract.md`; for auth, roles and
Hermes see `docs/auth.md`; for KO/EN see `docs/i18n.md`.

Stack: Next.js 16 (App Router, `src/proxy.ts` instead of middleware) · React 19 · TypeScript · Tailwind v4 ·
ECharts 6 · motion · d3-zoom. Next 16 has breaking changes; read `node_modules/next/dist/docs/` before
touching a Next API.

---

## 1. Directory structure

```
operations-web/
├── console.config.ts            # branding, auth mode, roles/rules, env overrides, external links (server-only)
├── next.config.ts               # distDir from NEXT_DIST_DIR, standalone output, OPERATIONS_API_URL rewrite, authInterrupts
├── src/
│   ├── proxy.ts                 # first gate for every page + /api/v1 request (auth, coarse RBAC, identity headers)
│   ├── app/
│   │   ├── layout.tsx           # root: fonts, ThemeScript, I18nProvider, ThemeProvider, SessionProvider, LiveStreamProvider
│   │   ├── (console)/           # every console screen; layout.tsx mounts the Atlas shell
│   │   ├── login/  403/  forbidden.tsx
│   │   └── api/v1/**/route.ts   # built-in Operations API (thin handlers over src/server/services)
│   ├── components/
│   │   ├── atlas/               # screens + shell (shell.tsx, time-range.tsx, ui.tsx, canvas/, board/, pipelines/, files/, analytics/, dag/, results/)
│   │   └── shared/              # design-neutral primitives: EChart, StatusPill, theme, locale toggle, icons, motion
│   ├── config/                  # schema.ts (config types + permission helpers), index.ts (loader), domain.ts (domain model)
│   ├── fonts/index.ts           # next/font: SUIT Variable + IBM Plex Mono
│   ├── i18n/                    # core, client/server/request entry points, static helpers, messages/{ko,en}/<ns>.ts
│   ├── lib/
│   │   ├── types.ts             # every domain + API type (single source for client and server)
│   │   ├── catalog.ts           # static catalog derived from domain.ts (stages, statuses, DAG template, operators…)
│   │   ├── time-range.ts        # RangeSpec parse/serialize/resolve (shared by client and server)
│   │   ├── format.ts            # KST formatters
│   │   └── client/              # api.ts, use-api.ts, live-stream.tsx, auth-redirect.ts, use-query-state.ts, session.tsx, download.ts
│   ├── server/
│   │   ├── http.ts              # handle(), ApiError (localized), Query/V validators, resolveOperator, requirePermission, idempotency
│   │   ├── range.ts             # reads ?range= / ?from=&to= against the virtual clock
│   │   ├── auth/                # core.ts, policy.ts (API permission table), rbac.ts, session-cookie.ts, adapters/{mock,iap,oidc-header}.ts
│   │   ├── services/            # domain rules per area (workflows, dlq, capacity, config, results, files, pipelines, analytics, …)
│   │   └── mock/                # deterministic engine + simulator runtime (globalThis singleton) + projections
│   └── styles/                  # atlas.css (tokens, light/dark) + atlas-{board,data,files,pipelines}.css
├── e2e/smoke/smoke.spec.ts      # Playwright smoke
├── scripts/gen-catalog.mjs
└── docs/                        # architecture, data-contract, auth, i18n, adoption (ko), integration-spec, openapi.yaml
```

---

## 2. Request and data flow

```
browser ─ fetch /api/v1/… (same origin, cookies: aipo_session, console_locale)
   │
   ▼
src/proxy.ts ── 1. adapter.verify() (IAP JWT if IAP_AUDIENCE) ─ fail → 401
   │            2. no session: page → 307 /login?next=…   API → 401 JSON (localized)
   │            3. API permission table (server/auth/policy.ts) → 403 JSON (localized)
   │            4. page: no `view` / no page permission → rewrite to /403 with HTTP 403
   │            5. strips x-operator + x-console-user-*, sets x-console-user-* from the session
   ▼
OPERATIONS_API_URL set at build?  ── yes → beforeFiles rewrite to the real FastAPI (except /api/v1/auth/**)
   │ no
   ▼
src/app/api/v1/**/route.ts ── handle(): try → service → ok(json) | ApiError → errorResponse(e, req)
   ▼
src/server/services/*  ── validation, RBAC (requirePermission), domain rules, audit actor
   ▼
src/server/mock/*      ── engine state + simulator (one per Node process)
```

- Client code calls the API only through `src/lib/client` (`api.*`, `useApi`, `useLiveStream`, `csvUrl`).
  `API_BASE` defaults to `/api/v1`; `NEXT_PUBLIC_API_BASE` (build time) points the browser at another
  origin directly, which bypasses the proxy and the console RBAC, so prefer `OPERATIONS_API_URL`.
- Server components read the session with `getSession()` (`src/server/auth`) and translations with
  `getT()`; they don't fetch `/api/v1`.
- Errors come back as `{ error: { code, message, key?, details? } }`. `message` is already in the request
  locale (`console_locale` cookie → `Accept-Language` → default). See `docs/i18n.md` §7.2.

### Adapters (what you swap when adopting)

| Concern | Built in | Swap by |
| --- | --- | --- |
| Identity | `mock` (demo `/login`, signed HttpOnly cookie) | `CONSOLE_AUTH_MODE=iap` (IAP headers + JWT) or `oidc-header` (trusted proxy header); `src/server/auth/adapters/*` |
| Roles | `console.config.ts` roles/rules + `CONSOLE_ADMINS`/`…` env lists | edit `console.config.ts` |
| Data | mock engine behind `src/app/api/v1` | `OPERATIONS_API_URL` (build) → real FastAPI implementing `docs/data-contract.md` |
| Domain | `src/config/domain.ts` (languages, stages, buckets, pipelines…) | edit `domain.ts`, then `npm run gen:catalog` if you change catalog sources |

---

## 3. Routes

### Pages (`src/app/(console)/**` unless noted)

| Route | Screen |
| --- | --- |
| `/` | Orchestration canvas: the §3.1 architecture as a pannable blueprint, live batch tokens, stage inspector, file-name search |
| `/board` | Language lanes × Workflow state board, Time river, stage inspector drawer |
| `/overview` | KPIs, status/language/error charts, alerts |
| `/capacity` | Per-language and global Capacity, edit with dry run and reason |
| `/explorer` | Workflow search/filter table |
| `/pipelines` | Pipeline registry catalog (root + sub-pipelines, versions) |
| `/pipelines/[id]` | Pipeline status: runs, per-node activity, job explorer |
| `/workflows` | Redirects to the latest running Workflow |
| `/workflows/[id]` | Workflow detail: DAG, timeline, attempts, logs, cancel |
| `/files` | GCS file search across stages |
| `/dlq` | Dead letters: review, Replay (single/batch), close, assign |
| `/results` | Evaluation results (PASS/FAIL), utterance drawer, CSV export |
| `/analytics` | Long-range analytics (quality, errors, components, versions, cost) |
| `/config` | Retry/timeout, version traffic, services, alert policies, roles, audit log |
| `/hermes` | Entry to the external Hermes dashboard (307 when configured, 403 without `hermes:access`) |
| `/login` (`src/app/login`) | Mock-mode demo login; explains the auth proxy in other modes |
| `/403` (`src/app/403`) | Server-rendered forbidden UI (same component as `src/app/forbidden.tsx`); the proxy serves it with HTTP 403, also as the rewrite target for pages the session may not open |

### API groups (`/api/v1`)

`auth/{session,login,logout}` · `me` · `operators` · `meta` · `overview` · `workflows` (+ `[id]`, `events`,
`logs`, `attempts`, `dag`, `results`, `pipeline-runs`, `cancel`) · `pipelines` (+ `[id]`, `runs`) ·
`pipeline-jobs/[jobId]` · `stages` (+ `[id]`) · `languages/capacity`, `languages/[lang]/capacity` ·
`capacity/{global,history}` · `reservations` · `dead-letters` (+ `[id]`, `replay`, `assign`, `close`,
`replay-batch`) · `replays` · `results` (+ `[utterance_id]`, `csv`, `file`) · `files/search` ·
`gcs/{buckets,objects,object}` · `analytics/*` · `config` · `audit` · `alerts` (+ `ack`, `resolve`) ·
`incidents` · `events` · `logs` · `sim` · `stream`. Full contract: `docs/data-contract.md`, `docs/openapi.yaml`.

---

## 4. Live updates (SSE)

- `GET /api/v1/stream` is a `text/event-stream`. On connect it sends `retry: 3000`, `hello` (sim state,
  `lastEventId`, `resumed`, `resync`), any backfill, then a fresh `tick`; afterwards `id: <epoch>-<seq>` +
  `event: <type>` + `data: <json>` messages and a `: keep-alive` comment every 15 s. `?types=` filters the stream.
- **Backfill:** `Last-Event-ID` (sent by the browser on native reconnect) or `?last_event_id=` replays the
  missed messages from a ring buffer (5,000 messages / 5 min, `tick` excluded because each tick is a full
  snapshot). An unknown, expired or other-process id gets `hello.resync = true`, and the client refetches
  every mounted query (`revalidateKey(() => true)`).
- Message types (`StreamEventMap` in `src/lib/types.ts`): `tick` (every 1.2 s: status/stage counts, KPIs,
  Capacity, positions of active Workflows), `transition`, `event`, `log` (high volume), `alert`, `audit`,
  `dlq`, `sim` (pause/speed/re-seed), `job` (PipelineJob node updates).
- The root layout mounts **one** `LiveStreamProvider` (only when signed in), so the whole app shares a
  single `EventSource`. Components use `useLiveStream()` (snapshot + status), `useSimNow()` (virtual
  clock), `useStreamEvent(type, cb)`, or `useApi(key, fetcher, { revalidateOn: ["transition"] })` to refetch
  on matching messages (throttled).
- Reconnect: transient drops use the browser's native reconnect (with `Last-Event-ID`); only when the
  `EventSource` is `CLOSED` (HTTP error) does the store recreate it with exponential backoff 1 s → 30 s and
  `?last_event_id=`. `EventSource` can't see HTTP status, so after a
  connection error the store asks `/api/v1/auth/session`; if `authenticated` is false it redirects to
  `/login?next=…` (`src/lib/client/auth-redirect.ts`).
- Server side: `src/server/mock/runtime.ts` ticks every 1.2 s and advances the virtual clock by
  20 s × speed. Ticks are skipped after 2 min with no stream subscriber and no API request. When the
  virtual clock leaves the seeded KST day, the engine is re-seeded on the new day (same time of day) and a
  `sim` message tells clients to refetch.

---

## 5. Cross-cutting client contracts

### Global time range

- The range is URL state: `?range=today|yesterday|1h|6h|24h|7d|30d|<N>h|<N>d` or `?from=…&to=…`
  (`to` omitted = until now). `today` is the default and is omitted from the URL.
- `useTimeRange()` gives `{ spec, params, resolved, key, setSpec }`. Pass `params` to every ranged `api.*`
  call and put `key` in the `useApi` key.
- The header `RangePicker` (`src/components/atlas/time-range.tsx`) edits it. Labels are rebuilt on the
  client (`useRangeLabel`); the server's `range.label` is also localized to the request locale.
- **Every in-app link keeps the range**: wrap hrefs and `router.push` targets with `useRangeHref()`.
  For links to one Workflow's results use `useCoverHref()(href, wf.created_at, wf.completed_at)`, which
  widens the range to cover that Workflow when it falls outside the current one.

### Auth on the client

- `useSession()` → `{ user, roles, can(permission), logout }`, resolved on the server (no loading flash).
  Disable or hide actions with `can()` and give a localized reason (title/note); the server enforces anyway.
- **401**: `api.request()` calls `redirectToLogin()` for any 401 outside `/api/v1/auth/*`, so background
  refetches also land on `/login?next=<current page>`. It is a full navigation, at most once per page
  load, and never on `/login` or `/403` (no loops). `<ErrorNote>`, `useToast().err` and the analytics
  helpers use the same function.
- **403**: `<ErrorNote>` / toasts show the localized "no permission" text plus the server message.

### Stage inspector URL (canvas `/` and `/board`)

`?stage=<StageId>` opens the inspector. `?tab=wf|gcs|ev|log|met` selects the tab (`gcs` is the objects tab;
`obj` is accepted as an alias; `wf` is the default and omitted). `?q=` is the objects-tab file-name filter,
written debounced (250 ms). Deep links such as `/?stage=gcs_input&tab=gcs&q=batch-0014` (from the canvas
search and `/files`) open pre-filtered. Closing the inspector clears `stage`/`tab` (the board also clears `q`;
on the canvas `q` is also the canvas search).

### Canvas `?pipeline=`

Selects the pipeline drawn inside the expanded Vertex AI node (default: the busiest root). Batch tokens only
carry a legacy phase (`current_node`), so they are drawn inside Vertex only when the selected DAG is a root
pipeline that covers every legacy phase. For sub-pipelines, or roots that skip phases, the Vertex tokens are
hidden and each DAG node shows a running-count badge.

### Theme

`ThemeScript` (root layout `<head>`) sets `data-theme` before first paint from `localStorage("aipo.theme")`
and the OS setting. It renders its `<script>` only during SSR and hydration. When React renders the root
client-only, it renders nothing and applies the theme in a layout effect instead, which avoids React's
"Encountered a script tag" warning. Next does that client-only render when `forbidden()` / `notFound()` is
thrown before the shell (the `__next_error__` shell, in dev and prod). That is why 403s normally go through
the server-rendered `/403` page (proxy rewrite with status 403); `forbidden()` in `hermes/page.tsx` is only
defense in depth. `ThemeProvider` keeps `data-theme` in sync afterwards.

### Fonts

Only two faces: **SUIT Variable** (`--font-atlas-sans`, bundled from `@sun-typeface/suit`, preloaded) and
**IBM Plex Mono** (`--font-atlas-mono`, `next/font/google`, fetched at build time). Atlas reads them through
`--f-ui` / `--f-mono` in `atlas.css`.

### i18n

Every visible string goes through `useT(ns)` / `getT(ns)`; status enums stay English in both locales. See
`docs/i18n.md`.

---

## 6. How to add a screen

1. **Route**: `src/app/(console)/<name>/page.tsx`. Export `generateMetadata()` using `getT("nav")` and
   render your client component inside `<Suspense>` (it will use `useSearchParams`).
2. **Component**: `src/components/atlas/<name>.tsx` (`"use client"`). Use the shell primitives from `./ui`
   (`Sheet`, `SheetHead`, `Plate`, `ErrorNote`, `Skeleton`, `useToast`) and put new CSS in
   `src/styles/atlas-<area>.css`, scoped under `[data-variant="atlas"]`.
3. **Navigation**: add an entry to `TABS` in `src/components/atlas/shell.tsx` and `nav.<key>.{label,title}`
   to `src/i18n/messages/{ko,en}/nav.ts`.
4. **Strings**: create `src/i18n/messages/ko/<ns>.ts` and `en/<ns>.ts` (`satisfies Messages<typeof ko>`),
   then register the namespace in `NAMESPACES` and both maps in `src/i18n/messages/index.ts`.
5. **Data**: `const tr = useTimeRange()`, then
   `useApi(["<name>", tr.key, filters], () => api.x({ ...tr.params, ...filters }), { revalidateOn: [...] })`.
   Keep filters in the URL with `useQueryState(s)`.
6. **Links**: wrap every internal href / `router.push` with `useRangeHref()`.
7. **Permissions**: gate actions with `useSession().can("…")` and a localized reason. On the server, call
   `requirePermission(op, "…")` in the service, and add a row to `src/server/auth/policy.ts` for every new
   mutating route (unknown mutating routes are `admin`-only by default).
8. **API** (if new): a thin `src/app/api/v1/.../route.ts` using `handle()`, logic in `src/server/services`,
   errors as `badRequest({ key: "validation.…", vars })` etc. with keys in `errors.*`. Document it in
   `docs/data-contract.md`.
9. **Tests**: add the route to `ROUTES` in `e2e/smoke/smoke.spec.ts`.

---

## 7. Checks

| Command | What |
| --- | --- |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run lint` | ESLint (next core-web-vitals + typescript, react-hooks v7) |
| `npm run i18n:check` | `tsx src/i18n/check-messages.ts`: key parity, leaf types and placeholders across locales |
| `npm run build` | production build (standalone) |
| `npm run test:e2e` | Playwright. The `webServer` starts `next dev -p 3100` with `NEXT_DIST_DIR=.next-e2e` (or reuses a server already on :3100). `PW_BASE_URL=http://host:port` targets a server you started yourself instead |

Several dev servers can run side by side with separate dist dirs: `NEXT_DIST_DIR=.next-x npx next dev -p 3101`.

---

## 8. Gotchas

1. **Time.** Never use `Date.now()` / `new Date()` for ages, "n분 전" or SLA math. Use `useSimNow()` and
   `fmt.relative(ts, now)`: every timestamp is virtual.
2. **`useSearchParams` / `useQueryState` / `useTimeRange`** need a `<Suspense>` boundary around the component,
   or `next build` fails on prerendered pages.
3. **Lint (react-hooks v7 rules are errors).** No synchronous `setState` in an effect (derive the value, adjust
   state during render, or use `useSyncExternalStore`); no `ref.current` reads during render; don't create
   components during render (`<CatalogIcon name={x}/>`, not `const Icon = iconFor(x)`).
4. **next/font** options must be inline literals (no shared constants or spreads).
5. **Idempotency.** `api.*` sends one `Idempotency-Key` per user action (method + path + body): the key is
   dropped on a 2xx/4xx answer and reused when the same action is retried after a network error, abort or
   5xx (10-min TTL). The server (`idempotent()` in `http.ts`) caches 2xx/4xx JSON answers per key for
   10 min and replays them with `idempotent-replay: true`; 5xx is never stored.
6. **ISO times in URLs**: `+` decodes to a space, so encode it as `%2B` or use epoch ms / `Z`.
7. **CSS**: don't `@import "tailwindcss"` again in screen CSS; scope under `[data-variant="atlas"]`; use
   `@reference "../app/globals.css"` for `@apply`.
8. **motion** comes from `"motion/react"`. Respect reduced motion (`useReducedMotionSafe()` in `./ui`).
9. **EChart** needs an explicit height. Pass `option` as a function so colors follow the theme, and pass the
   locale into option callbacks (they run outside React).
10. **SSE `log` volume** is about 20–40 per tick. Filter in the callback and cap your buffer.
11. **List endpoints return `WorkflowSummary`** (no `attempts`/`dag`); fetch `/workflows/[id]` for detail.
12. **Engine state is live.** Never mutate API payloads expecting a server change; call the mutation endpoint.
13. **Restart dev after editing `src/server/mock/**`** (globalThis singleton).
14. **403 pages.** Send users to the server-rendered `/403` (the proxy rewrites with `{ status: 403 }`) instead
    of calling `forbidden()`: a `forbidden()` thrown before the shell makes Next serve its client-rendered
    `__next_error__` shell with no server HTML. Any 403 document makes the browser log
    "Failed to load resource: … 403"; the e2e smoke allows that line on the 403 pages only.
15. `next dev` may rewrite `tsconfig.json` and `AGENTS.md`; revert unintended changes before committing.
