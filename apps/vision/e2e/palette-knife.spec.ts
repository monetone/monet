import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Palette Knife ──────────────────────────────
// Adobe: Palette Knife "reduces detail in an image to give the effect of a thinly
// painted canvas that reveals the texture underneath." Vision adds an engine filter
// (filter_palette_knife) that flattens each pixel toward its local (Stroke Size)
// average, restoring edges by Stroke Detail and softening by Softness. pick_color
// reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const red = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), [x, y] as const);

// Left half black, right half white (vertical boundary at x=w/2).
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "palette-knife");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("flattens a hard edge toward the local average, and is undoable", async ({ page }) => {
  await split(page, 32, 32);
  expect(await red(page, 15, 16)).toBe(0); // dark side of the boundary
  await page.evaluate(() => (window as any).__mv.fil.paletteKnife(50, 1, 0)); // wide stroke, minimal edge retention
  expect(await red(page, 15, 16)).toBeGreaterThan(40); // flattened toward the average
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await red(page, 15, 16)).toBe(0); // undo restores the hard edge
});

test("higher Stroke Detail keeps the edge sharper", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.paletteKnife(50, 1, 0)); // low detail → flatten
  const lo = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.paletteKnife(50, 3, 0)); // high detail → keep edge
  const hi = await red(page, 15, 16);
  expect(hi).toBeLessThan(lo); // more detail keeps the dark edge darker
});

test("a wider Stroke Size flattens more", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.paletteKnife(5, 1, 0));
  const small = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.paletteKnife(50, 1, 0));
  const large = await red(page, 15, 16);
  expect(large).toBeGreaterThan(small);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await split(page, 40, 30);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [sz, dt, sf] of [[1, 3, 0], [50, 1, 10], [25, 2, 5]] as const) {
    await page.evaluate(([sz, dt, sf]) => (window as any).__mv.fil.paletteKnife(sz, dt, sf), [sz, dt, sf] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
  }
});

test("the Palette Knife dialog opens from the Filter menu", async ({ page }) => {
  await split(page, 32, 32);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Palette Knife…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Palette Knife…")).run());
  await expect(page.getByText("Stroke Detail")).toBeVisible();
});
