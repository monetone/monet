import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Move a layer that has blending options (layer effects) ─────────
// Dragging an effects-bearing layer used to fall back to a FULL composite
// per pointer step, and — worse — `ensure_fx` rebuilt the coverage with the
// layer's offset baked in, so the effect's signature changed every frame and
// the drop-shadow/glow blur RE-RENDERED on every step (~1 fps on a big doc).
//
// The fix makes the effect render translation-invariant (coverage read in the
// layer's local space; slots sampled at the offset) so a Move reuses the cached
// blur, and scopes the recomposite to the layer's content bbox UNIONED with the
// rendered effect extent (with the fx cache frozen). These tests pin:
//   (1) the drag path is pixel-identical to a full composite (footprint covers
//       the shadow, cached slots sample correctly at the new offset),
//   (2) a small move recomposites a sub-canvas region (not the whole canvas),
//   (3) a whole drag costs far less than re-blurring every frame.

// Doc with an opaque bg + an fx layer (drop shadow, sizable blur) whose content
// is a centred rectangle. Returns { id, w, h }.
const SETUP = `(mv) => {
  mv.store.newDocument(1200, 820, "movefx");
  const E = mv.engine.engine;
  E.select_all(); E.fill_selection(30, 40, 60, 255); E.select_none();   // opaque bg
  const id = E.add_layer("fx"); E.set_active_layer(id);
  E.select_rect(380, 300, 440, 240, 0); E.fill_selection(235, 205, 110, 255); E.select_none();
  // drop shadow (id 0): [on, blend(multiply=3), opacity, r,g,b, angle, distance, spread, size]
  mv.store.setEffect(id, 0, [1, 3, 0.8, 0, 0, 0, 135, 18, 0, 50]);
  mv.engine.commit();
  return { id, w: E.width(), h: E.height() };
}`;

// Position-weighted checksum of the composited output, read from wasm memory.
const CHK = `(mv) => {
  const E = mv.engine.engine;
  const w = E.width(), h = E.height();
  const buf = new Uint8Array(mv.engine.mem.buffer, E.output_ptr(), w * h * 4);
  let chk = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const p = (i >> 2) + 1;
    chk = (chk + p * (buf[i] * 3 + buf[i + 1] * 5 + buf[i + 2] * 7 + buf[i + 3] * 11)) % 2147483647;
  }
  return chk;
}`;

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
});

test("dragging an fx layer is pixel-identical to a full composite (shadow follows, no remnants)", async ({ page }) => {
  const r = await page.evaluate(({ setup, chk }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const { id } = new Function("mv", `return (${setup})(mv);`)(mv);
    // eslint-disable-next-line no-new-func
    const checksum = new Function("mv", `return (${chk})(mv);`) as (mv: any) => number;

    // Simulate a drag: many incremental region-composite steps, ending at (DX,DY).
    const DX = 160, DY = 90;
    for (let s = 1; s <= 24; s++) {
      E().move_layer_offset(id, Math.round((DX * s) / 24), Math.round((DY * s) / 24));
    }
    const dragChk = checksum(mv);

    // Ground truth: a full recomposite at the SAME final offset (rebuilds fx,
    // composites every pixel — fx cache is not frozen here).
    E().composite();
    const fullChk = checksum(mv);

    return { dragChk, fullChk };
  }, { setup: SETUP, chk: CHK });

  // The region + frozen-cache drag path matches the full composite exactly.
  expect(r.dragChk).toBe(r.fullChk);
});

test("a small move of an fx layer recomposites a sub-canvas region, not the whole canvas", async ({ page }) => {
  const r = await page.evaluate(({ setup }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const { id, w, h } = new Function("mv", `return (${setup})(mv);`)(mv);
    const rect = Array.from(E().move_layer_offset(id, 6, 4)) as number[]; // [x,y,w,h]
    return { rx: rect[0], ry: rect[1], rw: rect[2], rh: rect[3], w, h };
  }, { setup: SETUP });

  expect(r.rw).toBeGreaterThan(0);
  expect(r.rh).toBeGreaterThan(0);
  // The dirty rect is the layer's content + shadow extent + the 6×4 move — a
  // fraction of the 1200×820 canvas, and strictly smaller than the full canvas.
  expect(r.rw).toBeLessThan(r.w);
  expect(r.rh).toBeLessThan(r.h);
  expect((r.rw * r.rh) / (r.w * r.h)).toBeLessThan(0.7);
});

test("moving a TEXT layer with a 2px outside stroke is region-scoped and pixel-identical", async ({ page }) => {
  // The reported repro: a text layer carrying an outside Stroke effect. Text
  // layers store baked glyph pixels, so the offset-invariant fx cache + region
  // move apply just like a raster layer — pin it so it can't regress.
  const r = await page.evaluate(({ chk }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const W = 1400, H = 900;
    mv.store.newDocument(W, H, "txtstroke");
    const e = E();
    e.select_all(); e.fill_selection(30, 40, 60, 255); e.select_none();
    const id = mv.text.create(mv.text.defaultSpec("Hello Monet", { ax: 120, ay: 300, size: 72, color: [240, 230, 200, 255] }));
    // Stroke (id 9): [on, blend(0=normal), opacity, r,g,b, size(px), position(0=outside)]
    mv.store.setEffect(id, 9, [1, 0, 1, 1, 0, 0, 2, 0]);
    mv.engine.commit();
    // eslint-disable-next-line no-new-func
    const checksum = new Function("mv", `return (${chk})(mv);`) as (mv: any) => number;

    const rect = Array.from(e.move_layer_offset(id, 1, 1)) as number[];
    for (let s = 2; s <= 24; s++) e.move_layer_offset(id, s * 4, s * 3);
    const dragChk = checksum(mv);
    e.composite();
    const fullChk = checksum(mv);
    return { kind: e.layer_kind(id), hasFx: e.layer_has_effects(id), rect, W, H, dragChk, fullChk };
  }, { chk: CHK });

  expect(r.kind).toBe(2);            // text layer
  expect(r.hasFx).toBe(true);        // stroke applied
  // region-scoped: a 2px stroke on 72px text is a small fraction of the canvas
  expect((r.rect[2] * r.rect[3]) / (r.W * r.H)).toBeLessThan(0.2);
  // and the region-drag path matches a full composite exactly (stroke follows
  // the glyphs, no stale remnants left behind)
  expect(r.dragChk).toBe(r.fullChk);
});

test("a whole fx-layer drag costs far less than re-blurring each frame", async ({ page }) => {
  const r = await page.evaluate(({ setup }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const { id } = new Function("mv", `return (${setup})(mv);`)(mv);

    // A single full effect render (set_layer_effect invalidates + re-blurs) is
    // the per-frame cost the OLD move path paid. Measure one as a yardstick.
    let t0 = performance.now();
    E().set_layer_effect(id, 0, Float32Array.from([1, 3, 0.8, 0, 0, 0, 135, 18, 0, 51]));
    const oneRenderMs = performance.now() - t0;

    // A 40-step drag on the fx layer.
    t0 = performance.now();
    for (let s = 1; s <= 40; s++) E().move_layer_offset(id, s * 3, s * 2);
    const dragMs = performance.now() - t0;

    return { oneRenderMs, dragMs };
  }, { setup: SETUP });

  // The whole 40-step drag costs less than ~6 single effect re-renders — i.e.
  // the per-step blur re-render (which the old path did) is gone.
  expect(r.dragMs).toBeLessThan(r.oneRenderMs * 6);
});
