import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Eraser ▸ Mode (Brush / Pencil / Block) ───────────────
// Adobe: the plain Eraser tool has a Mode dropdown — Brush (soft), Pencil (hard
// aliased round), Block (hard aliased square). Vision only had the soft brush
// eraser. Brush/Pencil differ only by hardness (already the Pencil trick); Block
// switches the dab footprint to a hard square (engine `set_block`). The square
// geometry is verified in Rust; here we assert the store→engine wiring end-to-end.
//   https://helpx.adobe.com/photoshop/using/erasing.html

// Red layer over a blue layer; erase one dab of `size` at the centre in `mode`.
// Returns the red channel at the centre and at a square corner: erasing the red
// top layer reveals blue (red→0). Size 20 → radius 10; the corner (38,38) is
// inside the Block square but outside the round disc.
async function eraseDab(page: Page, mode: "brush" | "pencil" | "block", size: number) {
  return page.evaluate(({ mode, size }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(60, 60, "er");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 0, 255, 255); E.select_none(); // bottom = blue
    mv.store.addLayer();
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none(); // top = red
    mv.engine.commit();
    mv.store.setTool("erase");
    mv.store.setOptions({ eraserMode: mode });
    mv.store.setBrush({ size });
    mv.store.beginBrushStroke();
    E.stroke_begin(); E.stroke_to(30, 30, 1); E.stroke_end();
    mv.store.endBrushStroke();
    E.composite();
    const red = (x: number, y: number) => (E.pick_color(x, y) >>> 24) & 255;
    return { corner: red(38, 38), centre: red(30, 30) };
  }, { mode, size });
}

test("Block eraser clears a hard square; Brush eraser leaves the square's corner", async ({ page }) => {
  await gotoApp(page);
  const block = await eraseDab(page, "block", 20);
  expect(block.centre).toBeLessThan(40); // centre erased → blue shows
  expect(block.corner).toBeLessThan(40); // square corner also erased
  const brush = await eraseDab(page, "brush", 20);
  expect(brush.centre).toBeLessThan(40); // centre erased
  expect(brush.corner).toBeGreaterThan(200); // round eraser leaves the corner red
});

test("the Eraser options bar offers a Mode control (Brush default) that drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("erase"));
  await expect(page.getByRole("radio", { name: "Pencil", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Block", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.eraserMode)).toBe("brush");
  await page.getByRole("radio", { name: "Block", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.eraserMode)).toBe("block");
});
