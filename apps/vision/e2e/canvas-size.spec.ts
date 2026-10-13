import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Canvas Size ▸ units + Anchor + Relative ──────────────
// Adobe: the Canvas Size dialog has a 3×3 Anchor grid (where the existing content
// is pinned; the new canvas extends from the opposite side) and a Relative checkbox
// (W/H become deltas) and synchronized unit menus beside both dimensions. Vision
// feeds canonical pixel values to the existing resize_canvas via pure helpers.
//   https://helpx.adobe.com/photoshop/using/adjusting-crop-rotation-canvas.html

const OW = 200;
const OH = 160;

/** Fresh document filled solid red, then open Canvas Size via the command palette. */
async function openCanvasSize(page: Page, width = OW, height = OH) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "canvas-size", "white", 1, { resolutionPpi: 100 });
    const E = mv.engine.e;
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
    mv.store.markActiveSaved();
  }, { w: width, h: height });
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("Image ▸ Canvas Size"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.startsWith("Image ▸ Canvas Size")).run();
  });
  await expect(page.locator("#mv-canvas-relative")).toBeVisible();
}

async function setField(page: Page, sel: string, v: number) {
  await page.locator(sel).fill(String(v));
  await page.locator(sel).press("Enter");
}
const dims = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
/** Packed RGBA pick at a doc pixel → {a,r}. */
const pick = (page: Page, x: number, y: number): Promise<{ a: number; r: number }> =>
  page.evaluate(({ x, y }) => {
    const v = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return { a: v & 255, r: (v >>> 24) & 255 };
  }, { x, y });

test("the dialog shows W/H, a Relative toggle (off), and a 3×3 anchor (centre default)", async ({ page }) => {
  await openCanvasSize(page);
  await expect(page.locator("#mv-canvas-w")).toBeVisible();
  await expect(page.locator("#mv-canvas-h")).toBeVisible();
  await expect(page.locator("#mv-canvas-w-unit")).toContainText("Pixels");
  await expect(page.locator("#mv-canvas-h-unit")).toContainText("Pixels");
  expect(await page.locator("#mv-canvas-relative").getAttribute("aria-checked")).toBe("false");
  expect(await page.locator('[data-mv-anchor="1-1"]').getAttribute("aria-pressed")).toBe("true");
});

test("either unit menu synchronizes both fields and Relative keeps signed physical deltas", async ({ page }) => {
  await openCanvasSize(page);
  await page.locator("#mv-canvas-h-unit").click();
  await page.getByRole("option", { name: "Inches" }).click();
  await expect(page.locator("#mv-canvas-w-unit")).toContainText("Inches");
  await expect(page.locator("#mv-canvas-h-unit")).toContainText("Inches");
  await expect(page.locator("#mv-canvas-w")).toHaveValue("2.00");
  await expect(page.locator("#mv-canvas-h")).toHaveValue("1.60");

  await page.locator("#mv-canvas-relative").click();
  await setField(page, "#mv-canvas-w", 1);
  await setField(page, "#mv-canvas-h", -0.5);
  await page.getByRole("button", { name: "Apply" }).click();
  expect(await dims(page)).toEqual({ w: 300, h: 110 });
});

test("an absolute resize applies the chosen dimensions", async ({ page }) => {
  await openCanvasSize(page);
  await setField(page, "#mv-canvas-w", 300);
  await setField(page, "#mv-canvas-h", 240);
  await page.getByRole("button", { name: "Apply" }).click();
  expect(await dims(page)).toEqual({ w: 300, h: 240 });
});

test("Relative mode adds the deltas to the current size", async ({ page }) => {
  await openCanvasSize(page);
  await page.locator("#mv-canvas-relative").click(); // → fields zero, accept deltas
  await setField(page, "#mv-canvas-w", 100);
  await setField(page, "#mv-canvas-h", 80);
  await page.getByRole("button", { name: "Apply" }).click();
  expect(await dims(page)).toEqual({ w: OW + 100, h: OH + 80 });
});

test("an over-budget Relative size is blocked without dirtying or resizing", async ({ page }) => {
  await openCanvasSize(page, 800, 800);
  await page.locator("#mv-canvas-relative").click();
  await setField(page, "#mv-canvas-w", 8192);
  await setField(page, "#mv-canvas-h", 8192);

  await expect(page.getByRole("alert")).toContainText("image-size limit");
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(await dims(page)).toEqual({ w: 800, h: 800 });
  expect(await page.evaluate(() => {
    const { store } = (window as any).__mv;
    return store.docDirty(store.state.activeDocId);
  })).toBe(false);
});

test("the top-left anchor keeps content at the origin; the new area is transparent", async ({ page }) => {
  await openCanvasSize(page);
  await page.locator('[data-mv-anchor="0-0"]').click(); // anchor top-left
  await setField(page, "#mv-canvas-w", 300);
  await setField(page, "#mv-canvas-h", 240);
  await page.getByRole("button", { name: "Apply" }).click();
  const origin = await pick(page, 5, 5); // still inside the old (red) content
  expect(origin.a).toBe(255);
  expect(origin.r).toBeGreaterThan(200);
  const grown = await pick(page, 250, 200); // new bottom-right area
  expect(grown.a).toBe(0); // transparent
});
