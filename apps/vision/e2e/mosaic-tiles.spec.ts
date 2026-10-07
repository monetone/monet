import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Texture ▸ Mosaic Tiles ────────────────────────────────
// Adobe: Mosaic Tiles "draws the image as if it were made up of small chips or
// tiles and adds grout between the tiles." Vision adds an engine filter
// (filter_mosaic_tiles): the image shows through a regular tile grid while
// grayscale grout lines sit on the grid (dark by default, light via Lighten
// Grout). pick_color packs 0xRRGGBBAA (R>>24).
//   https://helpx.adobe.com/photoshop-elements/using/texture-filters.html

test("Mosaic Tiles lays dark grout lines on the grid while tiles keep the colour, and is undoable", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "mosaictiles");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.mosaicTiles(8, 2, 0); // dark grout
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { interior: R(4, 4), groutV: R(0, 4), groutH: R(4, 0), groutNext: R(8, 4) };
  });
  expect(Math.abs(out.interior - 128)).toBeLessThanOrEqual(12); // tile interior keeps the colour
  expect(out.groutV).toBeLessThan(60); // the left grout line is dark
  expect(out.groutH).toBeLessThan(60); // the top grout line is dark
  expect(out.groutNext).toBeLessThan(60); // the next grid line is dark too
  const back = await page.evaluate(() => {
    const mv = (window as any).__mv; mv.store.undo();
    return ((mv.engine.engine.pick_color(0, 4) >>> 0) >>> 24) & 255;
  });
  expect(back).toBe(128); // undo restores the flat field
});

test("Mosaic Tiles can lighten the grout", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "mosaictiles-light");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.mosaicTiles(8, 2, 1); // white grout
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { grout: R(0, 4), interior: R(4, 4) };
  });
  expect(out.grout).toBeGreaterThan(200); // the grout line is light, not dark
  expect(Math.abs(out.interior - 128)).toBeLessThanOrEqual(12); // the tile interior still keeps the colour
});

test("the Mosaic Tiles dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "mosaictiles-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Mosaic Tiles…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Mosaic Tiles…")).run());
  await expect(page.getByText("Lighten Grout")).toBeVisible();
});
