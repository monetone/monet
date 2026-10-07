import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Underpainting ──────────────────────────────
// Adobe: Underpainting "paints the image on a textured background, and then
// paints the final image over it." Vision adds an engine filter
// (filter_underpainting) that builds a low-detail base by heavy box smoothing
// (Brush Size), then embosses a UNIFORM surface tooth (Texture / Scaling /
// Relief / Light) whose strength is Texture Coverage — uniform relief is the
// distinction from Rough Pastels, whose tooth deepens in the shadows. pick_color
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
    mv.store.newDocument(w, h, "underpainting");
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
    mv.store.newDocument(w, h, "underpainting-split");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("texture coverage adds relief, and is undoable", async ({ page }) => {
  await flat(page, 48, 48, 128);
  const before = await varianceRed(page, 48, 48);
  expect(before).toBeCloseTo(0, 1); // a flat field has no variance
  await page.evaluate(() => (window as any).__mv.fil.underpainting(0, 40, 0, 0.5, 0.5, 1));
  expect(await varianceRed(page, 48, 48)).toBeGreaterThan(1); // the surface tooth stamps a texture
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await varianceRed(page, 48, 48)).toBeCloseTo(before, 1); // undo restores the flat field
});

test("coverage=0 leaves a flat field essentially flat", async ({ page }) => {
  await flat(page, 48, 48, 128);
  await page.evaluate(() => (window as any).__mv.fil.underpainting(0, 0, 0, 0.5, 0.5, 1));
  expect(await varianceRed(page, 48, 48)).toBeLessThan(0.5); // no coverage → no tooth
});

test("the surface texture is uniform across tones", async ({ page }) => {
  await flat(page, 40, 40, 96); // dark field
  await page.evaluate(() => (window as any).__mv.fil.underpainting(0, 40, 0, 0.5, 0.5, 1));
  const dark = await varianceRed(page, 40, 40);
  await flat(page, 40, 40, 160); // lighter field
  await page.evaluate(() => (window as any).__mv.fil.underpainting(0, 40, 0, 0.5, 0.5, 1));
  const light = await varianceRed(page, 40, 40);
  expect(Math.abs(dark - light)).toBeLessThan(1); // uniform, unlike Rough Pastels' darkness-modulated tooth
});

test("a wider brush smooths the edge more", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.underpainting(4, 0, 0, 0.5, 0.0, 1)); // narrow brush
  const narrow = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.underpainting(40, 0, 0, 0.5, 0.0, 1)); // wide brush
  const wide = await red(page, 15, 16);
  expect(wide).toBeGreaterThan(narrow); // wider underpaint blends more of the light side across the edge
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 160);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [bs, tc, tx, sc, rl, li] of [[0, 40, 0, 0.5, 0.5, 1], [40, 0, 2, 1.0, 1.0, 4], [20, 20, 3, 0.2, 0.3, 6]] as const) {
    await page.evaluate(([bs, tc, tx, sc, rl, li]) => (window as any).__mv.fil.underpainting(bs, tc, tx, sc, rl, li), [bs, tc, tx, sc, rl, li] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanRed(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Underpainting dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 160);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Underpainting…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Underpainting…")).run());
  await expect(page.getByText("Texture Coverage")).toBeVisible();
});
