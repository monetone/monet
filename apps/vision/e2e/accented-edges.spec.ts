import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Accented Edges ────────────────────────
// Adobe: Accented Edges finds the edges and accents them — high Edge Brightness
// → white edges, low → black edges — leaving flat areas alone. Vision adds a new
// engine filter (filter_accented_edges) via the established recipe. pick_color
// reads back 8-bit channels (engine is 16-bit internally); thresholds are 8-bit.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const pickR = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });

// A 40×40 doc split black (left) / white (right), boundary at x=20.
async function split(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "accent");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

test("Accented Edges (high brightness) brightens the boundary only, and undoes", async ({ page }) => {
  await gotoApp(page);
  await split(page);
  expect(await pickR(page, 19, 20)).toBe(0); // black-side boundary starts black
  await page.evaluate(() => (window as any).__mv.fil.accentedEdges(0.5, 0.9, 0.2));
  expect(await pickR(page, 19, 20)).toBeGreaterThan(40); // the boundary is accented toward white
  expect(await pickR(page, 5, 20)).toBeLessThan(20); // the flat black interior is untouched
  expect(await pickR(page, 35, 20)).toBeGreaterThan(235); // the flat white interior is untouched
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await pickR(page, 19, 20)).toBe(0); // undo restores the boundary
});

test("Accented Edges leaves a flat field unchanged", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "accent-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  await page.evaluate(() => (window as any).__mv.fil.accentedEdges(0.5, 0.9, 0.2));
  expect(await pickR(page, 20, 20)).toBe(128); // no edges → unchanged
});

test("the Accented Edges dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await split(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Accented Edges…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Accented Edges…")).run());
  await expect(page.getByText("Edge Brightness")).toBeVisible();
});
