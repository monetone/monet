import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Polygonal Lasso tool ─────────────────────────────────
// Adobe: click to place straight-edge selection corners; double-click or click
// the start point to close into a selection. Vision accumulates the clicked
// vertices (src/state/polyLasso.ts) and calls engine.select_polygon on close.
//   https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "polylasso");
    mv.engine.commit();
    mv.store.setTool("polylasso");
    mv.store.setOptions({ antiAlias: false }); // crisp integer selection bounds
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const hasSel = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as any).__mv.engine.engine.has_selection());
const bounds = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
const near = (a: number, b: number) => Math.abs(a - b) <= 3;

// triangle: (30,30) (170,30) (100,120) → bbox [30,30,140,90]
test("double-clicking closes the polygon into a selection", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(30), m.cy(30));
  await page.mouse.click(m.cx(170), m.cy(30));
  await page.mouse.dblclick(m.cx(100), m.cy(120)); // adds the apex + closes
  expect(await hasSel(page)).toBe(true);
  const b = await bounds(page);
  expect(near(b[0], 30)).toBe(true);
  expect(near(b[1], 30)).toBe(true);
  expect(near(b[2], 140)).toBe(true);
  expect(near(b[3], 90)).toBe(true);
});

test("clicking the start point closes the polygon", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(30), m.cy(30));
  await page.mouse.click(m.cx(170), m.cy(30));
  await page.mouse.click(m.cx(100), m.cy(120));
  await page.mouse.click(m.cx(30), m.cy(30)); // back on the start → close
  expect(await hasSel(page)).toBe(true);
  const b = await bounds(page);
  expect(near(b[0], 30)).toBe(true);
  expect(near(b[2], 140)).toBe(true);
  expect(near(b[3], 90)).toBe(true);
});

test("the tool is selectable and shows the Mode + Anti-alias options", async ({ page }) => {
  await scene(page);
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("polylasso");
  await page.getByText("Add", { exact: true }).click(); // marquee-group Mode control
  expect(await page.evaluate(() => (window as any).__mv.store.state.selMode)).toBe(1);
  await expect(page.getByText("Anti-alias", { exact: true })).toBeVisible();
});

test("switching tools cancels an in-progress polygon", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(40), m.cy(40));
  await page.mouse.click(m.cx(150), m.cy(60));
  await expect(page.locator("[data-mv-polylasso]")).toHaveAttribute("data-mv-polylasso", "2");
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await expect(page.locator("[data-mv-polylasso]")).toHaveCount(0); // preview cleared
  expect(await hasSel(page)).toBe(false); // never closed → no selection
});
