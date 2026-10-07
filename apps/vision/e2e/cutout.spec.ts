import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Cutout ─────────────────────────────────────
// Adobe: Cutout "portrays an image as though it were made from roughly cut-out
// pieces of colored paper" — it flattens the image into a few solid-colour regions
// (Number of Levels) with simplified edges (Edge Simplicity / Edge Fidelity). Vision
// adds an engine filter (filter_cutout) that box-smooths then quantizes per channel.
// pick_color reads 8-bit channels (engine is 16-bit internally).
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

// Distinct R values across row y of a `w`-wide doc.
const distinctRow = (page: Page, w: number, y: number) =>
  page.evaluate(([w, y]) => {
    const E = (window as any).__mv.engine.engine;
    const s = new Set<number>();
    for (let x = 0; x < w; x++) s.add(((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return s.size;
  }, [w, y] as const);

async function gradient(page: Page, w: number, h: number) {
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "cutout");
    const E = mv.engine.engine;
    for (let x = 0; x < w; x++) {
      const v = Math.round((x * 255) / (w - 1));
      E.select_rect(x, 0, 1, h, 0);
      E.fill_selection(v, v, v, 255);
    }
    E.select_none();
    mv.engine.commit();
  }, [w, h] as const);
}

test("Cutout bands a gradient into few colours, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await gradient(page, 64, 8);
  expect(await distinctRow(page, 64, 4)).toBeGreaterThan(16); // a smooth gradient has many distinct tones
  await page.evaluate(() => (window as any).__mv.fil.cutout(2, 0, 3));
  expect(await distinctRow(page, 64, 4)).toBeLessThanOrEqual(3); // 2 levels → the row collapses to a couple of flat tiers
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await distinctRow(page, 64, 4)).toBeGreaterThan(16); // undo restores the gradient
});

test("Cutout leaves a flat field a single flat colour", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "cutout-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(100, 100, 100, 255); E.select_none();
    mv.engine.commit();
    mv.fil.cutout(4, 4, 2);
  });
  const rs = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [[2, 2], [20, 20], [38, 38], [0, 39]].map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });
  expect(new Set(rs).size).toBe(1); // a flat region stays a single flat colour
});

test("the Cutout dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await gradient(page, 32, 8);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Cutout…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Cutout…")).run());
  await expect(page.getByText("Edge Simplicity")).toBeVisible();
});
