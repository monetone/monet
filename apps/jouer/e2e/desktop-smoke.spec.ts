import { test, expect } from "@playwright/test";
import { near, tick } from "./helpers";

// ── Desktop build smoke (macOS) ────────────────────────────────
// Runs ONLY in the "desktop" Playwright project: the PRODUCTION bundle served
// by `vite preview` with the SAME Content-Security-Policy the Tauri desktop app
// ships (see playwright.config + vite previewCsp). Playwright can't drive
// Tauri's native WKWebView on macOS, so this is the closest faithful check —
// it proves the shipping bundle + CSP boot the live Phaser editor, that
// animations run under the CSP (WebGL canvas + tweens), and that nothing trips
// a CSP violation.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__MJ_RENDERER = "CANVAS"; // clean headless teardown (see helpers.ts)
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const v = e as SecurityPolicyViolationEvent;
      (window as any).__csp.push(`${v.violatedDirective} <- ${v.blockedURI}`);
    });
  });
});

async function bootCsp(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__mj?.store?.state?.ready === true && typeof (window as any).__mj?.probe === "function", null, { timeout: 30_000 });
  await page.waitForSelector(".mj-stage canvas", { timeout: 30_000 });
}

test("the preview serves the Tauri desktop CSP", async ({ page }) => {
  const resp = await page.goto("/");
  const csp = resp?.headers()["content-security-policy"];
  expect(csp, "preview must serve a Content-Security-Policy header").toBeTruthy();
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("img-src");
  // Engine-install grants: blob: scripts (cached builds) + jsDelivr fetch.
  expect(csp).toContain("script-src 'self' blob:");
  expect(csp).toContain("https://cdn.jsdelivr.net");
});

test("the production bundle boots a live Phaser editor under the CSP", async ({ page }) => {
  await bootCsp(page);
  const w = await page.evaluate(() => (document.querySelector(".mj-stage canvas") as HTMLCanvasElement).clientWidth);
  expect(w).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__mj.store.getProject().schema)).toBe("monet-jouer/v1");
});

test("animations run under the CSP (WebGL canvas + sampled tween)", async ({ page }) => {
  await bootCsp(page);
  await page.evaluate(() => {
    const { jouer, store } = (window as any).__mj;
    const raw = { name: "d", scenes: [{ id: "s", key: "S", name: "S", objects: [{ id: "rect", kind: "rectangle", name: "rect", width: 20, height: 20, transform: { x: 0, y: 50 } }], timelines: [{ id: "tl", name: "M", duration: 1, tracks: [{ id: "t", targetId: "rect", property: "x", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 300, ease: "linear" }] }] }], activeTimelineId: "tl" }], activeSceneId: "s" };
    store.replaceProject(jouer.normalizeProject(raw), { dirty: false });
  });
  await page.waitForFunction(() => (window as any).__mj.probe("rect") !== null, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__mj.store.setPlayhead(0.5));
  await tick(page);
  const x = await page.evaluate(() => (window as any).__mj.probe("rect").x);
  near(x, 150, 1);
});

test("no CSP violations were recorded across the smoke run", async ({ page }) => {
  await bootCsp(page);
  await page.evaluate(() => {
    const { cmd } = (window as any).__mj;
    cmd.addObject("sprite");
    cmd.addObject("text", { patch: { text: "csp" } });
    cmd.addObject("ellipse");
  });
  await tick(page);
  const violations = await page.evaluate(() => (window as any).__csp ?? []);
  expect(violations).toEqual([]);
});
