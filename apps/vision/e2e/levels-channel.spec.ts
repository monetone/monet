import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Levels ▸ Channel selector (RGB/Red/Green/Blue) ───────
// Adobe: the Levels dialog has a Channel dropdown; editing per-channel input/gamma/
// output and OK applies the composite (RGB) plus the per-channel levels together.
// Vision only edited the composite; now a Monet #mv-levels-channel select picks the
// channel and the engine's adjust_levels_multi applies composite + per-channel in one
// continuous pass (no LUT quantization). Sibling of the #54 Curves channel selector.
//   https://helpx.adobe.com/photoshop/using/levels-adjustment.html

async function grayDoc(page: Page, doc: string) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, d);
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(160, 160, 160, 255); E.select_none(); // uniform mid-grey
    mv.engine.commit();
  }, doc);
}

async function openLevels(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Adjustments ▸ Levels")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Adjustments ▸ Levels")).run());
  await expect(page.locator("#mv-levels-channel")).toBeVisible();
}

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0);
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

test("the Levels Channel selector offers RGB/Red/Green/Blue", async ({ page }) => {
  await grayDoc(page, "lvl");
  await openLevels(page);
  await page.locator("#mv-levels-channel").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveText(["RGB", "Red", "Green", "Blue"]);
});

test("editing the Red channel changes only red", async ({ page }) => {
  await grayDoc(page, "lvl2");
  await openLevels(page);
  await chooseOption(page.locator("#mv-levels-channel"), "Red");
  // Drive the Red channel's Output White to 0 (Home on its slider) → red → 0.
  const ow = page.locator(".monet-row", { hasText: "Output white" }).locator(".monet-slider");
  await ow.focus();
  await ow.press("Home");
  await page.getByRole("button", { name: "OK" }).click();
  const c = await rgb(page, 20, 20);
  expect(c[0]).toBeLessThan(20);      // red driven to ~0
  expect(c[1]).toBeGreaterThan(140);  // green unchanged (~160)
  expect(c[2]).toBeGreaterThan(140);  // blue unchanged (~160)
});
