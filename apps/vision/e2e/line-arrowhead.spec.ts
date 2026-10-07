import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Line tool arrowheads ─────────────────────────────────
// Adobe: the Line tool can add an arrowhead at the Start and/or End, sized by
// Width/Length (absolute pixels) and Concavity. Vision adds the options + the pure
// geometry in src/state/arrowhead.ts, filled via select_polygon/fill_selection.
//   https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page, opts: Record<string, unknown>): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate((o) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "line-arrow", "transparent");
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "line", lineWeight: 4, ...o });
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

async function drawLine(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(40), m.cy(80));
  await page.mouse.down();
  await page.mouse.move(m.cx(100), m.cy(80));
  await page.mouse.move(m.cx(160), m.cy(80));
  await page.mouse.up();
}
/** alpha at a doc pixel (pick_color packs 0xRRGGBBAA). */
const alpha = (page: Page, x: number, y: number): Promise<number> =>
  page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) & 255, { x, y });

test("the Line options bar shows arrowhead Start/End controls", async ({ page }) => {
  await scene(page, { lineArrowEnd: true });
  await expect(page.locator("#mv-arrow-start")).toBeVisible();
  await expect(page.locator("#mv-arrow-end")).toBeVisible();
  await expect(page.locator("#mv-arrow-width")).toHaveAttribute("min", "1");
  await expect(page.locator("#mv-arrow-length")).toHaveAttribute("min", "1");
});

test("Start and End arrowheads render in the held-drag preview", async ({ page }) => {
  const m = await scene(page, { lineArrowStart: true, lineArrowEnd: true, lineArrowWidth: 20, lineArrowLength: 40 });
  await page.mouse.move(m.cx(40), m.cy(80));
  await page.mouse.down();
  await page.mouse.move(m.cx(160), m.cy(80), { steps: 6 });

  const tips = await Promise.all(["start", "end"].map((end) =>
    page.locator(`[data-mv-preview-arrow="${end}"]`).evaluate((el) => {
      const [x, y] = el.getAttribute("points")!.split(/[ ,]/).map(Number);
      return { x, y };
    }),
  ));
  expect(Math.abs(tips[0].x - 40)).toBeLessThan(3);
  expect(Math.abs(tips[0].y - 80)).toBeLessThan(3);
  expect(Math.abs(tips[1].x - 160)).toBeLessThan(3);
  expect(Math.abs(tips[1].y - 80)).toBeLessThan(3);

  // Pointer-down owns the operation: a tool shortcut must not make the live
  // preview disagree with the Shape ▸ Line operation that pointer-up commits.
  await page.keyboard.press("g");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("gradient");
  await expect(page.locator("[data-mv-preview-arrow]")).toHaveCount(2);

  await page.mouse.up();
  await expect(page.locator("[data-mv-preview-arrow]")).toHaveCount(0);
});

test("an End arrowhead fills beyond the line band", async ({ page }) => {
  const m = await scene(page, { lineArrowEnd: true, lineArrowWidth: 20, lineArrowLength: 40, lineArrowConcavity: 0 });
  await drawLine(page, m);
  expect(await alpha(page, 100, 80)).toBe(255); // on the line band
  expect(await alpha(page, 130, 86)).toBe(255); // inside the arrowhead, below the 4px band
});

test("with arrowheads off, the same off-band point is empty", async ({ page }) => {
  const m = await scene(page, { lineArrowStart: false, lineArrowEnd: false });
  await drawLine(page, m);
  expect(await alpha(page, 100, 80)).toBe(255); // line still drawn
  expect(await alpha(page, 130, 86)).toBe(0); // no arrowhead → empty
});
