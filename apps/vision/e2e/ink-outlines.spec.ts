import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Ink Outlines ──────────────────────────
// Adobe: Ink Outlines "redraws an image with fine narrow lines over the original
// details, in a pen-and-ink style." Vision adds an engine filter (filter_ink_outlines):
// Sobel edges are inked toward black (Dark Intensity) over the kept image, while the
// flat areas brighten toward white (Light Intensity) — distinct from Accented Edges,
// which only replaces edges. pick_color packs 0xRRGGBBAA (R>>24).
//   https://helpx.adobe.com/photoshop-elements/using/brush-stroke-filters.html

// min R over a band [x0,x1) × [0,h)
const bandMinR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(({ x0, x1, h }) => {
    const E = (window as any).__mv.engine.engine;
    let m = 255;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m = Math.min(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, { x0, x1, h });
const R = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), { x, y });

async function splitDoc(page: Page, name: string) {
  await page.evaluate((name) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, name);
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 32, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(16, 0, 16, 32, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
  }, name);
}

test("Ink Outlines inks the edge dark while interiors stay, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await splitDoc(page, "ink");
  await page.evaluate(() => (window as any).__mv.fil.inkOutlines(0.5, 1, 0)); // dark ink, no light
  expect(await bandMinR(page, 14, 18, 32)).toBeLessThan(30); // the boundary is inked dark
  expect(await R(page, 2, 16)).toBe(0); // far black interior stays
  expect(await R(page, 30, 16)).toBe(255); // far white interior stays
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await R(page, 2, 16)).toBe(0); expect(await R(page, 30, 16)).toBe(255); // undo → split restored
  // and the boundary band is solid black|white again (no ink)
  expect(await bandMinR(page, 0, 16, 32)).toBe(0); // left half solid black
});

test("Ink Outlines' Light Intensity brightens the flat areas", async ({ page }) => {
  await gotoApp(page);
  const bright = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "ink-light");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(120, 120, 120, 255); E.select_none();
    mv.engine.commit();
    mv.fil.inkOutlines(0.5, 0, 1); // full light, no dark
    return ((E.pick_color(12, 12) >>> 0) >>> 24) & 255;
  });
  expect(bright).toBeGreaterThan(230); // the open areas brighten toward white
});

test("the Ink Outlines dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "ink-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Ink Outlines…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Ink Outlines…")).run());
  await expect(page.getByText("Dark Intensity")).toBeVisible();
});
