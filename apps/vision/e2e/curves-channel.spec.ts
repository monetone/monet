import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Curves ▸ Channel selector (RGB/Red/Green/Blue) ───────
// Adobe: the Curves dialog has a Channel dropdown; editing a channel's curve and
// OK applies the composite (RGB/master) curve plus the per-channel curves together.
// Vision only edited the master curve (R/G/B forced identity); now a Monet
// #mv-curves-channel select picks the channel and adj.curves(master,r,g,b) routes it.
//   https://helpx.adobe.com/photoshop/using/curves-adjustment.html

/** Center-pixel RGB of the exported composite. */
async function centerPixel(page: Page): Promise<{ r: number; g: number; b: number }> {
  return await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const png = mv.engine.engine.export_png();
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    const img: HTMLImageElement = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0);
    const d = cx.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data;
    URL.revokeObjectURL(url);
    return { r: d[0], g: d[1], b: d[2] };
  });
}

async function openCurves(page: Page) {
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("Adjustments ▸ Curves"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("Adjustments ▸ Curves")).run();
  });
  await expect(page.locator("#mv-curves-channel")).toBeVisible();
}

test("the Curves Channel selector offers RGB/Red/Green/Blue", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "curvech");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  await openCurves(page);
  await page.locator("#mv-curves-channel").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveText(["RGB", "Red", "Green", "Blue"]);
});

test("editing the Red channel changes only red", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "curvech2");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  const before = await centerPixel(page);
  await openCurves(page);
  await chooseOption(page.locator("#mv-curves-channel"), "Red");
  await expect(page.locator("#mv-curves-channel")).toHaveAttribute("data-value", "1");
  // Drag the curve editor's mid point upward to lift the red channel.
  const ed = page.locator('[aria-label="Tone curve"]');
  const box = await ed.boundingBox();
  if (!box) throw new Error("curve editor not found");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.18, { steps: 12 });
  await page.mouse.up();
  await page.getByRole("button", { name: "OK" }).click();
  const after = await centerPixel(page);
  expect(after.r).not.toBe(before.r); // red routed + changed
  expect(after.g).toBe(before.g);     // green untouched
  expect(after.b).toBe(before.b);     // blue untouched
});
