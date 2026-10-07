import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop View ▸ Pattern Preview: the document tiles edge-to-edge in the
// viewport so seamless-pattern joins are visible. Vision redraws the dirty region
// in every tile during a live stroke, before that stroke is committed.
test("Pattern Preview tiles the document edge-to-edge and updates live", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "pat"));
  await expect(page.locator("[data-mv-pattern-preview]")).toHaveCount(0);

  const command = page.locator('.monet-menu-item:not([aria-haspopup="menu"])').filter({
    has: page.locator(".monet-menu-label", { hasText: /^Pattern Preview$/ }),
  });
  await page.getByText("View", { exact: true }).first().click();
  await expect(command).toHaveCount(1);
  await command.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.patternPreview)).toBe(true);
  await expect(page.locator("[data-mv-pattern-preview]")).toHaveCount(1);

  const repeated = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(3, 3, 1, 1, 0);
    E.fill_selection(255, 0, 0, 255);
    mv.engine.paintRegion(3, 3, 1, 1);
    const canvas = document.querySelector<HTMLCanvasElement>("[data-mv-pattern-preview]")!;
    const ctx = canvas.getContext("2d")!;
    return [3, 43, 83].map((x) => Array.from(ctx.getImageData(x, 3, 1, 1).data));
  });
  expect(repeated).toEqual([[255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]]);

  await page.getByText("View", { exact: true }).first().click();
  await command.click();
  await expect(page.locator("[data-mv-pattern-preview]")).toHaveCount(0);
});
