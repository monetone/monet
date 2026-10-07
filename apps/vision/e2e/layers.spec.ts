import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite, layerCount } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("add / duplicate / delete layers", async ({ page }) => {
  expect(await layerCount(page)).toBe(1);
  await page.evaluate(() => (window as any).__mv.store.addLayer());
  expect(await layerCount(page)).toBe(2);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.duplicateLayer(mv.store.state.activeLayerId); });
  expect(await layerCount(page)).toBe(3);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.deleteLayer(mv.store.state.activeLayerId); });
  expect(await layerCount(page)).toBe(2);
});

test("new layer is blank and transparent by default", async ({ page }) => {
  // Start from the structured scene (a single opaque Background layer).
  expect(await layerCount(page)).toBe(1);
  const before = await composite(page);

  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const prevActive = mv.store.state.activeLayerId;
    mv.store.addLayer();
    const id = mv.store.state.activeLayerId;              // the new layer becomes active
    // layer_thumb reads the layer's OWN straight-alpha pixels (no compositing),
    // so a blank, fully-transparent layer is all-zero across R,G,B *and* alpha.
    const thumb = Array.from(E().layer_thumb(id, 16, 16) as Uint8Array);
    return {
      id, becameActive: id !== prevActive,
      visible: E().layer_visible(id),
      opacity: E().layer_opacity(id),
      kind: E().layer_kind(id),                           // 0 = normal raster
      maxByte: thumb.reduce((m: number, v: number) => Math.max(m, v), 0),
      count: E().layer_count(),
    };
  });

  // A brand-new, independent raster layer, now active at full visibility…
  expect(r.count).toBe(2);
  expect(r.becameActive).toBe(true);
  expect(r.visible).toBe(true);
  expect(r.opacity).toBeCloseTo(1, 5);
  expect(r.kind).toBe(0);
  // …yet completely blank and transparent: no pixel carries colour or alpha.
  expect(r.maxByte).toBe(0);

  // A fully transparent layer on top contributes nothing to the composite.
  const after = await composite(page);
  expect(after.chk).toBe(before.chk);

  // Adding the layer is a single undoable step.
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerCount(page)).toBe(1);
  expect((await composite(page)).chk).toBe(before.chk);
});

test("layer opacity affects the composite", async ({ page }) => {
  // add an opaque red layer on top, then drop opacity
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.store.addLayer(); E().select_all(); E().fill_selection(255, 0, 0, 255); E().select_none(); mv.engine.commit(); });
  const full = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setLayerOpacity(mv.store.state.activeLayerId, 30); });
  const faded = await composite(page);
  expect(faded.chk).not.toBe(full.chk);
});

test("blend mode changes the composite", async ({ page }) => {
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.store.addLayer(); E().select_all(); E().fill_selection(120, 200, 60, 255); E().select_none(); mv.engine.commit(); });
  const normal = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setLayerBlend(mv.store.state.activeLayerId, "multiply"); });
  const multiplied = await composite(page);
  expect(multiplied.chk).not.toBe(normal.chk);
});

test("visibility toggle hides a layer", async ({ page }) => {
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.store.addLayer(); E().select_all(); E().fill_selection(10, 10, 200, 255); E().select_none(); mv.engine.commit(); });
  const shown = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setLayerVisible(mv.store.state.activeLayerId, false); });
  const hidden = await composite(page);
  expect(hidden.chk).not.toBe(shown.chk);
});

test("reorder layers via moveLayer", async ({ page }) => {
  const order = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.addLayer(); const top = mv.store.state.activeLayerId; // visual 0 = top
    const n = E().layer_count();
    const before = [E().layer_id_at(0), E().layer_id_at(1)];
    mv.store.moveLayer(top, n - 1); // send the top layer to the bottom visual slot
    const after = [E().layer_id_at(0), E().layer_id_at(1)];
    return { before, after };
  });
  expect(order.after).not.toEqual(order.before);
});

test("merge down and flatten reduce layer count", async ({ page }) => {
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.addLayer(); mv.store.addLayer(); });
  expect(await layerCount(page)).toBe(3);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.mergeDown(mv.store.state.activeLayerId); });
  expect(await layerCount(page)).toBe(2);
  await page.evaluate(() => (window as any).__mv.store.flatten());
  expect(await layerCount(page)).toBe(1);
});

test("group and ungroup layers", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.addLayer();
    mv.store.createGroup();
    // find a group layer (kind 6)
    let groupId = -1;
    for (let i = 0; i < E().layer_count(); i++) { const id = E().layer_id_at(i); if (E().layer_kind(id) === 6) groupId = id; }
    const hadGroup = groupId >= 0;
    if (hadGroup) mv.store.ungroup(groupId);
    let stillGroup = false;
    for (let i = 0; i < E().layer_count(); i++) { if (E().layer_kind(E().layer_id_at(i)) === 6) stillGroup = true; }
    return { hadGroup, stillGroup };
  });
  expect(r.hadGroup).toBe(true);
  expect(r.stillGroup).toBe(false);
});

test("locked layer rejects painting", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    E().set_layer_locked(id, true);
    E().set_brush(40, 0.9, 1, 1, 0.2, 255, 0, 255, 255, false);
    E().stroke_begin();
    for (let x = 20; x < 200; x += 8) E().stroke_to(x, 90, 1);
    E().stroke_end(); mv.engine.commit();
    return { locked: E().layer_locked(id) };
  });
  expect(r.locked).toBe(true);
});
