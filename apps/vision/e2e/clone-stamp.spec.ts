import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Clone Stamp "Aligned" option ─────────────────────────
// Adobe spec (helpx "Retouch and repair photos" / Clone Stamp tool): Alt-click
// sets the sample source. With **Aligned** on (Photoshop's default) the sample
// point is locked to a fixed offset from the brush on the first stroke and the
// source then follows the brush across every later stroke — you can release and
// resume and the clone continues seamlessly. With Aligned off, each new stroke
// re-samples from the original source point. The engine used to behave as if
// always-unaligned (every stroke re-sampled the source) with no toggle.
//
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

const DOCW = 200;
const DOCH = 140;
// 5 vertical bands, 40px each: red·green·blue·yellow·magenta.
const BANDS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255]];

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

// Fresh banded doc with the clone tool armed; returns the doc→client map.
async function setup(page: Page, aligned: boolean, tool: "clone" | "heal" = "clone"): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, bands, aligned, tool }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "clone");
    const E = mv.engine.engine; // AFTER newDocument — it swaps the engine instance
    for (let i = 0; i < bands.length; i++) {
      E.select_rect(i * 40, 0, 40, h, 0);
      E.fill_selection(bands[i][0], bands[i][1], bands[i][2], 255);
    }
    E.select_none();
    mv.engine.commit();
    mv.store.setTool(tool);
    mv.store.setOptions({ cloneAligned: aligned });
    mv.store.fit();
  }, { w: DOCW, h: DOCH, bands: BANDS, aligned, tool });
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
  await page.mouse.move(m.cx(x), m.cy(y));
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

// A single clone dab at (x,y) — a clone stroke is painted on pointer-down.
async function dab(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x: number, y: number) {
  await page.mouse.move(m.cx(x), m.cy(y));
  await page.mouse.down();
  await page.mouse.up();
}

// ── Integration: the clone primitive through the engine FFI ────────
test("set_clone samples the source region at the given offset", async ({ page }) => {
  await gotoApp(page);
  const c = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 10, "cl");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 10, 0); E.fill_selection(255, 0, 0, 255);   // src red
    E.select_rect(20, 0, 20, 10, 0); E.fill_selection(0, 255, 0, 255);  // dest green
    E.select_none();
    E.set_brush(8, 1, 1, 1, 0.1, 255, 255, 255, 255, false);
    E.set_clone(true, -20, 0);
    E.stroke_begin(); E.stroke_to(30, 5, 1); E.stroke_end();
    E.composite();
    const v = E.pick_color(30, 5) >>> 0;
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255];
  });
  expect(c[0]).toBeGreaterThan(200); // red cloned over the green destination
  expect(c[1]).toBeLessThan(80);
});

// ── Mouse: Aligned vs non-aligned across two strokes ───────────────
// S=20 (red band). D1=100 → offset −80. D2=140:
//   Aligned     → samples 140−80 = 60  (green band)
//   Non-aligned → re-samples from S=20 (red band)
test("Aligned: the source follows the brush across strokes", async ({ page }) => {
  const m = await setup(page, true);
  await altClick(page, m, 20, 70); // sample red band
  await dab(page, m, 100, 70);     // first stroke locks offset −80
  await dab(page, m, 140, 70);     // second stroke keeps it → samples x=60 (green)
  const c = await pixel(page, 140, 70);
  expect(c[1]).toBeGreaterThan(200); // green
  expect(c[0]).toBeLessThan(80);
});

test("Non-aligned: every stroke re-samples from the original source", async ({ page }) => {
  const m = await setup(page, false);
  await altClick(page, m, 20, 70);
  await dab(page, m, 100, 70);
  await dab(page, m, 140, 70);     // re-samples from S=20 (red), not x=60
  const c = await pixel(page, 140, 70);
  expect(c[0]).toBeGreaterThan(200); // red
  expect(c[1]).toBeLessThan(80);
});

test("a new Alt-click resets alignment (clones the freshly sampled source)", async ({ page }) => {
  const m = await setup(page, true);
  await altClick(page, m, 20, 70); // red
  await dab(page, m, 100, 70);     // locks offset −80
  await altClick(page, m, 180, 70); // re-sample magenta band → alignment reset
  await dab(page, m, 140, 70);      // first stroke after re-click → offset 180−140=40, src=180 magenta
  const c = await pixel(page, 140, 70);
  expect(c[0]).toBeGreaterThan(200); // magenta = (255,0,255)
  expect(c[2]).toBeGreaterThan(200);
  expect(c[1]).toBeLessThan(80);
});

// ── UI: the Aligned checkbox ───────────────────────────────────────
test("clone & heal tools show an Aligned checkbox that drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("clone"));
  const aligned = page.getByRole("checkbox", { name: "Aligned" });
  await expect(aligned).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.cloneAligned)).toBe(true); // PS default
  await aligned.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.cloneAligned)).toBe(false);

  // it also appears for the Healing Brush
  await page.evaluate(() => (window as any).__mv.store.setTool("heal"));
  await expect(page.getByRole("checkbox", { name: "Aligned" })).toBeVisible();
});
