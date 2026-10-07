import { defineConfig, devices } from "@playwright/test";

// E2E suite for Monet Vision. Drives the real app (Rust/WASM engine +
// React UI + onnxruntime-web) in Playwright's version-matched Chromium. WebGL/MediaRecorder
// need the ANGLE/SwiftShader flags; ML specs load real ONNX models so
// they get a longer per-test timeout (set inside the spec).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    },
    trace: "retain-on-failure",
  },
  projects: [
    // The fast dev-server build (browser, no CSP). Runs the whole suite except
    // the desktop smoke (which is meaningless without the CSP).
    {
      name: "chromium",
      testIgnore: /(?:desktop-smoke|system-font-faces)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:1420" },
    },
    // A bounded parity lane for the engine and shared keyboard/ARIA contracts
    // on WebKit, the browser family used by Tauri's macOS webview.
    // system-font-faces reads /System/Library/Fonts, so only macOS runs it.
    {
      name: "webkit",
      testMatch: /(?:webkit-smoke|layer-drag-out|system-font-faces)\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        baseURL: "http://127.0.0.1:1420",
        launchOptions: { args: [] },
      },
    },
    // The production bundle served by `vite preview` WITH the Tauri desktop
    // CSP applied — exercises what actually ships. (Playwright can't drive the
    // native WKWebView on macOS, so this validates the prod build + CSP in
    // Chromium; native Tauri APIs degrade gracefully, as in the dev build.)
    {
      name: "desktop",
      testMatch: /desktop-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:1430" },
    },
  ],
  webServer: [
    {
      command: "pnpm dev",
      url: "http://127.0.0.1:1420",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm build:e2e && pnpm preview:e2e",
      url: "http://127.0.0.1:1430",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
