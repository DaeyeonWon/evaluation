import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config. Specs live in e2e/<area>/*.spec.ts (currently e2e/smoke).
 *
 *   npm run test:e2e                         starts `next dev` on :3100 (dist dir .next-e2e, so it can
 *                                            run next to your own `npm run dev`) and reuses one that
 *                                            is already listening there
 *   PW_BASE_URL=http://localhost:3000 npm run test:e2e
 *                                            test a server you started yourself (e.g. `npm run build
 *                                            && npx next start -p 3000`); no webServer is launched
 */
const PORT = Number(process.env.PW_PORT || 3100);
const external = process.env.PW_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // one dev server compiling routes on first hit; parallel workers just contend
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: external || `http://localhost:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  webServer: external
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        env: { NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" },
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
