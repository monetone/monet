import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// ── Photoshop brush options bar ▸ Smoothing ────────────────────────
// Adobe (CC 2018+): the brush options bar has a Smoothing % — the brush follows
// the cursor with a lag proportional to the %, so jittery input renders as a clean
// curve. Vision adds it by easing the stroke path toward the cursor in CanvasView
// before E.stroke_to (smoothing 0 = unchanged). The easing math is covered by a unit
// test; this covers the control + that the smoothing reaches the real stroke path.
//   https://helpx.adobe.com/photoshop/using/painting-tools.html

const DOCW = 160;
const DOCH = 120;

const smoothingOf = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.brush.smoothing as number);

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "smooth");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red, so the stroke shows on white
    mv.store.setBrush({ size: 10, hardness: 1 });
    mv.store.setTool("brush");
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

// A pronounced zigzag drag (sharp corners that smoothing visibly rounds off).
async function zigzag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(20), m.cy(30));
  await page.mouse.down();
  for (const [x, y] of [[40, 90], [60, 30], [80, 90], [100, 30], [120, 90]] as const) {
    await page.mouse.move(m.cx(x), m.cy(y), { steps: 2 });
  }
  await page.mouse.up();
}

// ── UI: the Smoothing control drives store.brush.smoothing ──────────
test("the brush options bar exposes a Smoothing control wired to the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await expect(page.getByText("Smoothing", { exact: true })).toBeVisible();
  expect(await smoothingOf(page)).toBe(0); // default off
  // Drive the actual slider (scoped to the Smoothing row) → store updates.
  const slider = page.locator("span").filter({ hasText: /^Smoothing/ }).getByRole("slider").first();
  await slider.focus();
  await slider.press("End");
  expect(await smoothingOf(page)).toBeCloseTo(1, 5);
  await slider.press("Home");
  expect(await smoothingOf(page)).toBeCloseTo(0, 5);
});

// ── Effect: smoothing changes the painted stroke through the real path ─
test("a smoothed zigzag stroke differs from an unsmoothed one", async ({ page }) => {
  const m = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setBrush({ smoothing: 0 }));
  await zigzag(page, m);
  const sharp = await composite(page);

  const m2 = await setup(page); // fresh canvas
  await page.evaluate(() => (window as any).__mv.store.setBrush({ smoothing: 0.95 }));
  await zigzag(page, m2);
  const smooth = await composite(page);

  expect(sharp.chk).not.toBe(smooth.chk); // smoothing reached the stroke and changed it
  // both actually painted (the red stroke lowers the mean from the white bg)
  expect(sharp.mean).toBeLessThan(255);
  expect(smooth.mean).toBeLessThan(255);
});
