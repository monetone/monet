import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Freeform Pen ────────────────────────────────────────
// Drag to draw a smooth freehand path; releasing fills the closed path with the
// foreground colour (Vision's pen fills on close). The path is Catmull-Rom
// smoothed. Joins the Pen flyout group.
// https://helpx.adobe.com/photoshop/using/drawing-pen-tools.html

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
    mv.store.newDocument(w, h, "ffp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); // white base
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red fill
    mv.store.setTool("freeformpen");
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

test("a freeform drag fills the enclosed area with the foreground colour", async ({ page }) => {
  const m = await scene(page);
  // Drag a big triangle loop and release to fill it.
  await page.mouse.move(m.cx(20), m.cy(20));
  await page.mouse.down();
  await page.mouse.move(m.cx(80), m.cy(25));
  await page.mouse.move(m.cx(50), m.cy(65));
  await page.mouse.move(m.cx(22), m.cy(24));
  await page.mouse.up();

  const inside = await rgba(page, 48, 38); // well inside the triangle
  expect(inside[0]).toBeGreaterThan(180); // red…
  expect(inside[1]).toBeLessThan(90);     // …not white
  const outside = await rgba(page, 4, 75); // a far corner stays white
  expect(outside[0]).toBeGreaterThan(220);
  expect(outside[1]).toBeGreaterThan(220);
});

test("Freeform Pen is reachable from the Pen flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-pen"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="freeformpen"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("freeformpen");
});
