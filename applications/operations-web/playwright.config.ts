import { defineConfig, devices } from "@playwright/test";

/**
 * Shared Playwright config. Specs live in e2e/<variant>/*.spec.ts (each variant owns its folder).
 * Point it at a running server:  PW_BASE_URL=http://localhost:3101 npx playwright test e2e/flowline
 * (default http://localhost:3100 = `npm run build && npx next start -p 3100`).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL || "http://localhost:3100",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
