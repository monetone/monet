import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Spatter ───────────────────────────────
// Adobe: Spatter "replicates the effect of a spatter airbrush." It scatters each
// pixel to a random nearby offset within the Spray Radius, so smooth edges break
// into a ragged spray while flat areas stay flat. Controls: Spray Radius (0–25),
// Smoothness (1–15). Vision adds an engine filter (filter_spatter). pick_color is
// 0xRRGGBBAA (R>>24).
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// max R over a rectangular band [x0,x1) × [0,h)
const maxR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(({ x0, x1, h }) => {
    const E = (window as any).__mv.engine.engine;
    let m = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m = Math.max(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, { x0, x1, h });

// black left half | white right half (boundary at x=20)
async function splitDoc(page: Page, name: string) {
  await page.evaluate((name) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, name);
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  }, name);
}

test("Spatter sprays an edge into its neighbour near the boundary, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await splitDoc(page, "spatter");
  await page.evaluate(() => (window as any).__mv.fil.spatter(8, 1)); // strong, fine spray
  expect(await maxR(page, 13, 19, 40)).toBeGreaterThan(150); // white sprayed into the near-boundary black band
  expect(await maxR(page, 0, 6, 40)).toBeLessThan(60); // far from the edge the black half is untouched
  // undo restores the crisp split
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await maxR(page, 0, 6, 40)).toBe(0); // black half is solid black again
  const E = await page.evaluate(() => ((( (window as any).__mv.engine.engine.pick_color(35, 20) >>> 0) >>> 24) & 255));
  expect(E).toBe(255); // white half is solid white again
});

test("Spatter leaves a flat field unchanged", async ({ page }) => {
  await gotoApp(page);
  const ok = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "spatter-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(70, 130, 180, 255); E.select_none();
    mv.engine.commit();
    mv.fil.spatter(8, 3);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const c = E.pick_color(x, y) >>> 0;
      if (((c >>> 24) & 255) !== 70 || ((c >>> 16) & 255) !== 130 || ((c >>> 8) & 255) !== 180) return false;
    }
    return true;
  });
  expect(ok).toBe(true); // scattering a uniform field leaves every pixel the same colour
});

test("the Spatter dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "spatter-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Spatter…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Spatter…")).run());
  await expect(page.getByText("Spray Radius")).toBeVisible();
});
