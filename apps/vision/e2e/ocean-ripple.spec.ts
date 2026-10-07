import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Distort ▸ Ocean Ripple ────────────────────────────────
// Adobe: Ocean Ripple adds randomly-spaced ripples so the image looks underwater —
// it displaces pixels by a wavy field, turning straight edges wavy. Vision adds a
// new engine distort (ocean_ripple) reusing the value-noise helper. pick_color
// reads 8-bit channels (engine 16-bit internally).
//   https://helpx.adobe.com/photoshop/using/distort-filters.html

// R values down the boundary column (x=20) of a black/white split.
const boundaryColumn = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [3, 8, 13, 18, 23, 28, 33, 38].map((y) => ((E.pick_color(20, y) >>> 0) >>> 24) & 255);
  });

async function split(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "ocean");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

test("Ocean Ripple makes a straight edge wavy, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await split(page);
  expect(new Set(await boundaryColumn(page)).size).toBe(1); // straight edge → the boundary column is uniform
  await page.evaluate(() => (window as any).__mv.distort.oceanRipple(0.3, 0.7));
  expect(new Set(await boundaryColumn(page)).size).toBeGreaterThan(1); // the edge became wavy → the column varies
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(new Set(await boundaryColumn(page)).size).toBe(1); // undo restores the straight edge
});

test("Ocean Ripple leaves a flat field unchanged", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "ocean-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  await page.evaluate(() => (window as any).__mv.distort.oceanRipple(0.3, 0.7));
  const r = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(20, 20) >>> 0) >>> 24 & 255);
  expect(r).toBe(128); // displacing a uniform colour yields the same colour
});

test("the Ocean Ripple dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await split(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Ocean Ripple…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Ocean Ripple…")).run());
  await expect(page.getByText("Ripple Magnitude")).toBeVisible();
});
