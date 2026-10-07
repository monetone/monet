import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// ── Photoshop Filter ▸ Render ▸ Lighting Effects ───────────────────
// Adobe: lights the layer with configurable light(s) over a texture/relief.
// Vision wires a single point light over a luminance-bump surface to the engine
// op filter_lighting_effects.
//   https://helpx.adobe.com/photoshop/using/adding-lighting-effects.html

type Opts = { x: number; y: number; height: number; intensity: number; ambient: number; bump: number; color: { r: number; g: number; b: number }; lightType?: number };
const WHITE = { r: 255, g: 255, b: 255 };

/** Flat-gray fill, then light it; returns the red channel at centre vs a corner. */
async function litGray(page: Page, o: Opts) {
  return page.evaluate((opts) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.lightingEffects(opts);
    // pick_color packs 0xRRGGBBAA, so the red channel is bits 24..31.
    const red = (x: number, y: number) => (E.pick_color(x, y) >>> 24) & 255;
    return { center: red(E.width() >> 1, E.height() >> 1), corner: red(2, 2), w: E.width(), h: E.height() };
  }, o);
}

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page, 160, 120); });

test("lighting effects change the composite and preserve dimensions", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.fil.lightingEffects({ x: 50, y: 50, height: 60, intensity: 1.5, ambient: 0.2, bump: 1, color: { r: 255, g: 255, b: 255 } }));
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
  expect(after.w).toBe(160); expect(after.h).toBe(120);
});

test("a centred point light makes the centre brighter than the corners", async ({ page }) => {
  const r = await litGray(page, { x: 50, y: 50, height: 60, intensity: 1.5, ambient: 0.2, bump: 1, color: WHITE });
  expect(r.center).toBeGreaterThan(r.corner + 20); // head-on centre vs grazed corner
  expect(r.center).toBeGreaterThan(180); // ~128·(0.2+1.5) clamped
});

test("a coloured light tints the result (green light drops the red channel)", async ({ page }) => {
  const white = await litGray(page, { x: 50, y: 50, height: 60, intensity: 1.5, ambient: 0.2, bump: 1, color: WHITE });
  const green = await litGray(page, { x: 50, y: 50, height: 60, intensity: 1.5, ambient: 0.2, bump: 1, color: { r: 0, g: 255, b: 0 } });
  expect(green.center).toBeLessThan(white.center); // green light contributes no red
});

test("successive lights from different positions each change the composite (soak)", async ({ page }) => {
  let prev = (await composite(page)).chk;
  for (const x of [20, 80, 50]) {
    await page.evaluate((lx) => (window as any).__mv.fil.lightingEffects({ x: lx, y: 40, height: 50, intensity: 1.4, ambient: 0.25, bump: 1.5, color: { r: 255, g: 255, b: 255 } }), x);
    const c = await composite(page);
    expect(c.w).toBe(160); expect(c.h).toBe(120);
    expect(c.chk).not.toBe(prev);
    prev = c.chk;
  }
});

// ── Light Type: an Infinite light is uniform where a Point light falls off ──
test("an infinite light lights a flat plane evenly, a point light does not", async ({ page }) => {
  const point = await litGray(page, { x: 50, y: 50, height: 60, intensity: 1.2, ambient: 0.2, bump: 0, color: WHITE, lightType: 0 });
  const inf = await litGray(page, { x: 50, y: 50, height: 60, intensity: 1.2, ambient: 0.2, bump: 0, color: WHITE, lightType: 2 });
  expect(point.center).toBeGreaterThan(point.corner + 10); // point falls off toward the corner
  expect(Math.abs(inf.center - inf.corner)).toBeLessThanOrEqual(2); // infinite is uniform
});

// ── Light Type: a Spot light confines the light to a cone ──────────
test("a spot light confines the light to a cone", async ({ page }) => {
  const point = await litGray(page, { x: 50, y: 50, height: 30, intensity: 1.2, ambient: 0.2, bump: 0, color: WHITE, lightType: 0 });
  const spot = await litGray(page, { x: 50, y: 50, height: 30, intensity: 1.2, ambient: 0.2, bump: 0, color: WHITE, lightType: 1 });
  expect(spot.center).toBeGreaterThan(150); // lit under the light
  expect(spot.corner).toBeLessThan(point.corner - 10); // the cone darkens the far corner
});

// ── UI: the Lighting Effects dialog exposes the Light Type control ──
test("the Lighting Effects dialog exposes the Light Type control", async ({ page }) => {
  const opened = await page.evaluate(() => {
    const items = (window as any).__mv.commandPalette.items as Array<{ label: string; run: () => void }>;
    const it = items.find((i) => typeof i.label === "string" && i.label.endsWith("Lighting Effects…"));
    if (!it) return false;
    it.run();
    return true;
  });
  expect(opened).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Light Type", { exact: true }).first()).toBeVisible(); // the new control
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
});
