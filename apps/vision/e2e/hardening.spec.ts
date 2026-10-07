import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// Verifies the security/robustness hardening from the codebase review:
//   • project save/open fidelity (v4: mode + depth + animation frames)
//   • malformed / oversized project input is rejected, never panics the engine
//   • layer property edits (opacity/visibility/blend) are undoable
//   • Add Noise is macro-recorded

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
});

test("project round-trip preserves color mode, bit depth and animation frames", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(64, 48, "rt");
    E().set_mode(2);  // CMYK
    E().set_depth(16);
    E().add_frame();
    E().add_frame();
    E().add_frame();
    const bytes = mv.store.saveProject();
    mv.store.openProject(bytes, "rt");
    return { mode: E().doc_mode(), depth: E().doc_depth(), frames: E().frame_count() };
  });
  expect(r).toEqual({ mode: 2, depth: 16, frames: 3 });
});

test("malformed and oversized projects are rejected without poisoning the engine", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "ok");
    const tryOpen = (bytes: Uint8Array) => {
      try { mv.store.openProject(bytes, "x"); return false; } catch { return true; }
    };
    // truncated valid project
    const good = mv.store.saveProject();
    const truncated = good.slice(0, Math.floor(good.length / 2));
    const threwTrunc = tryOpen(truncated);
    // random garbage
    const threwGarbage = tryOpen(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    // well-formed header with oversized dimensions
    const hdr = new Uint8Array(28);
    const dv = new DataView(hdr.buffer);
    hdr.set([77, 86, 83, 78], 0); // "MVSN"
    dv.setUint32(4, 4, true);       // version
    dv.setUint32(8, 100000, true);  // w  (> MAX_DIM)
    dv.setUint32(12, 100000, true); // h
    dv.setUint32(16, 0, true);
    dv.setUint32(20, 1, true);
    dv.setUint32(24, 1, true);
    const threwBig = tryOpen(hdr);
    // the engine must still be alive and usable after the rejected loads
    const stillWorks = E().layer_count() >= 1 && E().width() === 32;
    return { threwTrunc, threwGarbage, threwBig, stillWorks };
  });
  expect(r.threwTrunc).toBe(true);
  expect(r.threwGarbage).toBe(true);
  expect(r.threwBig).toBe(true);
  expect(r.stillWorks).toBe(true);
});

test("layer opacity / visibility / blend mode are undoable", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "u");
    mv.store.addLayer();
    const id = mv.store.state.activeLayerId;

    // opacity: a whole "drag" (many calls) coalesces to a single undo step
    for (let p = 90; p >= 50; p -= 10) mv.store.setLayerOpacity(id, p);
    const opDrag = E().layer_opacity(id);
    mv.store.undo();
    const opUndone = E().layer_opacity(id);

    // visibility
    mv.store.setHistoryOptions({ layerVisibilityUndoable: true });
    mv.store.setLayerVisible(id, false);
    const visSet = E().layer_visible(id);
    mv.store.undo();
    const visUndone = E().layer_visible(id);

    // blend mode
    mv.store.setLayerBlend(id, "multiply");
    const blendSet = E().layer_blend(id);
    mv.store.undo();
    const blendUndone = E().layer_blend(id);

    return { opDrag, opUndone, visSet, visUndone, blendSet, blendUndone };
  });
  expect(r.opDrag).toBeCloseTo(0.5, 2);
  expect(r.opUndone).toBeCloseTo(1.0, 2); // one undo reverts the whole drag
  expect(r.visSet).toBe(false);
  expect(r.visUndone).toBe(true);
  expect(r.blendSet).not.toBe(0);
  expect(r.blendUndone).toBe(0); // back to Normal
});

test("a second opacity drag after an undo is its own undo step (no stale coalescing)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "u2");
    mv.store.addLayer();
    const id = mv.store.state.activeLayerId;
    for (let p = 90; p >= 50; p -= 10) mv.store.setLayerOpacity(id, p); // drag 1 → 0.5
    mv.store.undo(); // revert drag 1 (must clear the coalescing chain)
    const afterUndo1 = E().layer_opacity(id);
    for (let p = 40; p >= 20; p -= 10) mv.store.setLayerOpacity(id, p); // drag 2 → 0.2
    const drag2 = E().layer_opacity(id);
    mv.store.undo(); // must revert drag 2 (it has to be a distinct, recoverable step)
    const afterUndo2 = E().layer_opacity(id);
    return { afterUndo1, drag2, afterUndo2 };
  });
  expect(r.afterUndo1).toBeCloseTo(1.0, 2);
  expect(r.drag2).toBeCloseTo(0.2, 2);
  expect(r.afterUndo2).toBeCloseTo(1.0, 2); // drag 2 was undoable, not silently lost
});

test("Add Noise is macro-recorded", async ({ page }) => {
  const count = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "rec");
    mv.actions.start();
    mv.fil.noise(20, false);
    const c = mv.actions.count();
    mv.actions.stop();
    return c;
  });
  expect(count).toBe(1);
});
