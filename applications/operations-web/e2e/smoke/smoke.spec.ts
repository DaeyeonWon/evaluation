import { expect, test, type Page } from "@playwright/test";
import { FEATURE_IDS, MODULE_IDS } from "../../src/config/analysis-modules";

/**
 * Smoke: every console route renders in ko and en with no console errors, roles are enforced
 * (Viewer gets 403 on /hermes and on write APIs, including PATCH /api/v1/issues/{id}), and the shared fonts load.
 * Issue Report: the merged routes, the 308 redirects from the candidate routes, view switching with filters and a
 * custom range (into /issues/<id>?…&via=<view>), the Triage lens switch / subgroup=none and the Viewer read-only state.
 * Quality (Phase 1) / Deep Analysis (Phase 2): nav tabs active per route, Quality → /results drill-down keeps every filter
 * (incl. one_ui_version) with the same row count, the judge-model caveat on version comparisons, the /issues/modules matrix.
 * Run: `npm run test:e2e` (starts a dev server, see playwright.config.ts) or point PW_BASE_URL at a
 * running server.
 */

const ADMIN = "op-kim-sy";
const VIEWER = "op-choi-mj";
const LOCALES = ["ko", "en"] as const;

/** every page route under src/app/(console) plus the public ones */
const ROUTES = [
  "/",
  "/board",
  "/overview",
  "/capacity",
  "/explorer",
  "/pipelines",
  "/pipelines/bixby-eval-full",
  "/workflows", // redirects to the latest running workflow → /workflows/[id]
  "/files?q=batch-0001",
  "/dlq",
  "/results",
  "/quality",
  "/quality/breakdown",
  "/quality/matrix",
  "/quality/versions",
  "/quality/distributions",
  "/issues",
  "/issues/categories",
  "/issues/analysis",
  "/issues/report",
  "/issues/modules",
  "/issues/:first", // replaced by the top issue id (GET /api/v1/issues) in the sweep
  "/analytics",
  "/config",
  "/hermes", // Admin: "not configured" placeholder (HERMES_DASHBOARD_URL unset)
];

async function signIn(page: Page, userId: string, locale: (typeof LOCALES)[number]) {
  const base = test.info().project.use.baseURL!;
  const res = await page.context().request.post("/api/v1/auth/login", { form: { userId }, maxRedirects: 0 });
  expect(res.status()).toBeLessThan(400);
  await page.context().addCookies([{ name: "console_locale", value: locale, url: base }]);
}

/** Collects console errors + uncaught page errors; `allow` filters expected noise (e.g. the 403 document). */
function watchConsole(page: Page, allow: RegExp[] = []) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (!allow.some((r) => r.test(text))) errors.push(`${page.url()} :: ${text}`);
  });
  page.on("pageerror", (e) => errors.push(`${page.url()} :: pageerror ${e.message}`));
  return errors;
}

for (const locale of LOCALES) {
  test(`every route renders without console errors (${locale})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "full route sweep runs once (desktop)");
    test.setTimeout(ROUTES.length * 45_000);
    await signIn(page, ADMIN, locale);
    const errors = watchConsole(page);
    const top = (await (await page.context().request.get("/api/v1/issues?pageSize=1")).json()) as { items: { id: string }[] };
    for (const r of ROUTES) {
      const route = r === "/issues/:first" ? `/issues/${encodeURIComponent(top.items[0]?.id ?? "iss-missing")}` : r;
      const res = await page.goto(route, { waitUntil: "load", timeout: 90_000 });
      expect(res?.status(), route).toBeLessThan(400);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("#atlas-main")).toBeVisible();
      await page.waitForTimeout(1500); // let effects, first fetches and the SSE stream settle
    }
    expect(errors).toEqual([]);
  });
}

test("Viewer: /hermes and /403 are 403, write APIs are 403 (localized)", async ({ page }) => {
  await signIn(page, VIEWER, "en");
  const errors = watchConsole(page, [/status of 403/]);
  for (const route of ["/hermes", "/403"]) {
    const res = await page.goto(route);
    expect(res?.status(), route).toBe(403);
    await expect(page.locator(".auth-code")).toContainText("403");
  }
  const api = page.context().request;
  const cancel = await api.post("/api/v1/workflows/wf-does-not-matter/cancel", { data: { reason: "smoke test" } });
  expect(cancel.status()).toBe(403);
  expect((await cancel.json()).error.message).toContain("Required: workflow:cancel");
  const sim = await api.post("/api/v1/sim", { data: { action: "pause" } });
  expect(sim.status()).toBe(403);
  const patch = await api.patch("/api/v1/issues/iss-does-not-matter", { data: { status: "TRIAGED" } });
  expect(patch.status()).toBe(403);
  expect((await patch.json()).error.message).toContain("Required: issues:write");
  expect(errors).toEqual([]);
});

test("login page lists the demo users and the shared fonts load", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("form")).not.toHaveCount(0);
  const ok = await page.evaluate(async () => {
    const out: Record<string, boolean> = {};
    for (const v of ["--font-atlas-sans", "--font-atlas-mono"]) {
      const fam = getComputedStyle(document.documentElement).getPropertyValue(v).split(",")[0].trim();
      await document.fonts.load(`500 16px ${fam}`, "한글 Aa 0");
      // check() is also true for a family that has no faces at all, so look for a loaded face
      const name = fam.replace(/["']/g, "");
      out[v] = [...document.fonts].some((f) => f.family.replace(/["']/g, "") === name && f.status === "loaded");
    }
    return out;
  });
  expect(ok).toEqual({ "--font-atlas-sans": true, "--font-atlas-mono": true });
});

test("legacy Issue Report candidate routes 308 to the merged views, keeping the query", async ({ page }) => {
  await signIn(page, ADMIN, "ko");
  const request = page.context().request;
  for (const [from, to] of [
    ["/issues/a", "/issues"],
    ["/issues/b", "/issues/report"],
    ["/issues/c", "/issues/analysis"],
  ]) {
    const res = await request.get(`${from}?market=KR,US&range=7d`, { maxRedirects: 0 });
    expect(res.status(), from).toBe(308);
    const loc = new URL(res.headers()["location"], "http://x");
    expect(loc.pathname, from).toBe(to);
    expect(loc.searchParams.get("market"), from).toBe("KR,US");
    expect(loc.searchParams.get("range"), from).toBe("7d");
  }
});

test("Issue Report view switcher keeps the filter query", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "en");
  await page.goto("/issues?division=TV&severity=P0,P1&lens=dev");
  const nav = page.locator(".isf-views");
  await nav.getByRole("link").nth(2).click();
  await expect(page).toHaveURL(/\/issues\/analysis\?/);
  const u = new URL(page.url());
  expect(u.searchParams.get("division")).toBe("TV");
  expect(u.searchParams.get("severity")).toBe("P0,P1");
  expect(u.searchParams.get("lens")).toBeNull(); // Triage-only view state is dropped
});

test("Issue Report: a custom range survives view switching and opening an issue (via=, not from=)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "ko");
  // a custom window inside the data (the virtual clock decides where "now" is)
  const r7 = ((await (await page.context().request.get("/api/v1/issues/summary?range=7d")).json()) as { range: { from: number; to: number } }).range;
  const from = new Date(r7.from + 86_400_000).toISOString();
  const to = new Date(r7.to - 6 * 3_600_000).toISOString();
  await page.goto(`/issues/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&division=TV,Mobile`);
  const link = page.locator(".iss-b a[href^='/issues/iss-']").first();
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute("href"))!, "http://x");
  expect(href.searchParams.get("via")).toBe("report");
  expect(href.searchParams.get("from")).toBe(from); // the range start, never the origin view
  expect(href.searchParams.get("to")).toBe(to);
  expect(href.searchParams.get("division")).toBe("TV,Mobile");
  const detail = page.waitForRequest((r) => /\/api\/v1\/issues\/iss-[^/?]+\?/.test(r.url()));
  await link.click();
  await expect(page).toHaveURL(/\/issues\/iss-/);
  const api = new URL((await detail).url());
  expect(api.searchParams.get("from")).toBe(from);
  expect(api.searchParams.get("range")).toBeNull();
  const back = new URL((await page.locator(".isf-back").getAttribute("href"))!, "http://x");
  expect(back.pathname).toBe("/issues/report");
  expect(back.searchParams.get("from")).toBe(from);
});

test("Issue Report: Triage lens switch and subgroup=none", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "en");
  await page.goto("/issues?range=7d");
  await expect(page.locator(".ia-lane").first()).toHaveAttribute("data-k", "P0");
  await page.locator('.ia-lens-opt[data-l="dev"]').click();
  await expect(page).toHaveURL(/lens=dev/);
  expect(new URL(page.url()).searchParams.get("must_handle")).toBe("true"); // the dev lens default
  await expect(page.locator(".ia-card .ia-type[data-dim='dev_miss']").first()).toBeVisible();
  await page.goto("/issues?range=7d&subgroup=none");
  await expect(page.locator(".ia-card").first()).toBeVisible();
  await expect(page.locator(".ia-sub")).toHaveCount(0);
  await expect(page.locator(".ia-grp label:nth-of-type(2) select")).toHaveValue("");
});

test("Issue Report: Viewer sees disabled triage controls and PATCH is 403", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, VIEWER, "ko");
  await page.goto("/issues?range=7d");
  const btns = page.locator(".ia-card .ia-c-btns button:not(.ia-c-more)");
  await expect(btns.first()).toBeVisible();
  expect(await btns.evaluateAll((b) => b.every((x) => (x as HTMLButtonElement).disabled))).toBe(true);
  const top = (await (await page.context().request.get("/api/v1/issues?range=7d&pageSize=1")).json()) as { items: { id: string }[] };
  const res = await page.context().request.patch(`/api/v1/issues/${top.items[0].id}`, { data: { status: "TRIAGED" } });
  expect(res.status()).toBe(403);
});

test("API: overview + CSV headers (signed in)", async ({ page }) => {
  await signIn(page, ADMIN, "ko");
  const request = page.context().request;
  const ov = await request.get("/api/v1/overview");
  expect(ov.ok()).toBe(true);
  const csv = await request.get("/api/v1/results/csv?language=ko");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const body = await csv.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});

test("unauthenticated API calls are 401 with a localized body", async ({ request }) => {
  const ko = await request.get("/api/v1/overview", { headers: { cookie: "console_locale=ko" } });
  expect(ko.status()).toBe(401);
  expect((await ko.json()).error.message).toBe("로그인이 필요합니다.");
  const en = await request.get("/api/v1/overview", { headers: { cookie: "console_locale=en" } });
  expect((await en.json()).error.message).toBe("Sign in to continue.");
});

test("nav: Q-01 Quality and I-01 Deep Analysis tabs are active on their routes", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "ko");
  for (const [route, tab, other] of [
    ["/quality", "/quality", "/issues"],
    ["/quality/matrix", "/quality", "/issues"],
    ["/issues", "/issues", "/quality"],
    ["/issues/modules", "/issues", "/quality"],
  ] as const) {
    await page.goto(route);
    const navLink = (h: string) => page.locator(`nav.tabs a:is([href="${h}"], [href^="${h}?"])`).first();
    await expect(navLink(tab), route).toHaveAttribute("aria-current", "page");
    await expect(navLink(other), route).not.toHaveAttribute("aria-current", "page");
  }
  await page.goto("/quality");
  await expect(page.locator('.phase-tag[data-phase="1"]')).toBeVisible();
  await page.goto("/issues/report");
  await expect(page.locator('.phase-tag[data-phase="2"]')).toBeVisible();
  await expect(page.locator("h1").first()).toContainText("심층 분석 · 이슈 리포트");
});

test("Quality → /results drill-down keeps one_ui_version and the row count", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "ko");
  const request = page.context().request;
  await page.goto("/quality/breakdown?range=7d&dim=one_ui_version&division=Mobile");
  const link = page.locator(".qd-bd td.act a").first();
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute("href"))!, "http://x");
  const v = href.searchParams.get("one_ui_version");
  expect(v).toBeTruthy();
  expect(href.searchParams.get("division")).toBe("Mobile");
  const bd = (await (await request.get(`/api/v1/quality/breakdown?range=7d&dim=one_ui_version&division=Mobile&limit=50`)).json()) as { items: { value: string; total: number }[] };
  const want = bd.items.find((x) => x.value === v)!.total;
  const res = (await (await request.get(`/api/v1/results?${href.searchParams.toString()}&pageSize=1`)).json()) as { total: number };
  expect(res.total).toBe(want);
  await link.click();
  await expect(page).toHaveURL(/\/results\?.*one_ui_version=/);
  await expect(page.locator(".chip", { hasText: v! }).first()).toBeVisible();
});

test("judge-model caveat on version comparisons (v1.1 flash vs v1.2-rc pro)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "en");
  await page.goto("/quality/versions?range=7d&vdim=pipeline_version");
  const c = page.locator('[data-judge-caveat="direct"]');
  await expect(c).toBeVisible();
  await expect(c).toContainText("gemini-2.5-flash");
  await expect(c).toContainText("gemini-2.5-pro");
  await page.goto("/quality/versions?range=7d&vdim=pipeline_version&pipeline_version=v1.1");
  await expect(page.locator(".qd-vt")).toBeVisible();
  await expect(page.locator("[data-judge-caveat]")).toHaveCount(0); // one judge → no caveat
  await page.goto("/issues/report?range=7d");
  await expect(page.locator("#issb-regression [data-judge-caveat]")).toBeVisible();
});

test("/issues/modules renders the registry and the full feature × module matrix", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page, ADMIN, "ko");
  await page.goto("/issues/modules");
  for (const m of MODULE_IDS) await expect(page.locator(`article.mod-card#${m}`)).toBeVisible();
  const rows = page.locator(".mod-mx tbody tr:not(.grp) th.mod-mx-f code");
  await expect(rows).toHaveCount(FEATURE_IDS.length);
  expect(new Set(await rows.allInnerTexts())).toEqual(new Set(FEATURE_IDS));
  await expect(page.locator(".mod-docs a[href$='docs/analysis-modules.md']").first()).toBeVisible();
});
