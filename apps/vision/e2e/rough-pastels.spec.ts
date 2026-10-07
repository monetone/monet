import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Rough Pastels ──────────────────────────────
// Adobe: Rough Pastels "makes strokes of pastel chalk on a textured background.
// In areas of bright color, the chalk appears thick with little texture; in
// darker areas the chalk appears scraped off to reveal the texture." Vision adds
// an engine filter (filter_rough_pastels) that smears a diagonal chalk stroke
// (Stroke Length), then embosses a relief surface (Texture/Scaling/Relief/Light)
// scaled by local darkness — so the tooth shows through the shadows. pick_color
// reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const red = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), [x, y] as const);

const varianceRed = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const E = (window as any).__mv.engine.engine;
    const v: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v.push(((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length;
  }, [w, h] as const);

const meanRed = (page: Page, w: number, h: number) =>
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
    mv.store.newDocument(w, h, "rough-pastels");
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
    mv.store.newDocument(w, h, "rough-pastels-split");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("relief adds texture to a flat field, and is undoable", async ({ page }) => {
  await flat(page, 48, 48, 128);
  const before = await varianceRed(page, 48, 48);
  expect(before).toBeCloseTo(0, 1); // a flat field has no variance
  await page.evaluate(() => (window as any).__mv.fil.roughPastels(0, 0, 0.5, 0.5, 1));
  expect(await varianceRed(page, 48, 48)).toBeGreaterThan(1); // relief stamps a surface tooth
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await varianceRed(page, 48, 48)).toBeCloseTo(before, 1); // undo restores the flat field
});

test("relief=0 leaves a flat field essentially flat", async ({ page }) => {
  await flat(page, 48, 48, 128);
  await page.evaluate(() => (window as any).__mv.fil.roughPastels(0, 0, 0.5, 0.0, 1));
  expect(await varianceRed(page, 48, 48)).toBeLessThan(0.5); // no relief → no tooth
});

test("the chalk tooth shows through darker areas more than bright ones", async ({ page }) => {
  await flat(page, 40, 40, 60); // dark field
  await page.evaluate(() => (window as any).__mv.fil.roughPastels(0, 0, 0.5, 0.5, 1));
  const dark = await varianceRed(page, 40, 40);
  await flat(page, 40, 40, 210); // bright field
  await page.evaluate(() => (window as any).__mv.fil.roughPastels(0, 0, 0.5, 0.5, 1));
  const bright = await varianceRed(page, 40, 40);
  expect(dark).toBeGreaterThan(bright); // shadows reveal more texture
});

test("a longer stroke smears the edge", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.roughPastels(0, 0, 0.5, 0.0, 1)); // no stroke → sharp edge
  const none = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.roughPastels(40, 0, 0.5, 0.0, 1)); // long stroke → smear white in
  const long = await red(page, 15, 16);
  expect(long).toBeGreaterThan(none); // the diagonal chalk drags brightness across the boundary
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 160);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [sl, tx, sc, rl, li] of [[0, 0, 0.5, 0.5, 1], [40, 2, 1.0, 1.0, 4], [20, 3, 0.2, 0.3, 6]] as const) {
    await page.evaluate(([sl, tx, sc, rl, li]) => (window as any).__mv.fil.roughPastels(sl, tx, sc, rl, li), [sl, tx, sc, rl, li] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanRed(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Rough Pastels dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 160);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Rough Pastels…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Rough Pastels…")).run());
  await expect(page.getByText("Relief")).toBeVisible();
});
