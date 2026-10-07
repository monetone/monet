import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Marquee/Lasso options-bar Feather ────────────────────
// Adobe: the Marquee/Lasso tools have a Feather field that softens the selection
// as it is created (distinct from Select ▸ Modify ▸ Feather, applied after the
// fact — see selection-feather.spec.ts). Vision adds the option + applies the
// existing feather_selection on commit; the clamp/guard is in
// src/state/selectionFeather.ts.
//   https://helpx.adobe.com/photoshop/using/softening-edges-selections.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page, feather: number): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate((f) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "feather", "transparent");
    mv.engine.commit();
    mv.store.setTool("marquee");
    mv.store.setOptions({ selectionFeather: f, selMode: 0, marqueeStyle: "normal" });
    mv.store.fit();
  }, feather);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

/** Drag a marquee rect, then fill the (feathered) selection black. */
async function selectAndFill(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(50), m.cy(40));
  await page.mouse.down();
  await page.mouse.move(m.cx(100), m.cy(80));
  await page.mouse.move(m.cx(150), m.cy(120));
  await page.mouse.up();
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.fill_selection(0, 0, 0, 255);
    (window as any).__mv.engine.commit();
  });
}
const alpha = (page: Page, x: number, y: number): Promise<number> =>
  page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) & 255, { x, y });

test("the selection options bar shows a Feather input for the marquee", async ({ page }) => {
  await scene(page, 0);
  await expect(page.locator("#mv-selection-feather")).toBeVisible();
});

test("a feathered marquee bleeds partial opacity beyond the hard edge", async ({ page }) => {
  const m = await scene(page, 20);
  await selectAndFill(page, m);
  expect(await alpha(page, 100, 80)).toBeGreaterThan(230); // near-solid interior (a wide feather has a faint tail)
  const bleed = await alpha(page, 156, 80); // 6px beyond the x=150 edge
  expect(bleed).toBeGreaterThan(0);
  expect(bleed).toBeLessThan(255); // soft, not solid
});

test("with feather 0 the edge is hard (no bleed beyond it)", async ({ page }) => {
  const m = await scene(page, 0);
  await selectAndFill(page, m);
  expect(await alpha(page, 100, 80)).toBe(255); // solid interior
  expect(await alpha(page, 156, 80)).toBe(0); // nothing beyond the hard edge
});
