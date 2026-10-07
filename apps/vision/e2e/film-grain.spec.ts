import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Film Grain ─────────────────────────────────
// Adobe: Film Grain lays an even monochromatic grain over the image (with a
// Highlight Area control that protects the brights). Distinct from Add Noise.
// Vision adds a new engine filter (filter_film_grain) reusing the seeded-noise
// pattern; here we prove a flat field becomes grainy and the op is undoable.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

// R-channel values at a spread of points across a 40×40 doc. pick_color reads back
// 8-bit channels (the engine stores 16-bit internally), so all thresholds here —
// including the mean tolerance below — are in 8-bit (0..255) terms.
const sampleR = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const pts = [[5, 5], [12, 8], [19, 14], [26, 6], [33, 11], [8, 22], [17, 28], [24, 19], [31, 31], [13, 35], [29, 24], [21, 3]];
    return pts.map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });

async function flatGray(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "filmgrain");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(128, 128, 128, 255); // flat mid-gray
    E.select_none();
    mv.engine.commit();
  });
}

test("Film Grain makes a flat field grainy, keeps the mean, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await flatGray(page);
  const before = await sampleR(page);
  expect(new Set(before).size).toBe(1); // perfectly flat to start
  expect(before[0]).toBe(128);

  await page.evaluate(() => (window as any).__mv.fil.filmGrain(1, 0, 1));
  const after = await sampleR(page);
  expect(new Set(after).size).toBeGreaterThan(1); // grain → the samples now vary
  const mean = after.reduce((a, b) => a + b, 0) / after.length;
  expect(Math.abs(mean - 128)).toBeLessThan(40); // grain is ~zero-mean

  await page.evaluate(() => (window as any).__mv.store.undo());
  const undone = await sampleR(page);
  expect(new Set(undone).size).toBe(1); // undo restores the flat field
  expect(undone[0]).toBe(128);
});

test("the Film Grain dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await flatGray(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Film Grain…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Film Grain…")).run());
  await expect(page.getByText("Highlight Area")).toBeVisible();
});
