import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Smudge tool ▸ Finger Painting ────────────────────────
// Adobe: the Smudge tool's Finger Painting option smears using the foreground
// color at the start of each stroke, as if you dipped a finger in paint before
// dragging; off, it smears the canvas color under the pointer. Vision seeded the
// smear only from the canvas. The engine `set_smudge_finger` branch is verified
// in Rust; here we assert the store→engine wiring drives it end-to-end.
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

// Smudge a red foreground across a uniform white doc; return the red/green at a
// pixel near the stroke start. Finger ON seeds the smear with red → the start
// tints red (green drops); OFF seeds it with white → it stays neutral.
async function smudgeStart(page: Page, finger: boolean) {
  return page.evaluate((finger) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 20, "sm");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red foreground
    mv.store.setTool("smudge");
    mv.store.setBrush({ size: 16, smudgeFinger: finger });
    mv.store.beginBrushStroke();
    E.stroke_begin(); E.stroke_to(6, 10, 1); E.stroke_to(34, 10, 1); E.stroke_end();
    mv.store.endBrushStroke();
    E.composite();
    const c = E.pick_color(8, 10) >>> 0; // near the stroke start
    return { r: (c >>> 24) & 255, g: (c >>> 16) & 255 };
  }, finger);
}

test("Finger Painting seeds the smear with the foreground color; plain smudge stays neutral", async ({ page }) => {
  await gotoApp(page);
  const on = await smudgeStart(page, true);
  expect(on.r - on.g).toBeGreaterThan(25); // red deposited at the stroke start
  const off = await smudgeStart(page, false);
  expect(Math.abs(off.r - off.g)).toBeLessThan(8); // white smeared into white
});

test("the Smudge options bar offers a Finger Painting toggle that drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("smudge"));
  const box = page.getByRole("checkbox", { name: "Finger Painting" });
  await expect(box).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.smudgeFinger)).toBe(false);
  await box.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.smudgeFinger)).toBe(true);
});
