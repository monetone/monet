import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Magic Wand options-bar Feather ───────────────────────
// Adobe: the Magic Wand has a Feather field that softens the new selection at
// creation, like the Marquee/Lasso (#25). Vision shows the field for the wand and
// calls the existing feather_selection after magic_wand. We paint a red sub-rect so
// the wand selects a region with interior edges that feathering can soften (with
// anti-alias off so feather 0 is a hard binary edge).
//   https://helpx.adobe.com/photoshop/using/softening-edges-selections.html

const DOC = 120;

async function wandScene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "wandfeather");
    const E = mv.engine.engine;
    E.select_rect(30, 30, 60, 60, 0); // a red square at 30,30 → 90,90
    E.fill_selection(255, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("wand");
    mv.store.setOptions({ wandContiguous: true, antiAlias: false });
    mv.store.fit();
  }, DOC);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOC, cy: (d: number) => box.y + d * box.h / DOC };
}

// Number of partial-alpha (soft) bytes in the selection mask.
const partialCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const m = (window as any).__mv.engine.selectionMask();
    if (!m) return -1;
    let n = 0;
    for (let i = 0; i < m.length; i++) { const v = m[i]; if (v > 0 && v < 255) n++; }
    return n;
  });

test("the Magic Wand options bar shows a Feather field", async ({ page }) => {
  await wandScene(page);
  await expect(page.locator("#mv-selection-feather")).toBeVisible();
});

test("a feathered wand selection has a soft mask edge; feather 0 is hard", async ({ page }) => {
  const m = await wandScene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ selectionFeather: 0 }));
  await page.mouse.click(m.cx(60), m.cy(60)); // wand selects the red square (interior edges)
  expect(await partialCount(page)).toBe(0); // hard edge → no partial-alpha bytes

  await page.evaluate(() => (window as any).__mv.store.setOptions({ selectionFeather: 8 }));
  await page.mouse.click(m.cx(60), m.cy(60)); // re-select, now feathered
  expect(await partialCount(page)).toBeGreaterThan(0); // soft edges → partial-alpha bytes
});
