import { defineConfig, devices } from "@playwright/test";

// Behavioural e2e for Monet Jouer. Drives the real app (a live Phaser game
// canvas + React UI) through the dev-only `window.__mj` hook, in headless
// Chrome (the installed channel — no browser download). Phaser renders with
// WebGL, so the ANGLE/SwiftShader flags give headless a software GL context.
//
// Two projects:
//  • chromium — the fast dev build (browser, no CSP) on :1423. Runs the whole
//    feature suite. Owns the export-run spec, which injects a local Phaser
//    <script> (inline, so it can't run under the desktop CSP).
//  • desktop  — the PRODUCTION bundle served by `vite preview` WITH the Tauri
//    desktop CSP applied (the macOS desktop build's real environment). Runs the
//    whole suite EXCEPT the inline-injection export-run spec, plus the CSP
//    smoke. Playwright can't drive Tauri's native WKWebView on macOS, so this
//    validates the shipping bundle + CSP in Chromium (native APIs degrade
//    gracefully, exactly as in the desktop app).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    headless: true,
    channel: "chrome",
    viewport: { width: 1600, height: 1000 },
    // No forced SwiftShader GL: headless Chrome gives Phaser a renderer on its
    // own (WebGL where available, else the Canvas fallback). The editor + probe
    // read game-object geometry, not pixels, so either renderer is fine — and
    // dropping the software-GL path avoids a slow GPU-process teardown.
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /desktop-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: "http://127.0.0.1:1423" },
    },
    {
      name: "desktop",
      testIgnore: /export-run\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: "http://127.0.0.1:1430" },
    },
  ],
  webServer: [
    {
      command: "pnpm dev",
      url: "http://127.0.0.1:1423",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm build:e2e && pnpm preview:e2e",
      url: "http://127.0.0.1:1430",
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
