import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Image ▸ Canvas Size ▸ Canvas extension color ─────────
// Adobe: when enlarging the canvas, the "Canvas extension color" floods the new
// border around the existing image (Foreground/Background/White/Black/Gray/Other).
// Vision adds it via the engine resize_canvas_filled (the new border is flooded on
// the background layer); "None" keeps the new area transparent (a plain resize).
//   https://helpx.adobe.com/photoshop/using/changing-canvas-size.html

async function openCanvasSize(page: Page, doc: string) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, d);
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none(); // opaque green
    mv.engine.commit();
  }, doc);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Canvas Size…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Canvas Size…")).run());
  await expect(page.locator("#mv-canvas-extension")).toBeVisible();
}

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0);
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

async function grow80(page: Page) {
  await page.locator("#mv-canvas-w").fill("80");
  await page.locator("#mv-canvas-w").press("Enter");
  await page.locator("#mv-canvas-h").fill("80");
  await page.locator("#mv-canvas-h").press("Enter");
}

test("a White canvas extension floods the new border, keeping the original content", async ({ page }) => {
  await openCanvasSize(page, "cext");
  await grow80(page);
  await chooseOption(page.locator("#mv-canvas-extension"), "white");
  await page.getByRole("button", { name: "Apply" }).click();
  // Centre anchor (default): the 40² content moves to (20,20)–(60,60) in the 80² canvas.
  const corner = await rgba(page, 5, 5);   // new border → white, opaque
  const center = await rgba(page, 40, 40); // original content → green
  expect(corner.slice(0, 3)).toEqual([255, 255, 255]);
  expect(corner[3]).toBe(255);
  expect(center[1]).toBeGreaterThan(150);
  expect(center[0]).toBeLessThan(100);
});

test("the None extension leaves the new border transparent", async ({ page }) => {
  await openCanvasSize(page, "cext2");
  await grow80(page);
  await expect(page.locator("#mv-canvas-extension")).toHaveAttribute("data-value", "none"); // default
  await page.getByRole("button", { name: "Apply" }).click();
  const corner = await rgba(page, 5, 5);
  expect(corner[3]).toBe(0); // transparent border
});
