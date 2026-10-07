import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// Adobe: Artistic ▸ Sponge paints highly textured areas of contrasting color
// with Brush Size 0..10, Definition 0..25, and Smoothness 1..15.
// https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const varianceRed = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const engine = (window as any).__mv.engine.engine;
    const values: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values.push((engine.pick_color(x, y) >>> 24) & 255);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  }, [w, h] as const);

async function flat(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(48, 48, "sponge");
    const engine = mv.engine.engine;
    engine.select_all();
    engine.fill_selection(128, 128, 128, 255);
    engine.select_none();
    mv.engine.commit();
  });
}

test("Definition increases the contrast of sponge texture and Undo restores the layer", async ({ page }) => {
  await flat(page);
  await page.evaluate(() => (window as any).__mv.fil.sponge(2, 0, 5));
  const low = await varianceRed(page, 48, 48);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await varianceRed(page, 48, 48)).toBeCloseTo(0, 1);

  await page.evaluate(() => (window as any).__mv.fil.sponge(2, 25, 5));
  expect(await varianceRed(page, 48, 48)).toBeGreaterThan(low);
});

test("the Sponge dialog exposes Photoshop's controls and ranges", async ({ page }) => {
  await flat(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((item: any) => item.label.endsWith("Sponge…")),
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((item: any) => item.label.endsWith("Sponge…")).run());

  await expect(page.getByRole("spinbutton", { name: "Brush Size" })).toHaveAttribute("aria-valuemax", "10");
  await expect(page.getByRole("spinbutton", { name: "Definition" })).toHaveAttribute("aria-valuemax", "25");
  await expect(page.getByRole("spinbutton", { name: "Smoothness" })).toHaveAttribute("aria-valuemin", "1");
});
