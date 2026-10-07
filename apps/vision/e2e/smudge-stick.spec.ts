import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Smudge Stick ───────────────────────────────
// Adobe: Smudge Stick "softens an image using short diagonal strokes to smudge or
// smear the darker areas. Lighter areas become brighter and lose detail." Vision
// adds an engine filter (filter_smudge_stick): Stroke Length sets the diagonal
// smear radius, Highlight Area / Intensity brighten the light tones. pick_color
// reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const red = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), [x, y] as const);

// Mean red across the whole doc (0..255).
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
    mv.store.newDocument(w, h, "smudge-stick");
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
    mv.store.newDocument(w, h, "smudge-split");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("Intensity brightens light areas, and is undoable", async ({ page }) => {
  await flat(page, 48, 48, 200);
  const before = await meanRed(page, 48, 48);
  expect(before).toBeCloseTo(200, 0);
  await page.evaluate(() => (window as any).__mv.fil.smudgeStick(2, 20, 10));
  expect(await meanRed(page, 48, 48)).toBeGreaterThan(before + 5); // highlights lifted
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await meanRed(page, 48, 48)).toBeCloseTo(before, 0); // undo restores
});

test("higher Intensity brightens more", async ({ page }) => {
  await flat(page, 48, 48, 200);
  await page.evaluate(() => (window as any).__mv.fil.smudgeStick(2, 20, 2));
  const lo = await meanRed(page, 48, 48);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.smudgeStick(2, 20, 10));
  const hi = await meanRed(page, 48, 48);
  expect(hi).toBeGreaterThan(lo);
});

test("diagonal strokes smear a dark edge toward its light neighbours", async ({ page }) => {
  await split(page, 32, 32);
  expect(await red(page, 15, 16)).toBe(0); // dark side of the boundary
  await page.evaluate(() => (window as any).__mv.fil.smudgeStick(5, 0, 0)); // smear only
  expect(await red(page, 15, 16)).toBeGreaterThan(5); // took on light diagonal neighbours
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 160);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [sl, ha, it] of [[0, 20, 10], [10, 0, 0], [5, 10, 5]] as const) {
    await page.evaluate(([sl, ha, it]) => (window as any).__mv.fil.smudgeStick(sl, ha, it), [sl, ha, it] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanRed(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Smudge Stick dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 160);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Smudge Stick…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Smudge Stick…")).run());
  await expect(page.getByText("Highlight Area")).toBeVisible();
});
