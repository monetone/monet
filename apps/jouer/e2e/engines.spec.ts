import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The multi-engine system: install Phaser builds (local catalog or downloaded
// from jsDelivr) and run the current project's animation in any of them. The
// jsDelivr endpoints are routed to a local build so the suite stays offline +
// deterministic (and proves the download/cache/blob-load path works, including
// under the desktop CSP that allows `script-src 'self' blob:` + jsDelivr in
// connect-src).

const ANIMATED = {
  name: "engine-test", width: 400, height: 300,
  scenes: [{ id: "s", key: "Main", name: "Main",
    objects: [{ id: "rect", kind: "rectangle", name: "mover", width: 30, height: 30, transform: { x: 0, y: 150 } }],
    timelines: [{ id: "tl", name: "T", duration: 1, autoplay: true, loop: true, tracks: [
      { id: "t", targetId: "rect", property: "x", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 300, ease: "linear" }] },
    ] }], activeTimelineId: "tl" }],
  activeSceneId: "s",
};

async function runInEngine(page: import("@playwright/test").Page, version: string): Promise<string> {
  return page.evaluate(async ({ version, raw }) => {
    const mj = (window as any).__mj;
    const project = mj.jouer.normalizeProject(raw);
    const ns = await mj.engines.installEngine(version);
    const host = document.createElement("div");
    host.style.cssText = "width:400px;height:300px;position:fixed;left:-9999px;top:0";
    document.body.appendChild(host);
    (window as any).__pgHost = host;
    (window as any).__pg = mj.player.createPlayerGame(ns, host, project);
    return mj.engines.engineVersion(ns);
  }, { version, raw: ANIMATED });
}

async function waitRect(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const sc = (window as any).__pg?.game?.scene?.scenes?.[0];
    return !!sc && sc.children?.list?.some((o: any) => o.type === "Rectangle");
  }, null, { timeout: 10_000 });
}
async function readRectX(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => (window as any).__pg.game.scene.scenes[0].children.list.find((o: any) => o.type === "Rectangle").x as number);
}
async function teardown(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => { try { (window as any).__pg?.destroy(); (window as any).__pgHost?.remove(); } catch { /* */ } });
}

test.beforeEach(async ({ page }) => {
  // Route the jsDelivr registry + CDN to a local Phaser build (offline + fast).
  await page.route("**/data.jsdelivr.com/**", (r) =>
    r.fulfill({ json: { versions: [{ version: "4.1.0" }, { version: "4.0.0" }, { version: "3.90.0" }, { version: "3.85.0" }, { version: "3.80.1" }] } }));
  await page.route("**/cdn.jsdelivr.net/**", (r) =>
    r.fulfill({ path: "public/engines/phaser-3.90.0.min.js", contentType: "application/javascript" }));
  await gotoApp(page);
});

test("the bundled engine is installed and reports its version", async ({ page }) => {
  const info = await page.evaluate(() => {
    const snap = (window as any).__mj.engines.enginesStore.getSnapshot();
    return { active: snap.active, bundled: snap.engines.find((e: any) => e.source === "bundled")?.status, count: snap.engines.length };
  });
  expect(info.bundled).toBe("installed");
  expect(info.count).toBeGreaterThanOrEqual(3);
  expect(info.active).toMatch(/^\d+\.\d+/);
});

test("installs a local-catalog engine (3.90.0) and runs the animation in it", async ({ page }) => {
  const version = await runInEngine(page, "3.90.0");
  expect(version).toBe("3.90.0");
  await waitRect(page);
  const x0 = await readRectX(page);
  await page.waitForTimeout(350);
  const x1 = await readRectX(page);
  await teardown(page);
  expect(x1).toBeGreaterThan(x0);
  expect(x1).toBeGreaterThan(30);
});

test("downloads + caches a CDN engine version and runs the project in it", async ({ page }) => {
  const version = await runInEngine(page, "3.85.0"); // not bundled, not local → CDN download
  expect(typeof version).toBe("string");
  await waitRect(page);
  const x0 = await readRectX(page);
  await page.waitForTimeout(350);
  const x1 = await readRectX(page);
  await teardown(page);
  expect(x1).toBeGreaterThan(x0); // the downloaded engine's own tween moved it
  const installed = await page.evaluate(() =>
    (window as any).__mj.engines.enginesStore.getSnapshot().engines.some((e: any) => e.version === "3.85.0" && e.status === "installed"));
  expect(installed).toBe(true);
});

test("a cached engine can be uninstalled", async ({ page }) => {
  await page.evaluate(() => (window as any).__mj.engines.installEngine("3.85.0"));
  await page.waitForFunction(() => (window as any).__mj.engines.isInstalled("3.85.0"));
  await page.evaluate(() => (window as any).__mj.engines.removeEngine("3.85.0"));
  const stillThere = await page.evaluate(() =>
    (window as any).__mj.engines.enginesStore.getSnapshot().engines.some((e: any) => e.version === "3.85.0"));
  expect(stillThere).toBe(false);
});

test("the install UI downloads a custom version and lists it as installed", async ({ page }) => {
  await page.getByPlaceholder(/type a version/i).fill("3.80.1");
  await page.getByRole("button", { name: "Get" }).click();
  await expect(page.locator('[data-engine="3.80.1"]')).toContainText(/installed/i, { timeout: 15_000 });
});

test("the Engines panel runs a build and shows a live preview canvas", async ({ page }) => {
  const row = page.locator('[data-engine="3.90.0"]');
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Install" }).click();
  await expect(row).toContainText(/installed/i, { timeout: 15_000 });
  await row.getByRole("button", { name: "Run" }).click();
  await expect(page.locator('[data-mj="engine-preview"] canvas')).toBeVisible({ timeout: 10_000 });
});
