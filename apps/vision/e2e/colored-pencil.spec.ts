import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Colored Pencil ─────────────────────────────
// Adobe: Colored Pencil "draws an image using coloured pencils on a solid
// background" — flat/light areas take on the paper colour while edges and darker
// tones gain diagonal cross-hatch strokes. Vision adds an engine filter
// (filter_colored_pencil): Paper Brightness lightens flat areas toward white and
// Stroke Pressure darkens hatch strokes. pick_color reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

// Mean red across the whole doc (0..255).
const meanRed = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return s / (w * h);
  }, [w, h] as const);

async function flatGray(page: Page, w: number, h: number, v = 120) {
  await gotoApp(page);
  await page.evaluate(([w, h, v]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "colored-pencil");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
  }, [w, h, v] as const);
}

test("redraws a flat field (paper + strokes) and is undoable", async ({ page }) => {
  await flatGray(page, 48, 48);
  const before = await meanRed(page, 48, 48);
  expect(before).toBeCloseTo(120, 0); // flat gray
  await page.evaluate(() => (window as any).__mv.fil.coloredPencil(4, 8, 25));
  expect(Math.abs((await meanRed(page, 48, 48)) - before)).toBeGreaterThan(1); // the filter redraws it
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await meanRed(page, 48, 48)).toBeCloseTo(before, 0); // undo restores the gray
});

test("higher Paper Brightness lightens the result", async ({ page }) => {
  await flatGray(page, 48, 48);
  await page.evaluate(() => (window as any).__mv.fil.coloredPencil(4, 8, 0)); // no paper
  const lo = await meanRed(page, 48, 48);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.coloredPencil(4, 8, 50)); // full paper
  const hi = await meanRed(page, 48, 48);
  expect(hi).toBeGreaterThan(lo);
});

test("higher Stroke Pressure darkens the result", async ({ page }) => {
  await flatGray(page, 48, 48);
  await page.evaluate(() => (window as any).__mv.fil.coloredPencil(4, 0, 25)); // no strokes
  const lo = await meanRed(page, 48, 48);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.coloredPencil(4, 15, 25)); // heavy strokes
  const hi = await meanRed(page, 48, 48);
  expect(hi).toBeLessThan(lo);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flatGray(page, 40, 30);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [pw, sp, pb] of [[1, 15, 0], [24, 0, 50], [8, 8, 25]] as const) {
    await page.evaluate(([pw, sp, pb]) => (window as any).__mv.fil.coloredPencil(pw, sp, pb), [pw, sp, pb] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 }); // filter never resizes
    expect(await meanRed(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Colored Pencil dialog opens from the Filter menu", async ({ page }) => {
  await flatGray(page, 32, 32);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Colored Pencil…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Colored Pencil…")).run());
  await expect(page.getByText("Stroke Pressure")).toBeVisible();
});
