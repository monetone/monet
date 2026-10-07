import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Sumi-e ────────────────────────────────
// Adobe: Sumi-e "paints an image in a Japanese style as if with a wet brush full of
// black ink on rice paper — soft, blurry edges with rich, jet-black inks." Vision
// adds a new engine filter (filter_sumi_e): a soft box blur (Stroke Width) gives the
// wet edges, Stroke Pressure deepens the shadows toward jet-black (concentrated in
// dark areas, sparing highlights), and Contrast steepens the tonal spread. pick_color
// reads back 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const red = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), [x, y] as const);

const meanR = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return s / (w * h);
  }, [w, h] as const);

// True if any pixel in the band [x0,x1) × full height is an intermediate gray.
const hasGray = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(([x0, x1, h]) => {
    const E = (window as any).__mv.engine.engine;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) {
      const v = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      if (v > 60 && v < 200) return true;
    }
    return false;
  }, [x0, x1, h] as const);

async function flat(page: Page, w: number, h: number, v: number) {
  await gotoApp(page);
  await page.evaluate(([w, h, v]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "sumi-e");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
  }, [w, h, v] as const);
}

// Left half black, right half white (vertical boundary at x=w/2).
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "sumi-e-split");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("stroke pressure inks the shadows toward black; it is undoable", async ({ page }) => {
  await flat(page, 40, 40, 60); // dark field
  const before = await meanR(page, 40, 40);
  expect(before).toBeCloseTo(60, 0);
  await page.evaluate(() => (window as any).__mv.fil.sumiE(0, 0.9, 0));
  expect(await meanR(page, 40, 40)).toBeLessThan(before - 10); // rich jet-black ink in the shadows
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await meanR(page, 40, 40)).toBeCloseTo(before, 0); // undo restores the field
});

test("the ink spares the highlights", async ({ page }) => {
  await flat(page, 40, 40, 230); // light field
  await page.evaluate(() => (window as any).__mv.fil.sumiE(0, 0.9, 0));
  expect(await meanR(page, 40, 40)).toBeGreaterThan(190); // highlights stay bright (ink concentrates in shadows)
});

test("contrast steepens the tonal spread", async ({ page }) => {
  await flat(page, 40, 40, 100); // below mid-gray
  await page.evaluate(() => (window as any).__mv.fil.sumiE(0, 0, 0.8));
  expect(await meanR(page, 40, 40)).toBeLessThan(100); // pushed darker
  await flat(page, 40, 40, 160); // above mid-gray
  await page.evaluate(() => (window as any).__mv.fil.sumiE(0, 0, 0.8));
  expect(await meanR(page, 40, 40)).toBeGreaterThan(160); // pushed lighter
});

test("stroke width softens the edge into wet gray", async ({ page }) => {
  await split(page, 40, 40);
  expect(await hasGray(page, 16, 24, 40)).toBe(false); // a hard edge has no gray
  await page.evaluate(() => (window as any).__mv.fil.sumiE(1, 0, 0)); // blur only
  expect(await hasGray(page, 16, 24, 40)).toBe(true);  // the wet blur mixes the boundary
  expect(await red(page, 4, 20)).toBe(0);              // far from the edge stays black
});

test("zero width, pressure and contrast is an identity", async ({ page }) => {
  await flat(page, 32, 32, 128);
  await page.evaluate(() => (window as any).__mv.fil.sumiE(0, 0, 0));
  expect(await meanR(page, 32, 32)).toBeCloseTo(128, 0);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 140);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [wd, pr, ct] of [[1, 0.9, 0.0], [0, 0.0, 1.0], [0.5, 0.5, 0.4]] as const) {
    await page.evaluate(([wd, pr, ct]) => (window as any).__mv.fil.sumiE(wd, pr, ct), [wd, pr, ct] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanR(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Sumi-e dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 128);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Sumi-e…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Sumi-e…")).run());
  await expect(page.getByText("Stroke Pressure")).toBeVisible();
});
