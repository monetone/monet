import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Sprayed Strokes ───────────────────────
// Adobe: Sprayed Strokes "repaints an image using its dominant colors with angled,
// sprayed strokes of color." Vision adds a new engine filter (filter_sprayed_strokes):
// each pixel resamples from a hash-jittered offset that streaks ALONG the chosen
// direction (±Stroke Length) with a perpendicular spray (±Spray Radius). The scatter
// is anisotropic — a vertical boundary smears under horizontal strokes but stays crisp
// under vertical strokes. pick_color reads back 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

// Max/min red over a rectangular band [x0,x1) × full height.
const maxR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(([x0, x1, h]) => {
    const E = (window as any).__mv.engine.engine;
    let m = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m = Math.max(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, [x0, x1, h] as const);

const minR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(([x0, x1, h]) => {
    const E = (window as any).__mv.engine.engine;
    let m = 255;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m = Math.min(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, [x0, x1, h] as const);

// Left half black, right half white (vertical boundary at x=w/2).
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "sprayed-strokes");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("horizontal strokes smear the vertical boundary; it is undoable", async ({ page }) => {
  await split(page, 40, 40);
  expect(await maxR(page, 13, 20, 40)).toBe(0); // black band starts pure black
  await page.evaluate(() => (window as any).__mv.fil.sprayedStrokes(20, 0, 1)); // horizontal
  expect(await maxR(page, 13, 20, 40)).toBeGreaterThan(150); // white dragged into the black side
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await maxR(page, 13, 20, 40)).toBe(0); // undo restores the crisp boundary
});

test("vertical strokes keep the vertical boundary crisp", async ({ page }) => {
  await split(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.sprayedStrokes(20, 0, 3)); // vertical, no spray
  expect(await maxR(page, 0, 20, 40)).toBe(0);   // every black column stays black
  expect(await minR(page, 20, 40, 40)).toBe(255); // every white column stays white
});

test("the spray radius bleeds across the boundary", async ({ page }) => {
  await split(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.sprayedStrokes(0, 10, 3)); // vertical, radius only
  expect(await maxR(page, 13, 20, 40)).toBeGreaterThan(150); // perpendicular spray crosses the boundary
});

test("zero length and zero radius is an identity", async ({ page }) => {
  await split(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.sprayedStrokes(0, 0, 1));
  expect(await maxR(page, 0, 20, 40)).toBe(0);
  expect(await minR(page, 20, 40, 40)).toBe(255);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await split(page, 40, 30);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [len, rad, dir] of [[20, 0, 1], [0, 25, 3], [10, 8, 2]] as const) {
    await page.evaluate(([len, rad, dir]) => (window as any).__mv.fil.sprayedStrokes(len, rad, dir), [len, rad, dir] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await maxR(page, 0, 40, 30)).toBeLessThanOrEqual(255);
  }
});

test("the Sprayed Strokes dialog opens from the Filter menu", async ({ page }) => {
  await split(page, 32, 32);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Sprayed Strokes…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Sprayed Strokes…")).run());
  await expect(page.getByText("Stroke Direction")).toBeVisible();
});
