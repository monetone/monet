import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// ── Save for Web ▸ slices: each slice region exports as its own file ─
// Photoshop's Save for Web writes every slice as "{stem}_{NN}.{ext}".

test("Save for Web exports each slice as its own file", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addSliceRect(0, 0, 8, 8);
    mv.store.addSliceRect(8, 0, 16, 8);
    void mv.saveForWeb("web");
  });
  await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(2);
  expect(downloads.sort()).toEqual(["web_01.png", "web_02.png"]);
});
