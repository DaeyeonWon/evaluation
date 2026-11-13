import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke: every console route renders in ko and en with no console errors, roles are enforced
 * (Viewer gets 403 on /hermes and on write APIs), and the shared fonts load.
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
    for (const route of ROUTES) {
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
