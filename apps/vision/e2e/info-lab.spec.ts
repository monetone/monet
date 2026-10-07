import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Info panel Lab (L*/a*/b*) readout ────────────────────
// Adobe: the Info panel can report the picked colour in CIE Lab alongside RGB/HSB/
// CMYK. Vision adds L/a/b rows from the pure sRGB→Lab conversion in
// @monet-ui/monet-photo's rgbLab.ts — D50, as Photoshop's Lab is (#459) — and
// Lab-mode documents sample the live engine composite.
//   https://helpx.adobe.com/photoshop/using/information-panel-overview.html

const val = (page: Page, id: string) => page.locator(`[data-mv-info="${id}"] .val`);
const pick = (page: Page, r: number, g: number, b: number) =>
  page.evaluate(({ r, g, b }) => (window as any).__mv.store.setPicked({ r, g, b, a: 255 }), { r, g, b });

test("the Info panel shows the Lab readout for the picked colour", async ({ page }) => {
  await gotoApp(page);
  await pick(page, 255, 0, 0);
  await page.locator('[data-tab-id="info"]').click();
  await expect(val(page, "lab-l")).toHaveText("54");
  await expect(val(page, "lab-a")).toHaveText("81");
  await expect(val(page, "lab-b")).toHaveText("70");
});

test("white reads L 100 with neutral a/b", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-tab-id="info"]').click();
  await pick(page, 255, 255, 255);
  await expect(val(page, "lab-l")).toHaveText("100");
  await expect(val(page, "lab-a")).toHaveText("0");
  await expect(val(page, "lab-b")).toHaveText("0");
});

test("Lab mode readout samples the engine composite at the cursor", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(16, 16, "lab-engine-readout");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(0, 255, 0, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setColorMode(3);
    mv.store.setCursor({ x: 4, y: 4 });
    mv.store.setPicked({ r: 255, g: 0, b: 0, a: 255 });
  });
  await page.locator('[data-tab-id="info"]').click();
  await expect(val(page, "lab-l")).toHaveText("88");
  await expect(val(page, "lab-a")).toHaveText("-79");
  await expect(val(page, "lab-b")).toHaveText("81");
});
