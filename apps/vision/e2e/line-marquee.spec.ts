import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Single Row / Single Column Marquee ───────────────────
// Adobe: clicking with the Single Row Marquee selects a 1px-tall row across the
// full width; Single Column selects a 1px-wide column across the full height.
// Vision adds two click tools that compute the 1px rect (src/state/lineMarquee.ts)
// and call engine.select_rect.
//   https://helpx.adobe.com/photoshop/using/selecting-pixels.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page, tool: "singlerow" | "singlecolumn"): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, tool }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "rowcol");
    mv.engine.commit();
    mv.store.setTool(tool);
    mv.store.fit();
  }, { w: DOCW, h: DOCH, tool });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  await expect(page.getByRole("button", { name: tool === "singlerow" ? "Single Row Marquee" : "Single Column Marquee" }))
    .toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const bounds = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
const hasSel = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as any).__mv.engine.engine.has_selection());

test("the Single Row Marquee tool is selectable", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("singlerow"));
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("singlerow");
});

test("clicking selects a 1px row spanning the full width", async ({ page }) => {
  const m = await scene(page, "singlerow");
  await page.mouse.click(m.cx(100), m.cy(50));
  expect(await hasSel(page)).toBe(true);
  const b = await bounds(page); // [x, y, w, h]
  expect(b[0]).toBe(0);
  expect(Math.abs(b[1] - 50)).toBeLessThanOrEqual(2);
  expect(b[2]).toBe(DOCW);
  expect(b[3]).toBe(1);
});

test("the marquee Mode control is available for these tools and sets selMode", async ({ page }) => {
  await scene(page, "singlerow");
  await page.getByText("Subtract", { exact: true }).click(); // marquee-group Mode control
  expect(await page.evaluate(() => (window as any).__mv.store.state.selMode)).toBe(2);
});

test("clicking selects a 1px column spanning the full height", async ({ page }) => {
  const m = await scene(page, "singlecolumn");
  await page.mouse.click(m.cx(70), m.cy(80));
  expect(await hasSel(page)).toBe(true);
  const b = await bounds(page);
  expect(Math.abs(b[0] - 70)).toBeLessThanOrEqual(2);
  expect(b[1]).toBe(0);
  expect(b[2]).toBe(1);
  expect(b[3]).toBe(DOCH);
});
