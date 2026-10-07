import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop: Alt with the Brush = temporary Eyedropper ───────────
// Adobe spec / community: while the Brush tool is active, holding Alt/Option
// temporarily switches to the Eyedropper — click to sample a colour into the
// foreground, release, and the brush paints with the sampled colour. The sample
// honours the Eyedropper's Sample Size. (The app's brush never sampled on Alt.)
//
//   https://jkost.com/blog/2017/05/brushes-and-painting-tool-shortcuts-in-photoshop-cc.html

const DOCW = 200;
const DOCH = 140;

const picked = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.picked as { r: number; g: number; b: number; a: number });
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}
const depth = (page: Page) => page.evaluate(() => (window as any).__mv.engine.engine.undo_depth());

async function setup(page: Page, split: boolean): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, split }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "alt");
    const E = mv.engine.engine; // AFTER newDocument
    if (split) {
      E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
      E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    } else {
      E.select_rect(40, 40, 40, 40, 0); E.fill_selection(220, 30, 30, 255); // red square
    }
    E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // start black
    mv.store.setTool("brush");
    mv.store.fit();
  }, { w: DOCW, h: DOCH, split });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

async function altClick(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x: number, y: number) {
  await page.keyboard.down("Alt");
  await page.mouse.click(m.cx(x), m.cy(y));
  await page.keyboard.up("Alt");
}

// ── Mouse: Alt-click samples and does NOT paint ────────────────────
test("Alt-click with the brush samples the colour without painting", async ({ page }) => {
  const m = await setup(page, false);
  const d0 = await depth(page);
  await altClick(page, m, 60, 60); // on the red square
  const p = await picked(page);
  expect(p.r).toBeGreaterThan(180); // sampled red
  expect(p.g).toBeLessThan(80);
  expect(await depth(page)).toBe(d0);             // no stroke → no new history state
  expect((await pixel(page, 60, 60))[0]).toBeGreaterThan(180); // the sampled pixel is untouched
});

// ── Mouse: paint with the sampled colour ───────────────────────────
test("after Alt-sampling, a normal brush stroke paints with the sampled colour", async ({ page }) => {
  const m = await setup(page, false);
  await altClick(page, m, 60, 60); // sample red
  await page.mouse.click(m.cx(130), m.cy(110)); // paint on the empty (white) area
  const p = await pixel(page, 130, 110);
  expect(p[0]).toBeGreaterThan(150); // red painted
  expect(p[1]).toBeLessThan(110);
});

// ── Mouse: Alt-sample honours Sample Size ──────────────────────────
test("Alt-sample respects the Eyedropper Sample Size", async ({ page }) => {
  const m = await setup(page, true); // black | white split

  await page.evaluate(() => (window as any).__mv.store.setOptions({ sampleSize: 1 }));
  await altClick(page, m, 100, 70); // Point Sample at the boundary → extreme
  const pt = await picked(page);
  expect(pt.r < 40 || pt.r > 220).toBe(true);

  await page.evaluate(() => (window as any).__mv.store.setOptions({ sampleSize: 11 }));
  await altClick(page, m, 100, 70); // 11×11 average → grey
  const av = await picked(page);
  expect(av.r).toBeGreaterThan(90);
  expect(av.r).toBeLessThan(180);
});
