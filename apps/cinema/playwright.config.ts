import { defineConfig, devices } from "@playwright/test";

// E2E suite for Monet Cinema. Drives the real app (Rust/WASM compositor + React
// UI + WebCodecs/Web Audio decode) in headless Chrome against the vite dev
// server, exercising the editor through `window.__mc`. Video decode needs the
// ANGLE/SwiftShader GL flags + an autoplay exception (the live-playback decoder
// plays muted <video> elements). Uses system Chrome (`channel: "chrome"`) so no
// browser download is required.
export default defineConfig({
  testDir: "./e2e",
  // Build the wasm engine / Monet UI libs if a fresh checkout lacks them, so
  // `pnpm test:e2e` is self-contained (no-op when the artifacts already exist).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:1422",
    headless: true,
    channel: "chrome",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:1422",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
