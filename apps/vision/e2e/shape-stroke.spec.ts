import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop shape Stroke (Rectangle / Ellipse outline) ───────────
// Adobe: shapes have a separate Fill and Stroke (width + align inside/centre/
// outside). Vision adds a Stroke width + Align for the rect/ellipse shape kinds;
// the ring geometry lives in src/state/shapeStroke.ts and is filled with the bg
// colour via select_rect/select_ellipse (subtract) + fill_selection.
//   https://helpx.adobe.com/photoshop/using/drawing-shapes.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page, opts: Record<string, unknown>): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate((o) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "shape-stroke", "transparent");
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black fill
    mv.store.setBackground({ h: 0, s: 1, v: 1, a: 1 }); // red stroke
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "rect", ...o });
    mv.store.fit();
  }, opts);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

async function drawRect(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(50), m.cy(40));
  await page.mouse.down();
  await page.mouse.move(m.cx(100), m.cy(80));
  await page.mouse.move(m.cx(150), m.cy(120));
  await page.mouse.up();
}
/** {r, a} at a doc pixel (pick_color packs 0xRRGGBBAA). */
const px = (page: Page, x: number, y: number): Promise<{ r: number; a: number }> =>
  page.evaluate(({ x, y }) => {
    const v = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return { r: (v >>> 24) & 255, a: v & 255 };
  }, { x, y });

test("the Shape options bar shows a Stroke control for rect/ellipse", async ({ page }) => {
  await scene(page, {});
  await expect(page.locator("#mv-shape-stroke")).toBeVisible();
});

test("a centre-aligned stroke rings the shape with the background colour", async ({ page }) => {
  const m = await scene(page, { shapeStrokeWidth: 8, shapeStrokeAlign: 1 });
  await drawRect(page, m);
  const border = await px(page, 50, 80); // left edge → inside the stroke ring
  expect(border.a).toBe(255);
  expect(border.r).toBeGreaterThan(200); // red stroke
  const interior = await px(page, 100, 80); // well inside → fg fill
  expect(interior.a).toBe(255);
  expect(interior.r).toBeLessThan(60); // black fill
  const outside = await px(page, 40, 80); // beyond the outer ring (x<46)
  expect(outside.a).toBe(0); // transparent
});

test("stroke width 0 draws no outline (the edge pixel is the fill colour)", async ({ page }) => {
  const m = await scene(page, { shapeStrokeWidth: 0 });
  await drawRect(page, m);
  const edge = await px(page, 50, 80); // left edge of the plain fill
  expect(edge.a).toBe(255);
  expect(edge.r).toBeLessThan(60); // black fill, not red
});
