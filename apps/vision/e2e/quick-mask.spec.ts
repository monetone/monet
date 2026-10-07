import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Quick Mask (true rubylith overlay) ─────────────────────────────
// Q / Select ▸ Edit in Quick Mask Mode rasterizes the selection into a grayscale
// buffer the brush edits directly; a red overlay (rendered FRONTEND-side from the
// engine's quick_mask buffer — never baked into output) frosts the masked areas.
// Exiting converts the painted buffer back into a selection. Driven via window.__mv.
//   https://helpx.adobe.com/photoshop/using/quick-mask-mode.html

/** One pixel [r,g,b,a] from the Quick Mask overlay canvas backing store. */
const qmPixel = (page: Page, x: number, y: number): Promise<number[] | null> =>
  page.evaluate(({ x, y }) => {
    const cv = document.querySelector("canvas[data-mv-quickmask]") as HTMLCanvasElement | null;
    const d = cv?.getContext("2d")?.getImageData(x, y, 1, 1).data;
    return d ? [d[0], d[1], d[2], d[3]] : null;
  }, { x, y });

const selBounds = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);

/** Wait until the overlay pixel at (x,y) satisfies `cond(alpha)`. */
const waitOverlay = (page: Page, x: number, y: number, cond: (a: number) => boolean) =>
  page.waitForFunction(({ x, y, src }) => {
    const cv = document.querySelector("canvas[data-mv-quickmask]") as HTMLCanvasElement | null;
    const d = cv?.getContext("2d")?.getImageData(x, y, 1, 1).data;
    // eslint-disable-next-line no-new-func
    return !!d && new Function("a", `return (${src})(a)`)(d[3]);
  }, { x, y, src: cond.toString() }, { timeout: 5000 });

// A 256×192 doc with the LEFT half selected → on enter, the left half seeds
// selected (clear overlay) and the right half masked (red overlay).
async function setup(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(256, 192, "qm");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(230, 230, 230, 255); E.select_none();
    E.select_rect(0, 0, 128, 192, 0);
    mv.engine.commit();
  });
}

test.beforeEach(async ({ page }) => { await gotoApp(page); await setup(page); });

test("the Q key toggles Quick Mask mode", async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__mv.store.state.quickMask)).toBe(false);
  await page.keyboard.press("q");
  expect(await page.evaluate(() => (window as any).__mv.store.state.quickMask)).toBe(true);
  await page.keyboard.press("q");
  expect(await page.evaluate(() => (window as any).__mv.store.state.quickMask)).toBe(false);
});

test("the Color panel Default button keeps normal defaults in Quick Mask while mask edit is on", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.maskEdit(true);
    mv.store.toggleQuickMask();
    mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 });
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 });
  });

  await page.getByTitle("Default (D)").click();

  expect(await page.evaluate(() => {
    const { fg, bg } = (window as any).__mv.store.state;
    return { fg, bg };
  })).toEqual({
    fg: { h: 0, s: 0, v: 0, a: 1 },
    bg: { h: 0, s: 0, v: 1, a: 1 },
  });
});

test("entering Quick Mask paints red over the masked area and clear over the selection", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.toggleQuickMask());
  await waitOverlay(page, 192, 96, (a) => a > 0); // overlay drawn (async effect)
  const masked = (await qmPixel(page, 192, 96))!; // right half → red rubylith
  const selected = (await qmPixel(page, 40, 96))!; // left half → no overlay
  expect(masked[0]).toBeGreaterThan(200); // red
  expect(masked[1]).toBeLessThan(60);
  expect(masked[2]).toBeLessThan(60);
  expect(masked[3]).toBeGreaterThan(80); // visibly frosted
  expect(selected[3]).toBe(0); // selected pixels stay clear
});

test("painting in Quick Mask changes the overlay and round-trips to a new selection", async ({ page }) => {
  const before = await selBounds(page); // [0,0,128,192] (left half)
  await page.evaluate(() => (window as any).__mv.store.toggleQuickMask());
  await waitOverlay(page, 200, 96, (a) => a > 0); // right half starts red

  // Paint WHITE into the masked right half → unmask it (extends the selection).
  await page.evaluate(() => {
    const mv = (window as any).__mv; const E = mv.engine.engine;
    E.set_brush(40, 1, 1, 1, 0.2, 255, 255, 255, 255, false);
    E.set_brush_mode(0);
    E.stroke_begin();
    for (let x = 170; x <= 230; x += 4) E.stroke_to(x, 96, 1);
    E.stroke_end();
    mv.engine.commit();
  });
  await waitOverlay(page, 200, 96, (a) => a === 0); // painted area now clear
  expect((await qmPixel(page, 200, 96))![3]).toBe(0);

  // Exit → the painted region joins the selection; bounds extend past x=128.
  await page.evaluate(() => (window as any).__mv.store.toggleQuickMask());
  const after = await selBounds(page);
  expect(after[0] + after[2]).toBeGreaterThan(before[0] + before[2]);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.quick_mask_on())).toBe(false);
  // The overlay canvas is cleared on exit.
  expect((await qmPixel(page, 192, 96))![3]).toBe(0);
});

test("exiting Quick Mask with no painting restores the same selection", async ({ page }) => {
  const before = await selBounds(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.toggleQuickMask();
    mv.store.toggleQuickMask();
  });
  expect(await selBounds(page)).toEqual(before);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.quick_mask_on())).toBe(false);
});

test("Quick Mask is display-only — the engine output stays untinted", async ({ page }) => {
  // The composite under the masked (right) half must remain the gray fill, not red —
  // the overlay lives on a separate canvas, never in export/pick_color.
  await page.evaluate(() => (window as any).__mv.store.toggleQuickMask());
  await waitOverlay(page, 192, 96, (a) => a > 0);
  const rgb = await page.evaluate(() => {
    const packed = (window as any).__mv.engine.engine.pick_color(192, 96) >>> 0;
    return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
  });
  expect(rgb[0]).toBeGreaterThan(200); // still ~gray (230) — not the red overlay
  expect(rgb[1]).toBeGreaterThan(200);
  expect(rgb[2]).toBeGreaterThan(200);
});
