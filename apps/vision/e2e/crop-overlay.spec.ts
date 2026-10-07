import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Crop overlay guides and keyboard cycle ─────────────
// Adobe: O cycles the six designs; Shift+O changes Triangle / Golden Spiral
// orientation. Geometry comes from src/state/cropOverlay.ts and is rendered in
// the live crop preview.
//   https://helpx.adobe.com/ie/photoshop/using/new-shortcuts-cs6.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "crop-overlay");
    mv.engine.commit();
    mv.store.setTool("crop");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

/** Begin a crop drag, count the rendered guide lines, then release. */
async function guideCountDuringDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }): Promise<number> {
  await page.mouse.move(m.cx(20), m.cy(20));
  await page.mouse.down();
  await page.mouse.move(m.cx(180), m.cy(140));
  const n = await page.locator("[data-mv-crop-guide]").count();
  await page.mouse.up();
  return n;
}

async function beginCropDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }): Promise<void> {
  await page.mouse.move(m.cx(20), m.cy(20));
  await page.mouse.down();
  await page.mouse.move(m.cx(180), m.cy(140));
}

async function firstGuide(page: Page): Promise<string> {
  return page.locator("[data-mv-crop-guide]").first().evaluate((line) =>
    ["x1", "y1", "x2", "y2"].map((name) => line.getAttribute(name)).join(","));
}

test("the crop tool shows an Overlay dropdown defaulting to Rule of Thirds", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-crop-overlay")).toBeVisible();
  expect(await page.locator("#mv-crop-overlay").getAttribute("data-value")).toBe("thirds");
  await page.locator("#mv-crop-overlay").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveText([
    "Rule of Thirds", "Grid", "Diagonal", "Triangle", "Golden Ratio", "Golden Spiral", "None",
  ]);
});

test("O cycles the six designs, wraps, and never cycles the hidden state", async ({ page }) => {
  await scene(page);
  const overlay = page.locator("#mv-crop-overlay");
  for (const expected of ["grid", "diagonal", "triangle", "golden", "spiral", "thirds"]) {
    await page.keyboard.press("o");
    await expect(overlay).toHaveAttribute("data-value", expected);
  }
  await chooseOption(overlay, "none");
  await page.keyboard.press("o");
  await expect(overlay).toHaveAttribute("data-value", "thirds");

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "o", code: "KeyO", repeat: true, bubbles: true, cancelable: true,
  })));
  await expect(overlay).toHaveAttribute("data-value", "thirds");
});

test("O updates a stationary live crop preview without leaving the Crop tool", async ({ page }) => {
  const m = await scene(page);
  await beginCropDrag(page, m);
  await expect(page.locator("[data-mv-crop-guide]")).toHaveCount(4);
  await page.keyboard.press("o");
  await expect(page.locator("#mv-crop-overlay")).toHaveAttribute("data-value", "grid");
  await expect(page.locator("[data-mv-crop-guide]")).toHaveCount(6);
  await page.keyboard.press("o");
  await expect(page.locator("#mv-crop-overlay")).toHaveAttribute("data-value", "diagonal");
  await expect(page.locator("[data-mv-crop-guide]")).toHaveCount(4);
  const diagonals = await page.locator("[data-mv-crop-guide]").evaluateAll((lines) => lines.map((line) => ({
    x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")),
    x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")),
  })));
  for (const line of diagonals) {
    expect(Math.abs(line.x2 - line.x1)).toBeCloseTo(Math.abs(line.y2 - line.y1), 8);
  }
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("crop");
  await page.mouse.up();
});

test("Shift+O changes Triangle and Golden Spiral orientation during a live drag", async ({ page }) => {
  const m = await scene(page);
  const overlay = page.locator("#mv-crop-overlay");

  await chooseOption(overlay, "triangle");
  await beginCropDrag(page, m);
  await expect(page.locator("[data-mv-crop-guide]")).toHaveCount(3);
  const triangleBefore = await firstGuide(page);
  await page.keyboard.press("Shift+o");
  expect(await firstGuide(page)).not.toBe(triangleBefore);
  expect(await page.evaluate(() => (window as any).__mv.store.state.cropOverlayOrientation)).toBe(1);
  await page.mouse.up();

  await page.evaluate(() => (window as any).__mv.store.setOptions({ cropOverlayOrientation: 0 }));
  await chooseOption(overlay, "spiral");
  await beginCropDrag(page, m);
  await expect(page.locator("[data-mv-crop-guide]")).toHaveCount(72);
  const spiralBefore = await firstGuide(page);
  await page.keyboard.press("Shift+o");
  expect(await firstGuide(page)).not.toBe(spiralBefore);
  expect(await page.evaluate(() => (window as any).__mv.store.state.cropOverlayOrientation)).toBe(1);
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("crop");
  await page.mouse.up();
});

test("O keeps selecting Dodge outside the Crop tool", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("o");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("dodge");
});

test("Rule of Thirds draws 4 guide lines during the crop drag", async ({ page }) => {
  const m = await scene(page);
  expect(await guideCountDuringDrag(page, m)).toBe(4);
});

test("Grid draws 6 guide lines during the crop drag", async ({ page }) => {
  const m = await scene(page);
  await chooseOption(page.locator("#mv-crop-overlay"), "grid");
  expect(await guideCountDuringDrag(page, m)).toBe(6);
});

test("None draws no guide lines during the crop drag", async ({ page }) => {
  const m = await scene(page);
  await chooseOption(page.locator("#mv-crop-overlay"), "none");
  expect(await guideCountDuringDrag(page, m)).toBe(0);
});
