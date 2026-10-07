import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Edit ▸ Transform ▸ Warp (preset envelope styles) ───────────────
// Adobe: Transform ▸ Warp deforms a layer with a preset style (Arc/Bulge/Flag/…)
// + Bend; content pushed off-canvas is clipped (transparent). Vision reuses the
// Text-Warp forward map (warpPoint) to build the engine mesh_warp destination grid.
// An Arc with positive bend bows the content UP, so the bottom edge vacates.
//   https://helpx.adobe.com/photoshop/using/warping-image.html

const alpha = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) & 255, { x, y });
const rgb = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => { const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255 }; }, { x, y });

async function redDoc(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "warp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 0, 0, 255); // solid opaque red
    E.select_none();
    mv.engine.commit();
  });
}

test("an Arc warp bows the content up — the bottom vacates, the centre stays", async ({ page }) => {
  await gotoApp(page);
  await redDoc(page);
  expect(await alpha(page, 20, 39)).toBe(255); // bottom starts opaque
  await page.evaluate(() => (window as any).__mv.warpLayer({ style: "arc", bend: 0.4, h: 0, v: 0, orient: "h" }));
  expect(await alpha(page, 20, 39)).toBeLessThan(128); // content bowed up → bottom is now transparent
  const c = await rgb(page, 20, 20);
  expect(c.r).toBeGreaterThan(c.g); // the centre is still red content
  expect(await alpha(page, 20, 20)).toBeGreaterThan(128);
});

test("the warp is undoable", async ({ page }) => {
  await gotoApp(page);
  await redDoc(page);
  await page.evaluate(() => (window as any).__mv.warpLayer({ style: "arc", bend: 0.4, h: 0, v: 0, orient: "h" }));
  expect(await alpha(page, 20, 39)).toBeLessThan(128);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await alpha(page, 20, 39)).toBe(255); // undo restores the bottom to opaque red
});

test("the Warp dialog opens from Edit ▸ Transform ▸ Warp", async ({ page }) => {
  await gotoApp(page);
  await redDoc(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Transform ▸ Warp")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Transform ▸ Warp")).run());
  await expect(page.getByText("Deforms the active layer with a preset envelope.")).toBeVisible();
});
