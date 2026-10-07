import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Image Size ▸ Pixels / Percent units ──────────────────
// Adobe: the Image Size width/height fields take a unit (Pixels / Percent); in
// Percent the value is relative to the original (50% of 200px = 100px). Vision adds
// a #mv-imgsize-unit dropdown driving the pure resolveImageSize/toPercent helpers.
//   https://helpx.adobe.com/photoshop/using/image-size.html

async function openImageSize(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "imgsize-units");
    mv.engine.commit();
  }, { w, h });
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("Image ▸ Image Size"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.startsWith("Image ▸ Image Size")).run());
  await expect(page.locator("#mv-imgsize-unit")).toBeVisible();
}

const dims = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));

test("Percent units resize the document proportionally", async ({ page }) => {
  await openImageSize(page, 200, 200);
  await chooseOption(page.locator("#mv-imgsize-unit"), "percent");
  await page.locator("#mv-imgsize-w").fill("50");
  await page.locator("#mv-imgsize-w").press("Enter");
  await page.getByRole("button", { name: "Resize" }).click();
  expect(await dims(page)).toEqual({ w: 100, h: 100 }); // 50% of 200, constrain keeps height 50% too
});

test("Pixel units still resize directly", async ({ page }) => {
  await openImageSize(page, 200, 200);
  await page.locator("#mv-imgsize-w").fill("120");
  await page.locator("#mv-imgsize-w").press("Enter");
  await page.getByRole("button", { name: "Resize" }).click();
  expect(await dims(page)).toEqual({ w: 120, h: 120 }); // constrain keeps the square aspect
});
