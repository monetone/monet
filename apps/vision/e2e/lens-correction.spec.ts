import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Lens Correction (Custom tab) ──────
// Monet shipped Distortion + Vignette + Aberration. This adds two more of
// the Custom-tab controls:
//   • Vignette ▸ Midpoint — pushes the vignette correction outward: 0
//     affects the whole frame, higher values restrict it to the edges.
//   • Transform ▸ Scale — zooms the image about the centre (>100% crops the
//     blank wedges that distortion/vignette correction leaves at the edges).
//
//   https://helpx.adobe.com/photoshop/using/correcting-image-distortion-noise.html

const D = 32;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}

// Dark field with a bright band in the right quarter (source x ≥ 24).
async function bandDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "lens-correction");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d, d, 0); E.fill_selection(40, 40, 40, 255);
    E.select_rect(24, 0, 8, d, 0); E.fill_selection(230, 230, 230, 255);
    E.select_none();
    mv.engine.commit();
  }, D);
}

// Flat mid-grey field — a canvas for the vignette (radial) correction.
async function greyDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "lens-correction");
    const E = mv.engine.engine;
    E.select_rect(0, 0, d, d, 0); E.fill_selection(100, 100, 100, 255);
    E.select_none();
    mv.engine.commit();
  }, D);
}

// ── Scale zooms about the centre ───────────────────────────────────
test("Scale zooms the image about the centre", async ({ page }) => {
  await bandDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensCorrection(0, 0, 0, 1, 0)); // scale 1
  expect(await red(page, 28, 16)).toBeGreaterThan(180); // x=28 sits in the bright band
  await bandDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensCorrection(0, 0, 0, 2, 0)); // scale 2 (zoom in)
  expect(await red(page, 28, 16)).toBeLessThan(120); // zoom pulls the bright edge past x=28
});

// ── Vignette Midpoint restricts the correction to the edges ────────
test("Vignette Midpoint restricts the correction to the edges", async ({ page }) => {
  await greyDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensCorrection(0, 1, 0, 1, 0)); // midpoint 0 = whole frame
  const wide = await red(page, 6, 6);
  await greyDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensCorrection(0, 1, 0, 1, 0.7)); // midpoint 0.7 = edges only
  const edge = await red(page, 6, 6);
  expect(wide).toBeGreaterThan(edge + 3); // mid-radius pixel brightened far less when restricted
});

// ── UI: the Lens Correction… dialog exposes the new controls ───────
// Opened via the command palette rather than the menu: "Lens Correction…"
// appears twice in the menu tree (Filter + Automate), so a label-based menu
// walk can hit the hidden duplicate. The palette runs the same action.
test("the Lens Correction… dialog exposes Scale + Vignette Midpoint", async ({ page }) => {
  await greyDoc(page);
  const opened = await page.evaluate(() => {
    const items = (window as any).__mv.commandPalette.items as Array<{ label: string; run: () => void }>;
    const it = items.find((i) => typeof i.label === "string" && i.label.endsWith("Lens Correction…"));
    if (!it) return false;
    it.run();
    return true;
  });
  expect(opened).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Vignette Midpoint", { exact: true }).first()).toBeVisible(); // new control
  await expect(page.getByText("Scale", { exact: true }).first()).toBeVisible();             // new control
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
});
