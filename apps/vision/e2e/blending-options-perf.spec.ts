import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Blending Options drag performance ──────────────────────────
// Every Blending-Options slider tick used to run, SYNCHRONOUSLY and per tick:
// a full-document `composite()` (layer effects re-render their blurs because
// `set_layer_effect` invalidates the fx cache) + a full-canvas `putImageData`
// + a full UI `sync()` (which regenerates EVERY layer thumbnail via toDataURL).
// The Slider fires onChange continuously, so a single drag stacked dozens of
// these synchronous chains on the main thread → "unusable" (a single composite
// of a mid-size doc with a drop shadow is ~hundreds of ms here).
//
// The fix routes continuous drags through `store.setEffect(..., live=true)`,
// which coalesces to at most one composite + blit per animation frame (latest
// value wins) and defers the expensive UI sync to `flushLive()` on release.
//
// These tests pin: (1) a whole drag's worth of live ticks costs far less main-
// thread time than the old per-tick-composite path, and (2) the coalesced path
// converges to a pixel-identical composite with the correct final params.

// Mid-size doc + a partially-covered layer carrying a drop shadow, so each
// composite does real blur work. Returns the fx layer id. NOTE: newDocument
// swaps in a fresh engine, so read `mv.engine.engine` AFTER it (a reference
// captured before would be the orphaned boot engine).
const SETUP = `(mv) => {
  mv.store.newDocument(900, 620, "fxperf");
  const E = mv.engine.engine;
  E.select_all(); E.fill_selection(40, 60, 90, 255); E.select_none();      // opaque bg
  const fx = E.add_layer("fx");                                            // active on top
  E.select_rect(160, 110, 560, 380, 0); E.fill_selection(230, 210, 120, 255); E.select_none();
  // enable a drop shadow (id 0): [on, blend(multiply=3), opacity, r,g,b, angle, distance, spread, size]
  mv.store.setEffect(fx, 0, [1, 3, 0.75, 0, 0, 0, 120, 20, 0, 30]);
  mv.engine.commit();
  return fx;
}`;

// Drop-shadow params with a given blur Size (index 9 — the expensive slot).
const PARAMS = (size: number) => [1, 3, 0.75, 0, 0, 0, 120, 20, 0, size];

// Position-weighted checksum of the engine's composited output, read straight
// out of wasm memory (rebuilt fresh — the buffer can relocate on growth).
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

test("a live (coalesced) drag costs far less main-thread time than per-tick composites", async ({ page }) => {
  const r = await page.evaluate(({ setup, params }) => {
    const mv = (window as any).__mv;
    // eslint-disable-next-line no-new-func
    const fx: number = new Function("mv", `return (${setup})(mv);`)(mv);
    // eslint-disable-next-line no-new-func
    const mk = new Function("size", `return (${params})(size);`) as (s: number) => number[];

    const N = 16;
    const size = (i: number) => 16 + (i % N); // sweep the blur radius, like dragging "Size"

    // OLD path: every tick composites synchronously (live=false).
    let t0 = performance.now();
    for (let i = 0; i < N; i++) mv.store.setEffect(fx, 0, mk(size(i)), false);
    const nonLiveMs = performance.now() - t0;

    // NEW path: every tick only schedules a frame (live=true); the synchronous
    // loop does ZERO composites — they coalesce to the next rAF (latest wins).
    t0 = performance.now();
    for (let i = 0; i < N; i++) mv.store.setEffect(fx, 0, mk(size(i)), true);
    const liveMs = performance.now() - t0;

    mv.store.flushLive(); // finalize so we don't leak a pending frame
    return { nonLiveMs, liveMs, N };
  }, { setup: SETUP, params: PARAMS.toString() });

  // Sanity: the per-tick path did real, measurable composite work.
  expect(r.nonLiveMs).toBeGreaterThan(50);
  // The coalesced drag's synchronous cost is tiny in absolute terms — the user
  // feels a responsive drag regardless of doc size, because nothing composites
  // inside the loop.
  expect(r.liveMs).toBeLessThan(50);
  // …and it is dramatically cheaper than compositing on every tick.
  expect(r.liveMs).toBeLessThan(r.nonLiveMs / 5);
});

test("the coalesced path converges to a pixel-identical composite with the correct final params", async ({ page }) => {
  const r = await page.evaluate(({ setup, params, chk }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    const fx: number = new Function("mv", `return (${setup})(mv);`)(mv);
    // eslint-disable-next-line no-new-func
    const mk = new Function("size", `return (${params})(size);`) as (s: number) => number[];
    // eslint-disable-next-line no-new-func
    const checksum = new Function("mv", `return (${chk})(mv);`) as (mv: any) => number;

    const N = 16;
    const finalSize = 44;
    // simulate a drag that ends on finalSize
    for (let i = 0; i < N; i++) mv.store.setEffect(fx, 0, mk(16 + (i % N)), true);
    mv.store.setEffect(fx, 0, mk(finalSize), true); // the release value
    mv.store.flushLive();

    const liveChk = checksum(mv);
    const liveParams = Array.from(E().layer_effect_params(fx, 0)) as number[];

    // Now apply the SAME final params in one shot, non-live, and compare.
    mv.store.setEffect(fx, 0, mk(finalSize), false);
    const directChk = checksum(mv);

    return { liveChk, directChk, liveSize: liveParams[9], finalSize, hasFx: E().layer_has_effects(fx) };
  }, { setup: SETUP, params: PARAMS.toString(), chk: CHK });

  // The deferred/coalesced drag actually applied the effect (not a no-op)…
  expect(r.hasFx).toBe(true);
  // …left the engine in the exact final state…
  expect(r.liveSize).toBe(r.finalSize);
  // …and the composited pixels are identical to applying that value directly.
  expect(r.liveChk).toBe(r.directChk);
});
