import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Texture ▸ Texturizer ──────────────────────────────────
// Adobe: Texturizer overlays a surface texture (Canvas/Sandstone/Brick/Burlap) as
// relief. Vision adds a new engine filter (filter_texturizer) via the established
// recipe. pick_color reads back 8-bit channels (engine 16-bit internally);
// thresholds here are 8-bit (0..255).
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const sampleR = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const pts = [[5, 5], [12, 8], [19, 14], [26, 6], [33, 11], [8, 22], [17, 28], [24, 19], [31, 31], [13, 35], [29, 24], [21, 3]];
    return pts.map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });

async function flatGray(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "texturizer");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(128, 128, 128, 255);
    E.select_none();
    mv.engine.commit();
  });
}

test("Texturizer overlays a texture on a flat field, keeps the mean, and undoes", async ({ page }) => {
  await gotoApp(page);
  await flatGray(page);
  const before = await sampleR(page);
  expect(new Set(before).size).toBe(1); // perfectly flat to start

  await page.evaluate(() => (window as any).__mv.fil.texturizer(0, 0.33, 0.5, 0, false)); // Canvas
  const after = await sampleR(page);
  expect(new Set(after).size).toBeGreaterThan(1); // the texture varies the field
  const mean = after.reduce((a, b) => a + b, 0) / after.length;
  expect(Math.abs(mean - 128)).toBeLessThan(45); // relief is ~zero-mean

  await page.evaluate(() => (window as any).__mv.store.undo());
  const undone = await sampleR(page);
  expect(new Set(undone).size).toBe(1); // undo restores the flat field
  expect(undone[0]).toBe(128);
});

test("the Texturizer dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await flatGray(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Texturizer…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Texturizer…")).run());
  await expect(page.getByText("Relief")).toBeVisible();
});
