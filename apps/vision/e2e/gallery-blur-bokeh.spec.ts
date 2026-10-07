import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Blur Gallery ▸ Effects ▸ Light Bokeh ──────────────────
// Adobe's Blur Gallery has an "Effects" tab whose Light Bokeh brightens
// defocused highlights into glowing bokeh discs. Vision's gallery blurs
// (Field/Iris/Tilt-Shift) gained a Light Bokeh param: the blur runs in a
// gamma-expanded space so bright points bloom (sqrt of averaged squares ≥ mean).
//   https://helpx.adobe.com/photoshop/using/blur-gallery.html
// pick_color packs 0xRRGGBBAA → red is (v >>> 24) & 255.

const meanR = (page: Page, pts: [number, number][]) =>
  page.evaluate((pts) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (const [x, y] of pts) s += (E.pick_color(x, y) >>> 24) & 255;
    return s / pts.length;
  }, pts);

// Opaque-black field with a bright 6×6 block in the centre (white by default).
async function brightSpot(page: Page, w: number, h: number, rgb: [number, number, number] = [255, 255, 255]) {
  await gotoApp(page);
  await page.evaluate(([w, h, r, g, b]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "bokeh");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2 - 3, h / 2 - 3, 6, 6, 0); E.fill_selection(r, g, b, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h, rgb[0], rgb[1], rgb[2]] as const);
}

// Mean red − green over the sampled points (colourfulness of a red bloom).
const gapRG = (page: Page, pts: [number, number][]) =>
  page.evaluate((pts) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (const [x, y] of pts) { const c = E.pick_color(x, y); s += ((c >>> 24) & 255) - ((c >>> 16) & 255); }
    return s / pts.length;
  }, pts);

// A ring of points just OUTSIDE the bright block, where the bloom lands.
const RING: [number, number][] = [[6, 12], [18, 12], [12, 6], [12, 18], [7, 7], [17, 17]];

test("Light Bokeh blooms the defocused highlights brighter than a plain blur", async ({ page }) => {
  await brightSpot(page, 24, 24);
  await page.evaluate(() => (window as any).__mv.fil.galleryBlur(0, 5, 1, 0)); // Field blur, no bokeh
  const plain = await meanR(page, RING);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.galleryBlur(0, 5, 1, 1)); // Field blur, full bokeh
  const bokeh = await meanR(page, RING);
  expect(bokeh).toBeGreaterThan(plain + 2); // the bloom is brighter
});

test("Bokeh Color saturates a coloured bloom (wider red−green gap)", async ({ page }) => {
  await brightSpot(page, 24, 24, [255, 0, 0]); // bright RED spot
  await page.evaluate(() => (window as any).__mv.fil.galleryBlur(0, 5, 1, 1, 0)); // bokeh, no colour
  const plain = await gapRG(page, RING);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.galleryBlur(0, 5, 1, 1, 1)); // bokeh + full colour
  const colored = await gapRG(page, RING);
  expect(colored).toBeGreaterThan(plain + 1); // the bloom keeps more of its hue
});

test("zero Light Bokeh matches the plain gallery blur (back-compat)", async ({ page }) => {
  await brightSpot(page, 24, 24);
  await page.evaluate(() => (window as any).__mv.fil.galleryBlur(0, 5, 1)); // 3-arg legacy call → bokeh defaults 0
  const legacy = await meanR(page, RING);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.galleryBlur(0, 5, 1, 0)); // explicit 0
  const zero = await meanR(page, RING);
  expect(Math.abs(zero - legacy)).toBeLessThan(0.5); // identical
});

test("the Iris Blur dialog exposes a Light Bokeh control", async ({ page }) => {
  await brightSpot(page, 32, 32);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Iris Blur…")),
    null, { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Iris Blur…")).run());
  await expect(page.getByText("Light Bokeh")).toBeVisible();
  await expect(page.getByText("Bokeh Color")).toBeVisible();
});
