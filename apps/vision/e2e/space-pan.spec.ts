import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop spacebar → temporary Hand (pan) ──────────────────────
// Adobe spec (helpx "Hand tool"): holding the spacebar turns ANY active tool
// into a temporary Hand tool while pressed — drag to pan — and releasing it
// reverts to the original tool (the toolbar selection never changes). The app
// only panned via middle/right-drag or the Hand tool; this adds the spacebar.
//
//   https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html

// Centre of the document canvas (the largest <canvas>), in client coords.
async function canvasCentre(page: Page): Promise<{ x: number; y: number }> {
  return await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

// Computed cursor of the canvas viewport (the doc canvas's grandparent div).
async function viewportCursor(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const big = cs.map((c) => ({ c, r: c.getBoundingClientRect() })).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0].c;
    return getComputedStyle(big.parentElement!.parentElement!).cursor;
  });
}

const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__mv.store.state;
  return { spacePan: s.spacePan, tool: s.tool, panX: s.panX, panY: s.panY };
});

// ── Unit/state: the spacebar drives spacePan, not the tool ─────────
test("spacebar sets spacePan and leaves the active tool unchanged", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.down("Space");
  const during = await state(page);
  await page.keyboard.up("Space");
  const after = await state(page);
  expect(during.spacePan).toBe(true);
  expect(during.tool).toBe("brush"); // a temporary override — the tool itself is unchanged
  expect(after.spacePan).toBe(false);
  expect(after.tool).toBe("brush");  // reverts cleanly
});

// ── Mouse: Space + drag pans by the drag delta, and does NOT paint ─
test("Space + drag pans the canvas by the drag delta without painting", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(300, 200, "pan"); mv.store.setTool("brush"); });
  const before = await state(page);
  const depth0 = await page.evaluate(() => (window as any).__mv.engine.engine.undo_depth());
  const c = await canvasCentre(page);

  await page.keyboard.down("Space");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 80, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  const after = await state(page);
  // pan offset moved by exactly the client-space drag delta
  expect(after.panX - before.panX).toBeCloseTo(120, 0);
  expect(after.panY - before.panY).toBeCloseTo(80, 0);
  // the brush tool is still active, and the space-drag painted nothing
  expect(after.tool).toBe("brush");
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_depth())).toBe(depth0);
});

// ── Behavioral: the grab cursor ────────────────────────────────────
test("the canvas shows the grab cursor while Space is held, then reverts", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  const before = await viewportCursor(page); // brush → crosshair
  await page.keyboard.down("Space");
  expect(await viewportCursor(page)).toBe("grab");
  await page.keyboard.up("Space");
  expect(await viewportCursor(page)).toBe(before);
});

// ── Edge: window blur ends pan mode so it never gets stuck ──────────
test("losing window focus while Space is held ends pan mode", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.down("Space");
  expect((await state(page)).spacePan).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect((await state(page)).spacePan).toBe(false);
  await page.keyboard.up("Space");
});
