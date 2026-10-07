import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Texture ▸ Patchwork ───────────────────────────────────
// Adobe: Patchwork "breaks up an image into squares filled with the predominant
// colour... and randomly reduces or increases the tile depth to replicate the
// highlights and shadows." Vision adds an engine filter (filter_patchwork): each
// square cell → its average colour, plus a bevel relief (top-left raised/light,
// bottom-right recessed/dark, brighter cells raised more). pick_color is 0xRRGGBBAA.
//   https://helpx.adobe.com/photoshop-elements/using/texture-filters.html

const R = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), { x, y });

test("Patchwork quantizes into per-square average tiles, and is undoable", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "patchwork");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 12, 24, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(12, 0, 12, 24, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.patchwork(8, 0); // relief 0 → pure square averaging (squares 0-7 / 8-15 / 16-23)
    const r = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { left: r(2, 5), mid: r(10, 5), right: r(20, 5) };
  });
  expect(out.left).toBeLessThan(30); // the left square stays black
  expect(out.right).toBeGreaterThan(230); // the right square stays white
  expect(out.mid).toBeGreaterThan(100); expect(out.mid).toBeLessThan(160); // the straddling square reads the mid average
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await R(page, 2, 5)).toBe(0); // undo → black half solid black again
  expect(await R(page, 20, 5)).toBe(255); // undo → white half solid white again
});

test("Patchwork's Relief bevels each tile (top-left raised, bottom-right recessed)", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "patchwork-relief");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.patchwork(8, 1); // strong relief
    const r = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { tl: r(0, 0), br: r(7, 7) };
  });
  expect(out.tl).toBeGreaterThan(200); // the tile's top-left corner is raised/light
  expect(out.br).toBeLessThan(60); // the tile's bottom-right corner is recessed/dark
});

test("the Patchwork dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "patchwork-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Patchwork…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Patchwork…")).run());
  await expect(page.getByText("Square Size")).toBeVisible();
});
