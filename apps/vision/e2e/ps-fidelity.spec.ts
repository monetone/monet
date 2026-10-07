import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop-fidelity regressions (2026-06-12 audit) ───────────
// Pins the UI-level fixes: marching-ants refresh, Delete/Backspace = Clear,
// paint strokes marking the document dirty, rich text-run preservation,
// text move re-anchoring, History-panel dedup, and per-doc mask-edit mode.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("marching ants follow a REPLACED selection (not just select/deselect)", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.newDocument(160, 120, "ants");
    const E = mv.engine.engine; // read AFTER newDocument — it swaps the engine
    const raf = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const overlay = document.querySelectorAll("canvas")[1] as HTMLCanvasElement;
    const antsBounds = () => {
      const d = overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data;
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < overlay.height; y++) {
        for (let x = 0; x < overlay.width; x++) {
          if (d[(y * overlay.width + x) * 4 + 3] > 0) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      return { x0, x1, y0, y1 };
    };
    E.select_rect(10, 10, 20, 20, 0);
    mv.engine.sync();
    await raf();
    const first = antsBounds();
    // Replace the active selection with a different one — the boolean
    // selectionActive stays true; only selectionGen sees the change.
    E.select_rect(100, 60, 40, 40, 0);
    mv.engine.sync();
    await raf();
    const second = antsBounds();
    return { first, second, gen: mv.store.state.selectionGen };
  });
  expect(r.first.x1).toBeLessThanOrEqual(30);  // ants traced the 10,10,20,20 rect
  expect(r.second.x0).toBeGreaterThanOrEqual(99); // …and now trace the 100,60 rect
  expect(r.second.y0).toBeGreaterThanOrEqual(59);
  expect(r.gen).toBeGreaterThan(0);
});

test("marching ants animate only while a selection exists", async ({ page }) => {
  const frames = () => page.evaluate(async () => {
    const w = window as any;
    w.__antsFrames = 0;
    w.__antsRaf ??= w.requestAnimationFrame;
    w.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__antsFrames++; return w.__antsRaf(cb); };
    await new Promise((res) => setTimeout(res, 1000));
    return w.__antsFrames;
  });
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(160, 120, "idle"); mv.engine.engine.select_none(); mv.engine.sync(); });
  expect(await frames()).toBe(0);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.engine.engine.select_rect(10, 10, 20, 20, 0); mv.engine.sync(); });
  expect(await frames()).toBeGreaterThan(0);
});

test("Backspace = Edit ▸ Clear: selection → transparent; no-op without a selection", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 80, "clear");
    const E = mv.engine.engine; // read AFTER newDocument — it swaps the engine
    mv.store.addLayer();
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  // No selection: Backspace must change nothing (old behavior painted the
  // whole layer with the background color).
  await page.keyboard.press("Backspace");
  let r = await page.evaluate(() => (window as any).__mv.engine.engine.pick_color(40, 40) >>> 0);
  expect(r >>> 8).toBe(0xff0000);
  // With a selection: clears the selected pixels to transparency (white bg
  // below shows through).
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.select_rect(0, 0, 40, 80, 0);
    mv.engine.sync();
  });
  await page.keyboard.press("Backspace");
  r = await page.evaluate(() => (window as any).__mv.engine.engine.pick_color(20, 40) >>> 0);
  expect(r >>> 8).toBe(0xffffff);
  r = await page.evaluate(() => (window as any).__mv.engine.engine.pick_color(60, 40) >>> 0);
  expect(r >>> 8).toBe(0xff0000); // outside the selection untouched
  // One undo restores the cleared pixels.
  await page.evaluate(() => (window as any).__mv.store.undo());
  r = await page.evaluate(() => (window as any).__mv.engine.engine.pick_color(20, 40) >>> 0);
  expect(r >>> 8).toBe(0xff0000);
});

test("a paint stroke marks the document dirty (unsaved-changes guard)", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(300, 200, "paint");
    mv.store.setTool("brush");
  });
  const before = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return s.documents.find((d: any) => d.id === s.activeDocId).dirty;
  });
  expect(before).toBe(false);
  // Real pointer drag = a brush stroke on the canvas.
  const box = (await page.locator("canvas").first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 6, cy, { steps: 1 });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return {
      dirty: s.documents.find((d: any) => d.id === s.activeDocId).dirty,
      canUndo: s.canUndo,
    };
  });
  expect(after.canUndo).toBe(true); // the stroke really landed
  expect(after.dirty).toBe(true);   // …and flagged the document
});

test("typing into rich multi-run text preserves per-run formatting", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(420, 160, "runs");
    // Build a two-run layer: "RED" red + "BLUE" blue, then simulate typing
    // (the textarea path calls text.setText with the new full string).
    let spec = mv.text.defaultSpec("REDBLUE", { ax: 10, ay: 20, size: 56, color: [255, 0, 0, 255] });
    spec = { ...spec, runs: mv.text.applyRangeFormat(spec.runs, 3, 7, { color: [0, 0, 255, 255] }) };
    const id = mv.text.create(spec);
    const counts = () => {
      const E = mv.engine.engine;
      let red = 0, blue = 0;
      for (let y = 0; y < 160; y += 2) {
        for (let x = 0; x < 420; x += 2) {
          const c = E.pick_color(x, y) >>> 0;
          const [r, g, b, a] = [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
          if (a > 200 && r > 180 && g < 90 && b < 90) red++;
          if (a > 200 && b > 180 && g < 90 && r < 90) blue++;
        }
      }
      return { red, blue };
    };
    const before = counts();
    // Type an extra character in the middle (splice like the live editor).
    const cur = mv.text.get(id);
    mv.text.apply(id, mv.text.setText(cur, "REDXBLUE"));
    const after = counts();
    const runs = mv.text.get(id).runs.length;
    return { before, after, runs };
  });
  expect(r.before.red).toBeGreaterThan(20);
  expect(r.before.blue).toBeGreaterThan(20);
  // Both colors must survive the edit (the old setText flattened all runs to red).
  expect(r.after.red).toBeGreaterThan(20);
  expect(r.after.blue).toBeGreaterThan(20);
  expect(r.runs).toBeGreaterThanOrEqual(2);
});

test("moving a type layer re-anchors it: a later edit keeps the moved position", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(400, 200, "tmove");
    mv.text.create(mv.text.defaultSpec("Drift", { ax: 20, ay: 30, size: 48, color: [255, 0, 0, 255] }));
    mv.store.setTool("move");
  });
  // Drag the layer right by ~90px with a real pointer drag.
  const box = (await page.locator("canvas").first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 9; i++) await page.mouse.move(cx + i * 10, cy, { steps: 1 });
  await page.mouse.up();
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    const bboxX0 = () => {
      let x0 = 1e9;
      for (let y = 0; y < 200; y += 2) {
        for (let x = 0; x < 400; x += 2) {
          if (((E.pick_color(x, y) >>> 0) >>> 8) === 0xff0000 && x < x0) x0 = x;
        }
      }
      return x0;
    };
    const moved = bboxX0();
    const spec = mv.text.get(id);
    // A later spec edit (e.g. the toolbar's bold toggle) must NOT snap the
    // glyphs back to the pre-move anchor.
    mv.text.apply(id, { ...spec, bold: true });
    const afterEdit = bboxX0();
    return { ax: spec.ax, moved, afterEdit };
  });
  expect(r.moved).toBeGreaterThan(60);            // the drag landed
  expect(r.ax).toBeGreaterThan(60);               // the spec anchor moved with it
  expect(Math.abs(r.afterEdit - r.moved)).toBeLessThanOrEqual(6); // no snap-back
});

test("History panel doesn't duplicate rows on plain re-syncs", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "hist");
    mv.store.addLayer();
    const after = mv.store.state.history.length;
    // Layer clicks re-sync but push no history state.
    mv.store.selectLayer(mv.store.state.layers[1].id);
    mv.store.selectLayer(mv.store.state.layers[0].id);
    mv.store.selectLayer(mv.store.state.layers[1].id);
    return { after, end: mv.store.state.history.length, last: mv.store.state.history.at(-1) };
  });
  expect(r.end).toBe(r.after); // no duplicate "New Layer" rows
});

test("mask-edit mode does not leak across document tabs", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, s = mv.store;
    s.newDocument(80, 80, "A");
    s.addLayerMask(s.state.activeLayerId);
    s.maskEdit(true);
    const aId = s.state.activeDocId;
    s.newDocument(80, 80, "B");
    const inB = s.state.maskEdit;
    s.activateDoc(aId);
    const backInA = s.state.maskEdit;
    return { inB, backInA };
  });
  // Photoshop's channel targeting is per-document; a tab switch must never
  // silently re-target the brush onto another document's mask.
  expect(r.inB).toBe(false);
  expect(r.backInA).toBe(false);
});

test("noise/oil/spherize/twirl join the smart-filter stack on smart objects", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(96, 96, "smart");
    const E = mv.engine.engine; // read AFTER newDocument — it swaps the engine
    const id = mv.store.state.activeLayerId;
    E.select_all(); E.fill_selection(120, 120, 120, 255); E.select_none();
    mv.smart.convert(id);
    mv.fil.noise(0.3, false);
    mv.distort.twirl(45);
    mv.neural.oilPaint(2.5, 5, 3, 5, 0, 2);
    mv.fil.gaussian(1);
    return { kind: E.layer_kind(id), count: E.smart_filter_count(id) };
  });
  expect(r.kind).toBe(7);
  // All four landed as NON-destructive smart filters (noise/twirl/oil used to
  // bake into the pixels and get wiped by the next stack re-render).
  expect(r.count).toBe(4);
});

test("Deselect with no selection is a true no-op (redo chain survives)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "noop");
    const E = mv.engine.engine; // read AFTER newDocument — it swaps the engine
    mv.store.addLayer();
    mv.store.undo();
    const before = E.can_redo();
    mv.store.deselect(); // nothing selected — Photoshop disables this entirely
    return { before, after: E.can_redo() };
  });
  expect(r.before).toBe(true);
  expect(r.after).toBe(true);
});

test("undo restores document geometry after crop/resize (no trap, exact pixels)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 90, "geo");
    const E = mv.engine.engine; // read AFTER newDocument — it swaps the engine
    E.select_rect(10, 10, 30, 20, 0); E.fill_selection(200, 40, 40, 255); E.select_none();
    mv.engine.commit();
    const before = { w: E.width(), h: E.height(), px: E.pick_color(15, 15) >>> 0 };
    mv.xform.resizeImage(240, 180);
    mv.store.undo();
    const afterResizeUndo = { w: E.width(), h: E.height(), px: E.pick_color(15, 15) >>> 0 };
    mv.xform.crop(20, 20, 60, 40);
    mv.store.undo();
    const afterCropUndo = { w: E.width(), h: E.height(), px: E.pick_color(15, 15) >>> 0 };
    return { before, afterResizeUndo, afterCropUndo };
  });
  expect(r.afterResizeUndo).toEqual(r.before);
  expect(r.afterCropUndo).toEqual(r.before);
});
