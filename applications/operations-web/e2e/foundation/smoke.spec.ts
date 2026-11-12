import { expect, test } from "@playwright/test";

test("landing renders live KPIs and loads the shared fonts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("관제 콘셉트");
  await expect(page.locator(".lp-chip[data-state='open']")).toBeVisible({ timeout: 10_000 });
  const ok = await page.evaluate(async () => {
    const fams = ["--font-pretendard", "--font-atlas-sans", "--font-lanes-display", "--font-flowline-mono", "--font-atlas-mono", "--font-lanes-mono"];
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, boolean> = {};
    for (const v of fams) {
      const fam = cs.getPropertyValue(v).split(",")[0].trim();
      await document.fonts.load(`600 16px ${fam}`, "한글 Aa");
      out[v] = document.fonts.check(`600 16px ${fam}`, "한글 Aa");
    }
    return out;
  });
  expect(Object.values(ok).every(Boolean)).toBe(true);
});

test("API: overview + CSV headers", async ({ request }) => {
  const ov = await request.get("/api/v1/overview");
  expect(ov.ok()).toBe(true);
  const csv = await request.get("/api/v1/results/csv?language=ko");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const body = await csv.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});
