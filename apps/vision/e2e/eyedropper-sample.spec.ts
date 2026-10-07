import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Eyedropper "Sample" source ───────────────────────────
// Adobe spec (helpx "Choosing colors" + Photoshop Training Channel): the
// Eyedropper's Sample menu chooses which layers it reads — All Layers (the
// composite), Current Layer (only the active layer), or Current & Below (the
// active layer plus everything beneath). The app always sampled the merged
// composite; this adds the Sample dropdown and per-mode sampling.
//
//   https://photoshoptrainingchannel.com/tips/sample-options-eyedropper-tool/

const DOCW = 200;
const DOCH = 140;

async function picked(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const p = (window as any).__mv.store.state.picked;
    return [p.r, p.g, p.b, p.a];
  });
}
const isRed = (p: number[]) => p[0] > 180 && p[2] < 90 && p[3] > 200;
const isGreen = (p: number[]) => p[1] > 150 && p[0] < 90;

// base = green (active) under an opaque red top layer. doc→client map returned.
async function twoLayers(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "eds");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 200, 0, 255); E.select_none(); // base green
    const base = E.active_layer_id();
    E.add_layer("top");
    E.select_rect(0, 0, w, h, 0); E.fill_selection(230, 30, 30, 255); E.select_none(); // opaque red top
    mv.store.selectLayer(base); // active = the green base
    mv.store.setTool("dropper");
    mv.engine.commit();
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

// ── Integration: the three Sample modes read different sources ─────
test("pick_sample reads All Layers / Current Layer / Current & Below distinctly", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "eds3");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 0, 255, 255); E.select_none(); // bottom blue
    const mid = E.add_layer("mid");
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 200, 0, 255); E.select_none(); // green LEFT
    E.add_layer("top");
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(230, 30, 30, 255); E.select_none(); // red RIGHT
    E.set_active_layer(mid); E.composite();
    const x = Math.round(w * 0.75), y = h / 2; // RIGHT half
    const u = (m: number) => E.pick_sample(x, y, 0, m) >>> 0;
    const unpack = (c: number) => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
    return { all: unpack(u(0)), cur: unpack(u(1)), below: unpack(u(2)) };
  }, { w: DOCW, h: DOCH });
  expect(isRed(r.all)).toBe(true);     // All Layers → red top
  expect(r.cur[3]).toBe(0);            // Current Layer → empty (transparent) there
  expect(r.below[2]).toBeGreaterThan(180); expect(r.below[0]).toBeLessThan(80); // Current & Below → blue
});

// ── Mouse: a dropper click in All Layers mode samples the top layer ─
test("a dropper click in All Layers mode picks the top layer's colour", async ({ page }) => {
  const m = await twoLayers(page); // sampleMode defaults to 0 (All Layers)
  await page.mouse.click(m.cx(100), m.cy(70));
  expect(isRed(await picked(page))).toBe(true); // sees the red top
});

// ── Mouse: Current Layer mode samples the active (hidden-below) layer ─
test("a dropper click in Current Layer mode picks the active layer's colour", async ({ page }) => {
  const m = await twoLayers(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ sampleMode: 1 }));
  await page.mouse.click(m.cx(100), m.cy(70));
  expect(isGreen(await picked(page))).toBe(true); // sees the green base, not the red top
});

// ── Mouse + UI: the options-bar Sample segment switches the mode ────
test("clicking the Sample ▸ Current Layer segment switches sampling to the active layer", async ({ page }) => {
  const m = await twoLayers(page);
  expect(await page.evaluate(() => (window as any).__mv.store.state.sampleMode)).toBe(0);
  await page.getByText("Current Layer", { exact: true }).click(); // options-bar segment
  expect(await page.evaluate(() => (window as any).__mv.store.state.sampleMode)).toBe(1);
  await page.mouse.click(m.cx(100), m.cy(70));
  expect(isGreen(await picked(page))).toBe(true); // now samples the active green base
});
