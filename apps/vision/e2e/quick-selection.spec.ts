import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Quick Selection tool ────────────────────────────────
// Paint over an area and the selection grows to include similar, contiguous
// pixels (engine quick_selection per dab; drag adds, Alt-drag subtracts). Joins
// the Magic Wand flyout group. https://helpx.adobe.com/photoshop/using/making-quick-selections.html

const DOCW = 80;
const DOCH = 60;

const selCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const b = Array.from(E.selection_bounds()) as number[]; // [x,y,w,h]
    return b[2] * b[3];
  });

// A doc split into a left red region and a right green region; Quick Selection
// armed. Returns the doc→client mapper.
async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "qs");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(220, 40, 40, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(40, 200, 40, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("quickselection");
    mv.store.setBrush({ size: 24 });
    mv.store.setOptions({ quickSelectionTolerance: 0.12 });
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

test("painting grows a selection within the similar region but not across the colour edge", async ({ page }) => {
  await scene(page);
  // Click in the red half, then drag along it — the selection should grow.
  await page.evaluate(() => (window as any).__mv.store.quickSelectionAt(8, 30, 0, true));
  const c1 = await selCount(page);
  await page.evaluate(() => (window as any).__mv.store.quickSelectionAt(20, 30, 1, false));
  const c2 = await selCount(page);
  expect(c1).toBeGreaterThan(0);
  expect(c2).toBeGreaterThan(c1); // dragging added more of the red region

  // The selection stays on the red side — its right edge doesn't cross into green.
  const b = await page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
  expect(b[0] + b[2]).toBeLessThanOrEqual(DOCW / 2 + 4); // bounded by the red/green seam
});

test("Alt-drag subtracts from the selection", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.quickSelectionAt(8, 20, 0, true);
    mv.store.quickSelectionAt(20, 40, 1, false);
  });
  const before = await selCount(page);
  await page.evaluate(() => (window as any).__mv.store.quickSelectionAt(20, 40, 2, false)); // subtract
  const after = await selCount(page);
  expect(after).toBeLessThan(before);
});

test("a real Quick Selection drag selects the painted region", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.move(m.cx(8), m.cy(30));
  await page.mouse.down();
  await page.mouse.move(m.cx(18), m.cy(30));
  await page.mouse.move(m.cx(28), m.cy(30));
  await page.mouse.up();
  expect(await selCount(page)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
});

test("Quick Selection is reachable from the Magic Wand flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-wand"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="quickselection"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("quickselection");
});
