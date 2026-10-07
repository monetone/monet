import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Slice + Slice Select tools ───────────────────────────
// Adobe groups Crop / Slice / Slice Select under the C key (Shift+C cycles). The
// Slice tool drags new rectangular slices; Slice Select moves/resizes/deletes
// them and respects View ▸ Lock Slices. Vision keeps the geometry pure in
// src/state/slices.ts (unit-tested) and edits via the store + CanvasView overlay.
//   https://helpx.adobe.com/photoshop/using/slicing-web-pages.html

const DOC = 200; // square document so the doc→client mapper is uniform

async function scene(page: Page, toolId: string): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ n, toolId }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(n, n, "slice");
    mv.engine.commit();
    mv.store.setTool(toolId);
    mv.store.fit();
  }, { n: DOC, toolId });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOC, cy: (d: number) => box.y + d * box.h / DOC };
}

const sliceCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.slices.length);
const slices = (page: Page): Promise<{ x: number; y: number; w: number; h: number }[]> =>
  page.evaluate(() => (window as any).__mv.store.state.slices);

const drag = async (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, ax: number, ay: number, bx: number, by: number) => {
  await page.mouse.move(m.cx(ax), m.cy(ay));
  await page.mouse.down();
  await page.mouse.move(m.cx(bx), m.cy(by), { steps: 8 });
  await page.mouse.up();
};

test("the Slice tool drags a new user slice (count increases)", async ({ page }) => {
  const m = await scene(page, "slice");
  expect(await sliceCount(page)).toBe(0);
  await drag(page, m, 20, 20, 120, 80); // 100×60 slice at (20,20)
  expect(await sliceCount(page)).toBe(1);
  const s = (await slices(page))[0];
  expect(Math.abs(s.x - 20)).toBeLessThan(3);
  expect(Math.abs(s.y - 20)).toBeLessThan(3);
  expect(Math.abs(s.w - 100)).toBeLessThan(3);
  expect(Math.abs(s.h - 60)).toBeLessThan(3);
});

test("a Slice-tool click (no drag) draws nothing", async ({ page }) => {
  const m = await scene(page, "slice");
  await page.mouse.click(m.cx(50), m.cy(50));
  expect(await sliceCount(page)).toBe(0);
});

test("Slice Select moves a slice by dragging its body", async ({ page }) => {
  const m = await scene(page, "sliceselect");
  await page.evaluate(() => (window as any).__mv.store.addSliceRect(40, 40, 100, 100)); // 60×60 at (40,40)
  expect(await sliceCount(page)).toBe(1);
  await drag(page, m, 70, 70, 110, 90); // grab the body centre, move +40,+20
  const s = (await slices(page))[0];
  expect(Math.abs(s.x - 80)).toBeLessThan(4);
  expect(Math.abs(s.y - 60)).toBeLessThan(4);
  expect(s.w).toBe(60);
  expect(s.h).toBe(60);
});

test("Slice Select resizes a slice by dragging the bottom-right handle", async ({ page }) => {
  const m = await scene(page, "sliceselect");
  await page.evaluate(() => (window as any).__mv.store.addSliceRect(40, 40, 100, 100)); // BR handle at (100,100)
  await drag(page, m, 100, 100, 140, 130);
  const s = (await slices(page))[0];
  expect(s.x).toBe(40);
  expect(s.y).toBe(40);
  expect(Math.abs(s.w - 100)).toBeLessThan(4); // 40..140
  expect(Math.abs(s.h - 90)).toBeLessThan(4);  // 40..130
});

test("Slice Select deletes the selected slice with the Delete key", async ({ page }) => {
  const m = await scene(page, "sliceselect");
  await page.evaluate(() => (window as any).__mv.store.addSliceRect(40, 40, 100, 100));
  expect(await sliceCount(page)).toBe(1);
  await page.mouse.click(m.cx(70), m.cy(70)); // select it
  await page.keyboard.press("Delete");
  expect(await sliceCount(page)).toBe(0);
});

test("clicking empty canvas deselects the active slice", async ({ page }) => {
  const m = await scene(page, "sliceselect");
  await page.evaluate(() => (window as any).__mv.store.addSliceRect(40, 40, 100, 100));
  expect(await page.evaluate(() => (window as any).__mv.store.state.selectedSlice)).toBe(0);
  await page.mouse.click(m.cx(170), m.cy(170)); // outside the slice
  expect(await page.evaluate(() => (window as any).__mv.store.state.selectedSlice)).toBe(-1);
});

test("Lock Slices prevents moving and deleting", async ({ page }) => {
  const m = await scene(page, "sliceselect");
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addSliceRect(40, 40, 100, 100);
    mv.store.toggleLockSlices();
  });
  const before = (await slices(page))[0];
  await drag(page, m, 70, 70, 110, 90); // attempt a move
  expect((await slices(page))[0]).toEqual(before); // unchanged
  await page.mouse.click(m.cx(70), m.cy(70));
  await page.keyboard.press("Delete");
  expect(await sliceCount(page)).toBe(1); // not deleted
});

test("Shift+C cycles Crop ▸ Slice ▸ Slice Select", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(200, 200, "cyc"); mv.store.setTool("crop"); });
  const tool = () => page.evaluate(() => (window as any).__mv.store.state.tool as string);
  await page.keyboard.press("Shift+C");
  expect(await tool()).toBe("slice");
  await page.keyboard.press("Shift+C");
  expect(await tool()).toBe("sliceselect");
  await page.keyboard.press("Shift+C");
  expect(await tool()).toBe("crop");
});

test("the Slice tools share the Crop flyout slot and render the overlay", async ({ page }) => {
  await scene(page, "slice");
  // Crop / Slice / Slice Select collapse into one flyout slot.
  await expect(page.locator('[data-tool-group="grp-crop"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).__mv.store.addSliceRect(30, 30, 120, 110));
  await page.evaluate(() => (window as any).__mv.store.setTool("sliceselect"));
  // The selected slice draws its rect + 8 resize handles in the interactive overlay.
  await expect(page.locator('[data-mv-slice-rect="0"]')).toHaveCount(1);
  await expect(page.locator("[data-mv-slice-handle]")).toHaveCount(8);
});
