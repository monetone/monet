import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Magnetic Lasso ──────────────────────────────────────
// Drag near a high-contrast boundary and the freehand path snaps to and follows
// the edge (engine magnetic_lasso: each point snaps to the strongest luma-gradient
// pixel within the search Width). Joins the Lasso flyout group.
// https://helpx.adobe.com/photoshop/using/selecting-magnetic-lasso-tool.html

const DOCW = 60;
const DOCH = 40;

// [x,y,w,h] of the current selection.
const selBounds = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);

// A doc split black|white with a strong vertical edge at x=30; Magnetic Lasso armed
// with a small search Width so only points near the edge snap to it.
async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "ml");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 30, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(30, 0, 30, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("magneticlasso");
    mv.store.setOptions({ magneticLassoRadius: 5, magneticLassoThreshold: 0.1, antiAlias: false });
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

test("the path snaps onto a nearby strong edge", async ({ page }) => {
  await scene(page);
  // A loop whose RIGHT side sits at x=34 (4px past the edge → within Width 5 →
  // snaps to the edge at x≈30); the LEFT side at x=10 is far from any edge → stays.
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const xs = [10, 34, 34, 10, 10];
    const ys = [8, 8, 32, 32, 20];
    mv.store.magneticLassoApply(xs, ys, 0);
  });
  const b = await selBounds(page); // [x,y,w,h]
  expect(b[2] * b[3]).toBeGreaterThan(0);   // a selection exists
  expect(b[0] + b[2]).toBeLessThanOrEqual(32); // right edge snapped from 34 to ~30
  expect(b[0]).toBeLessThanOrEqual(11);     // left side stayed near 10 (no collapse)
});

test("a real Magnetic Lasso drag near the edge creates a selection", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.move(m.cx(10), m.cy(8));
  await page.mouse.down();
  await page.mouse.move(m.cx(31), m.cy(8));
  await page.mouse.move(m.cx(31), m.cy(32));
  await page.mouse.move(m.cx(10), m.cy(32));
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
});

test("Magnetic Lasso is reachable from the Lasso flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-lasso"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="magneticlasso"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("magneticlasso");
});
