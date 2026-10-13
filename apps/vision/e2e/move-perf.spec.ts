import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Move-tool drag performance ─────────────────────────────────
// Dragging a layer with the Move tool used to call `set_layer_offset`,
// which did a FULL-document `composite()` plus a full-canvas `putImageData`
// on every pointermove — ~2 fps on a 1280×800 doc with a couple of layers.
//
// The fast path (`move_layer_offset`) recomposites and reblits only the
// union of the layer's old and new content bounding boxes, so dragging a
// small text layer touches a tiny region regardless of canvas size. These
// tests pin: (1) the dirty region stays small, (2) the region path is
// pixel-identical to a full composite, and (3) it is both far faster than
// the old full-composite path and fast enough for 60 fps.

// Build a large doc with an opaque background layer + a small text layer,
// returns { w, h, bg, txt } (layer ids) with the text layer active.
const SETUP = `(mv) => {
  mv.store.newDocument(1280, 800, "perf");
  const E = mv.engine.e;
  // paint the background layer opaque so moves reveal/cover real pixels
  E.select_all(); E.fill_selection(40, 60, 90, 255); E.select_none();
  const bg = mv.store.state.activeLayerId;
  const spec = mv.text.defaultSpec("Drag me", { ax: 200, ay: 200, color: [255, 240, 200, 255], size: 64 });
  const txt = mv.text.create(spec);
  mv.engine.commit();
  return { w: E.width(), h: E.height(), bg, txt };
}`;

// Position-weighted checksum of the engine's composited output buffer,
// read straight out of wasm memory (rebuilt fresh — memory can relocate).
const CHK_OUTPUT = `(mv) => {
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

test("dragging a text layer recomposites only its bounding box, not the whole canvas", async ({ page }) => {
  const r = await page.evaluate(({ setup }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const { w, h, txt } = new Function("mv", "E", `return (${setup})(mv, E);`)(mv, E());
    // move the text layer 6px right — dirty rect should be ~the text bbox
    const rect = E().move_layer_offset(txt, 6, 0) as Int32Array;
    return { w, h, rx: rect[0], ry: rect[1], rw: rect[2], rh: rect[3] };
  }, { setup: SETUP });

  // a real region was returned
  expect(r.rw).toBeGreaterThan(0);
  expect(r.rh).toBeGreaterThan(0);
  // and it is a SMALL fraction of the canvas — the text occupies only a
  // little corner of the 1280×800 doc. The old full path touched 100%.
  const frac = (r.rw * r.rh) / (r.w * r.h);
  expect(frac).toBeLessThan(0.15);
  // the dirty rect must be strictly smaller than the full canvas
  expect(r.rw).toBeLessThan(r.w);
  expect(r.rh).toBeLessThan(r.h);
});

test("region-composite move is pixel-identical to a full composite", async ({ page }) => {
  const r = await page.evaluate(({ setup, chk }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const { txt } = new Function("mv", "E", `return (${setup})(mv, E);`)(mv, E());
    // eslint-disable-next-line no-new-func
    const checksum = new Function("mv", `return (${chk})(mv);`);
    // simulate a drag: many small region-composite steps
    for (let i = 1; i <= 40; i++) E().move_layer_offset(txt, i * 3, (i % 7) - 3);
    const viaRegion = checksum(mv);
    // now force a full composite of the SAME final state
    E().composite();
    const viaFull = checksum(mv);
    return { viaRegion, viaFull };
  }, { setup: SETUP, chk: CHK_OUTPUT });

  // the incrementally region-composited buffer must equal the full composite
  expect(r.viaRegion).toBe(r.viaFull);
});

test("move throughput is far faster than full composite and hits 60 fps", async ({ page }) => {
  const r = await page.evaluate(({ setup }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const { txt } = new Function("mv", "E", `return (${setup})(mv, E);`)(mv, E());
    const N = 120;

    // Baseline: the OLD path — full composite + full blit per frame.
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      E().set_layer_offset(txt, (i % 200) + 1, 0); // also full-composites
      mv.engine.blit();
    }
    const tFull = performance.now() - t0;

    // reset back to origin so the fast path starts clean
    E().set_layer_offset(txt, 0, 0);

    // New path: region composite + region blit per frame (what the Move
    // tool's drag handler now does).
    const t1 = performance.now();
    for (let i = 0; i < N; i++) {
      const rect = E().move_layer_offset(txt, (i % 200) + 1, 0) as Int32Array;
      if (rect[2] > 0 && rect[3] > 0) mv.engine.blitRegion(rect[0], rect[1], rect[2], rect[3]);
    }
    const tRegion = performance.now() - t1;

    return { N, tFull, tRegion, msFull: tFull / N, msRegion: tRegion / N };
  }, { setup: SETUP });

  console.log(`move perf: full=${r.msFull.toFixed(2)}ms/frame  region=${r.msRegion.toFixed(2)}ms/frame  (${(r.tFull / r.tRegion).toFixed(1)}× faster)`);

  // 60 fps gate: each dragged frame must fit in a 16.6ms budget (with margin).
  expect(r.msRegion).toBeLessThan(16);
  // structural, machine-independent gate: the region path does a tiny
  // fraction of the per-frame work of the old full-composite path.
  expect(r.tRegion * 6).toBeLessThan(r.tFull);
});

test("a real Move-tool pointer drag relocates the active layer (CanvasView wiring)", async ({ page }) => {
  // Build a small doc with a text layer and arm the Move tool.
  await page.evaluate(({ setup }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const built = new Function("mv", "E", `return (${setup})(mv, E);`)(mv, E());
    mv.store.selectLayer(built.txt);
    mv.store.setTool("move");
  }, { setup: SETUP });

  const before = await page.evaluate(({ chk }) => {
    const mv = (window as any).__mv;
    // eslint-disable-next-line no-new-func
    return new Function("mv", `return (${chk})(mv);`)(mv);
  }, { chk: CHK_OUTPUT });

  // Drive a real pointer drag across the document canvas.
  const box = await page.locator("canvas").first().boundingBox();
  expect(box).not.toBeNull();
  const b = box!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 8, cy + i * 2, { steps: 1 });
  await page.mouse.up();

  const after = await page.evaluate(({ chk }) => {
    const mv = (window as any).__mv;
    // eslint-disable-next-line no-new-func
    return new Function("mv", `return (${chk})(mv);`)(mv);
  }, { chk: CHK_OUTPUT });

  // the drag moved the layer → composite changed
  expect(after).not.toBe(before);

  // and it is a single, undoable Move step that restores the original pixels
  const restored = await page.evaluate(({ chk }) => {
    const mv = (window as any).__mv;
    mv.store.undo();
    mv.engine.engine.composite();
    // eslint-disable-next-line no-new-func
    return new Function("mv", `return (${chk})(mv);`)(mv);
  }, { chk: CHK_OUTPUT });
  expect(restored).toBe(before);
});
