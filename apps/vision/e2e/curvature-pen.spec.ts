import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Curvature Pen ───────────────────────────────────────
// Click discrete anchor points; the tool fits a SMOOTH curve that bends through
// every clicked point and re-fits live as each point is added (no bezier-handle
// dragging). Finish on double-click or Enter (Esc cancels). On finish the path
// is filled with the foreground colour, exactly like the Pen/Freeform Pen close.
// Joins the Pen flyout group.
// https://helpx.adobe.com/photoshop/using/draw-curved-paths-curvature-pen.html

const DOCW = 100;
const DOCH = 80;

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "curve");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); // white base
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red fill
    mv.store.setTool("curvaturepen");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.1, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

test("clicking points then Enter fits a smooth curve and fills it with the foreground colour", async ({ page }) => {
  const m = await scene(page);
  // Click three discrete anchors (no dragging); the curve bends through them.
  await page.mouse.click(m.cx(22), m.cy(20));
  await page.mouse.click(m.cx(80), m.cy(22));
  await page.mouse.click(m.cx(50), m.cy(65));
  // After ≥3 clicks the live work-path holds the densified (smoothed) curve, with
  // many more points than the 3 clicked — proof it was fitted, not joined straight.
  const pathLen = await page.evaluate(() => ((window as any).__mv.store.state.penPath as number[]).length);
  expect(pathLen).toBeGreaterThan(6);
  // Enter finishes and fills the enclosed area.
  await page.keyboard.press("Enter");

  const inside = await rgba(page, 50, 40); // well inside the curved triangle
  expect(inside[0]).toBeGreaterThan(180); // red…
  expect(inside[1]).toBeLessThan(90);     // …not white
  const outside = await rgba(page, 4, 76); // a far corner stays white
  expect(outside[0]).toBeGreaterThan(220);
  expect(outside[1]).toBeGreaterThan(220);
  // The in-progress work path is cleared once the curve is committed.
  expect(await page.evaluate(() => ((window as any).__mv.store.state.penPath as number[]).length)).toBe(0);
});

test("double-click finishes the curve and fills it", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(22), m.cy(20));
  await page.mouse.click(m.cx(80), m.cy(22));
  await page.mouse.dblclick(m.cx(50), m.cy(65)); // 3rd anchor + finish on double-click
  const inside = await rgba(page, 50, 40);
  expect(inside[0]).toBeGreaterThan(180);
  expect(inside[1]).toBeLessThan(90);
});

test("Escape cancels an in-progress curve without filling", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(22), m.cy(20));
  await page.mouse.click(m.cx(80), m.cy(22));
  await page.mouse.click(m.cx(50), m.cy(65));
  await page.keyboard.press("Escape");
  // Nothing was filled and the work path was discarded.
  const inside = await rgba(page, 50, 40);
  expect(inside[0]).toBeGreaterThan(220);
  expect(inside[1]).toBeGreaterThan(220);
  expect(await page.evaluate(() => ((window as any).__mv.store.state.penPath as number[]).length)).toBe(0);
});

test("undo restores the canvas after a curvature-pen fill", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(22), m.cy(20));
  await page.mouse.click(m.cx(80), m.cy(22));
  await page.mouse.click(m.cx(50), m.cy(65));
  await page.keyboard.press("Enter");
  expect((await rgba(page, 50, 40))[0]).toBeGreaterThan(180); // filled red
  // Closing the path is a small engine sequence (select → fill → deselect), each
  // its own history step; step back through it until the fill is undone. Proves
  // the curve fill is fully reversible (the canvas returns to its white base).
  for (let i = 0; i < 4; i++) {
    if ((await rgba(page, 50, 40))[1] > 220) break; // green channel high → white again
    await page.evaluate(() => (window as any).__mv.store.undo());
  }
  const restored = await rgba(page, 50, 40);
  expect(restored[0]).toBeGreaterThan(220); // back to white
  expect(restored[1]).toBeGreaterThan(220);
  expect(restored[2]).toBeGreaterThan(220);
});

test("Curvature Pen is reachable from the Pen flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-pen"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="curvaturepen"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("curvaturepen");
});
