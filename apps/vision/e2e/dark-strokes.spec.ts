import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Dark Strokes ──────────────────────────
// Adobe: Dark Strokes "paints dark areas of an image with short, tight, dark
// strokes, and lighter areas with long, white strokes." Vision adds a new engine
// filter (filter_dark_strokes): each pixel is smeared along the (1,1) diagonal —
// a short stroke in the dark zone, a long stroke in the light zone — then pushed
// toward black (shadows) or white (highlights). Balance shifts the tonal split.
// pick_color reads back 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const meanR = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return s / (w * h);
  }, [w, h] as const);

async function flat(page: Page, w: number, h: number, v: number) {
  await gotoApp(page);
  await page.evaluate(([w, h, v]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "dark-strokes");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
  }, [w, h, v] as const);
}

test("black intensity darkens the shadows; it is undoable", async ({ page }) => {
  await flat(page, 40, 40, 60); // dark field
  const before = await meanR(page, 40, 40);
  expect(before).toBeCloseTo(60, 0);
  await page.evaluate(() => (window as any).__mv.fil.darkStrokes(0.5, 0.8, 0.0));
  expect(await meanR(page, 40, 40)).toBeLessThan(before - 10); // shadows pushed toward black
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await meanR(page, 40, 40)).toBeCloseTo(before, 0); // undo restores the field
});

test("white intensity brightens the highlights", async ({ page }) => {
  await flat(page, 40, 40, 200); // light field
  const before = await meanR(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.darkStrokes(0.5, 0.0, 0.8));
  expect(await meanR(page, 40, 40)).toBeGreaterThan(before + 10); // highlights pushed toward white
});

test("Balance shifts the dark/light split", async ({ page }) => {
  await flat(page, 40, 40, 128); // midtone ≈ 0.502 luma
  await page.evaluate(() => (window as any).__mv.fil.darkStrokes(0.4, 0.8, 0.8)); // low balance → light zone → brighten
  const low = await meanR(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.darkStrokes(0.7, 0.8, 0.8)); // high balance → dark zone → darken
  const high = await meanR(page, 40, 40);
  expect(low).toBeGreaterThan(128);
  expect(high).toBeLessThan(128);
});

test("zero black and zero white is an identity", async ({ page }) => {
  await flat(page, 32, 32, 128);
  await page.evaluate(() => (window as any).__mv.fil.darkStrokes(0.5, 0.0, 0.0));
  expect(await meanR(page, 32, 32)).toBeCloseTo(128, 0); // no push → unchanged
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 140);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [ba, bl, wh] of [[0.5, 0.8, 0.0], [0.7, 0.9, 0.9], [0.3, 0.2, 0.5]] as const) {
    await page.evaluate(([ba, bl, wh]) => (window as any).__mv.fil.darkStrokes(ba, bl, wh), [ba, bl, wh] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanR(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Dark Strokes dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 128);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Dark Strokes…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Dark Strokes…")).run());
  await expect(page.getByText("Black Intensity")).toBeVisible();
});
