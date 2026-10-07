import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Fill ▸ Preserve Transparency ─────────────────
// Adobe: the Fill dialog's "Preserve Transparency" checkbox restricts the fill to
// the layer's already-opaque pixels (locks the alpha). Vision routes the fill to the
// engine's alpha-locked fill_blend_preserve / fill_pattern_preserve.
// Test setup: a transparent layer (1) holding a blue square over a white background
// layer (0). With Preserve ON, filling green recolours only the square — the rest
// stays transparent so the white background shows; with it OFF the whole layer fills.
//   https://helpx.adobe.com/photoshop/using/filling-stroking-selections-layers.html

async function setupGreenFill(page: Page, doc: string) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, d); // white background = layer 0
    mv.store.addLayer();             // transparent layer 1, now active
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 255, 255); E.select_none(); // opaque blue square
    mv.engine.commit();
  }, doc);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Edit ▸ Fill…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Edit ▸ Fill…")).run());
  await expect(page.locator("#mv-fill-contents")).toBeVisible();
  await chooseOption(page.locator("#mv-fill-contents"), "color");
  await page.locator("#mv-fill-color").fill("#00ff00");
}

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0);
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

test("Preserve Transparency ON recolours only the opaque pixels", async ({ page }) => {
  await setupGreenFill(page, "fpres1");
  await page.locator("#mv-fill-preserve").click(); // enable Preserve Transparency
  await page.getByRole("button", { name: "OK" }).click();
  expect((await rgb(page, 5, 5))[1]).toBeGreaterThan(150);     // square recoloured green
  expect(await rgb(page, 32, 32)).toEqual([255, 255, 255]);    // transparent area preserved → white bg shows
});

test("Preserve Transparency OFF fills the transparent area too", async ({ page }) => {
  await setupGreenFill(page, "fpres2");
  await page.getByRole("button", { name: "OK" }).click(); // checkbox left off
  const rest = await rgb(page, 32, 32);
  expect(rest[1]).toBeGreaterThan(150); // whole layer filled green
  expect(rest[0]).toBeLessThan(100);
});
