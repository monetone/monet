import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Image ▸ Reveal All ─────────────────────────────────────────────
// Adobe: Reveal All grows the canvas so all layer content that hangs off the
// edges becomes visible (the inverse of Crop/Trim). Vision layers are w*h buffers
// carried at a per-layer (ox,oy) offset, so a moved layer keeps its off-canvas
// pixels; engine.reveal_all() unions every layer's box with the canvas and bakes
// the offsets into the grown buffer. No-op when nothing extends beyond the canvas.
//   https://helpx.adobe.com/photoshop/using/changing-canvas-size.html

// Build a document with a solid-blue layer shifted `ox` px to the right so its
// right `ox` columns fall off the canvas.
async function setupOffsetLayer(page: Page, w: number, h: number, ox: number) {
  await page.evaluate(({ w, h, ox }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "revealall");
    const e = mv.engine.engine;
    const id = e.add_layer("Shifted");
    e.select_all();
    e.fill_selection(0, 0, 255, 255); // opaque blue on the new layer
    e.select_none();
    e.set_layer_offset(id, ox, 0); // push it right → off the right edge
    mv.engine.commit();
  }, { w, h, ox });
}

const pick = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => {
    const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 };
  }, { x, y });

const docSize = (page: Page) =>
  page.evaluate(() => {
    const d = (window as any).__mv.store.state.doc;
    return { w: d.width, h: d.height };
  });

test("Reveal All grows the canvas to show off-canvas content", async ({ page }) => {
  await gotoApp(page);
  await setupOffsetLayer(page, 30, 20, 8); // blue layer shifted +8 → cols 30..38 off-canvas
  await page.evaluate(() => (window as any).__mv.xform.revealAll());
  expect(await docSize(page)).toEqual({ w: 38, h: 20 }); // grew by the off-canvas amount
  const revealed = await pick(page, 35, 10); // formerly off-canvas → now shows the blue layer
  expect(revealed.b).toBeGreaterThan(200);
  expect(revealed.b).toBeGreaterThan(revealed.r);
  expect(revealed.b).toBeGreaterThan(revealed.g);
});

test("Reveal All is a no-op when nothing extends beyond the canvas", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(24, 24, "revealall-noop"));
  await page.evaluate(() => (window as any).__mv.xform.revealAll());
  expect(await docSize(page)).toEqual({ w: 24, h: 24 }); // unchanged
});
