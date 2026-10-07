import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("layer mask: add, paint, apply", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // top layer filled solid so masking is visible
    mv.store.addLayer(); const id = mv.store.state.activeLayerId;
    E().select_all(); E().fill_selection(220, 40, 40, 255); E().select_none(); mv.engine.commit();
    mv.store.addLayerMask(id); const hasMask = E().layer_has_mask(id);
    // paint into the mask (black hides) and check the composite changed
    E().set_mask_edit(true);
    E().set_brush(40, 0.9, 1, 1, 0.2, 0, 0, 0, 255, false);
    E().stroke_begin(); for (let x = 20; x < 230; x += 6) E().stroke_to(x, 96, 1); E().stroke_end();
    E().set_mask_edit(false); mv.engine.commit();
    return { hasMask };
  });
  expect(r.hasMask).toBe(true);
  // applying the mask keeps the layer but drops the mask
  const applied = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    mv.store.applyLayerMask(id);
    return { hasMask: E().layer_has_mask(id) };
  });
  expect(applied.hasMask).toBe(false);
});

test("adjustment layer is non-destructive and affects composite", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const before = E().layer_count();
    const id = mv.store.addAdjustmentLayer(4, new Float32Array(0), "Invert"); // kind 4 = invert
    return { added: E().layer_count() === before + 1, kind: E().layer_kind(id), id };
  });
  expect(r.added).toBe(true);
  expect(r.kind).toBe(1); // adjustment layer
});

test("adjustment layer params are editable", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.addAdjustmentLayer(0, new Float32Array([20, 10]), "Brightness"); // kind 0 brightness/contrast
    mv.store.setAdjustmentParams(id, new Float32Array([80, 40]));
  });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("text layer stores its string and kind", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const txt = "MonetE2E";
    const fontPx = 32;
    const c = document.createElement("canvas"); const ctx = c.getContext("2d")!;
    ctx.font = `${fontPx}px sans-serif`;
    const w = Math.max(1, Math.ceil(ctx.measureText(txt).width) + 6), h = Math.ceil(fontPx * 1.45);
    c.width = w; c.height = h; ctx.font = `${fontPx}px sans-serif`; ctx.textBaseline = "top"; ctx.fillStyle = "#ffffff"; ctx.fillText(txt, 3, 3);
    const data = ctx.getImageData(0, 0, w, h).data;
    mv.store.addLayer(); const id = mv.store.state.activeLayerId;
    E().set_text_layer(id, 20, 40, w, h, new Uint8Array(data), txt, fontPx, 255, 255, 255, 255);
    mv.engine.commit();
    return { kind: E().layer_kind(id), text: E().layer_text(id) };
  });
  expect(r.kind).toBe(2); // text layer
  expect(r.text).toBe("MonetE2E");
});

test("smart object: convert, add smart filter, clear", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    mv.smart.convert(id);
    const kind = E().layer_kind(id);
    mv.fil.gaussian(5); // routes to smart_add_filter for a smart object
    const filters = E().smart_filter_count(id);
    mv.smart.clearFilters(id);
    const cleared = E().smart_filter_count(id);
    return { kind, filters, cleared };
  });
  expect(r.kind).toBe(7); // smart object
  expect(r.filters).toBeGreaterThan(0);
  expect(r.cleared).toBe(0);
});

test("smart object: edit contents opens a source tab and updates the parent", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "smart-edit-parent", "transparent");
    E().select_rect(0, 0, 16, 32, 0); E().fill_selection(0, 0, 0, 255);
    E().select_rect(16, 0, 16, 32, 0); E().fill_selection(255, 255, 255, 255);
    E().select_none(); mv.engine.commit();

    const parentDocId = mv.store.state.activeDocId;
    const id = mv.store.state.activeLayerId;
    mv.smart.convert(id);
    mv.fil.gaussian(3);
    const filtersBefore = E().smart_filter_count(id);

    const editDocId = mv.smart.editContents();
    const binding = mv.smart.editedContentsBinding();
    const openedNames = mv.store.state.documents.map((d: { name: string }) => d.name);
    E().select_all(); E().fill_selection(0, 220, 0, 255); E().select_none(); mv.engine.commit();
    const updated = mv.smart.updateEditedContents();

    const c = E().pick_color(16, 16) >>> 0;
    return {
      parentDocId,
      editDocId,
      binding,
      openedNames,
      updated,
      activeDocId: mv.store.state.activeDocId,
      kind: E().layer_kind(id),
      filtersBefore,
      filtersAfter: E().smart_filter_count(id),
      rgb: [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255],
    };
  });
  expect(r.editDocId).not.toBeNull();
  expect(r.editDocId).not.toBe(r.parentDocId);
  expect(r.binding).toMatchObject({ editDocId: r.editDocId, parentDocId: r.parentDocId });
  expect(r.openedNames.some((name: string) => name.includes("smart-contents"))).toBe(true);
  expect(r.updated).toBe(true);
  expect(r.activeDocId).toBe(r.parentDocId);
  expect(r.kind).toBe(7);
  expect(r.filtersBefore).toBeGreaterThan(0);
  expect(r.filtersAfter).toBe(r.filtersBefore);
  expect(r.rgb[1]).toBeGreaterThan(180);
  expect(r.rgb[0]).toBeLessThan(80);
  expect(r.rgb[2]).toBeLessThan(80);
});

test("smart object: edited contents preserve transformed parent placement", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "smart-edit-transform-parent", "transparent");
    const id = mv.store.state.activeLayerId;
    E().select_rect(8, 8, 16, 16, 0);
    E().fill_selection(0, 0, 255, 255);
    E().select_none();
    mv.engine.commit();

    mv.smart.convert(id);
    mv.xform.transformLayer(0.5, 0.5, 0, 4, 0);
    const beforeBounds = Array.from(E().active_layer_bounds()) as number[];

    const parentDocId = mv.store.state.activeDocId;
    const editDocId = mv.smart.editContents();
    E().select_all();
    E().fill_selection(255, 0, 0, 255);
    E().select_none();
    mv.engine.commit();
    const updated = mv.smart.updateEditedContents();

    E().set_active_layer(id);
    const afterBounds = Array.from(E().active_layer_bounds()) as number[];
    const cx = afterBounds[0] + Math.floor(afterBounds[2] / 2);
    const cy = afterBounds[1] + Math.floor(afterBounds[3] / 2);
    const center = E().pick_color(cx, cy) >>> 0;
    const outside = E().pick_color(2, 2) >>> 0;
    return {
      parentDocId,
      editDocId,
      updated,
      activeDocId: mv.store.state.activeDocId,
      beforeBounds,
      afterBounds,
      centerRgb: [(center >>> 24) & 255, (center >>> 16) & 255, (center >>> 8) & 255],
      outsideRgb: [(outside >>> 24) & 255, (outside >>> 16) & 255, (outside >>> 8) & 255],
      outsideAlpha: outside & 255,
    };
  });
  expect(r.editDocId).not.toBeNull();
  expect(r.activeDocId).toBe(r.parentDocId);
  expect(r.updated).toBe(true);
  expect(r.beforeBounds[2]).toBeLessThan(16);
  expect(r.beforeBounds[3]).toBeLessThan(16);
  expect(r.afterBounds).toEqual(r.beforeBounds);
  expect(r.centerRgb[0]).toBeGreaterThan(180);
  expect(r.centerRgb[1]).toBeLessThan(80);
  expect(r.centerRgb[2]).toBeLessThan(80);
  expect(r.outsideRgb).toEqual([0, 0, 0]);
  expect(r.outsideAlpha).toBe(0);
});

test("smart object: transforms survive smart-filter rerenders", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(40, 40, "smart-transform-rerender", "transparent");
    const id = mv.store.state.activeLayerId;
    E().select_rect(10, 10, 20, 20, 0);
    E().fill_selection(0, 0, 255, 255);
    E().select_none();
    mv.engine.commit();

    mv.smart.convert(id);
    mv.xform.transformLayer(0.5, 0.5, 0, 4, 0);
    const beforeBounds = Array.from(E().active_layer_bounds()) as number[];
    E().smart_add_filter(id, 1, new Float32Array([0])); // no-op box blur forces render_smart
    mv.engine.commit();
    const afterFilterBounds = Array.from(E().active_layer_bounds()) as number[];
    const cx = afterFilterBounds[0] + Math.floor(afterFilterBounds[2] / 2);
    const cy = afterFilterBounds[1] + Math.floor(afterFilterBounds[3] / 2);
    const center = E().pick_color(cx, cy) >>> 0;
    mv.smart.resetTransform(id);
    const resetBounds = Array.from(E().active_layer_bounds()) as number[];
    return {
      beforeBounds,
      afterFilterBounds,
      resetBounds,
      centerRgb: [(center >>> 24) & 255, (center >>> 16) & 255, (center >>> 8) & 255],
    };
  });
  expect(r.beforeBounds[2]).toBeLessThan(20);
  expect(r.beforeBounds[3]).toBeLessThan(20);
  expect(r.afterFilterBounds).toEqual(r.beforeBounds);
  expect(r.centerRgb[2]).toBeGreaterThan(180);
  expect(r.centerRgb[0]).toBeLessThan(80);
  expect(r.centerRgb[1]).toBeLessThan(80);
  expect(r.resetBounds[2]).toBeGreaterThanOrEqual(20);
  expect(r.resetBounds[3]).toBeGreaterThanOrEqual(20);
});

test("smart object: skew and perspective transforms survive smart-filter rerenders", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(48, 48, "smart-projective-transform-rerender", "transparent");
    const id = mv.store.state.activeLayerId;
    E().select_rect(14, 14, 20, 20, 0);
    E().fill_selection(0, 0, 255, 255);
    E().select_none();
    mv.engine.commit();

    mv.smart.convert(id);
    const rawBounds = Array.from(E().active_layer_bounds()) as number[];

    E().skew_layer(24, 0);
    mv.engine.commit();
    const skewBounds = Array.from(E().active_layer_bounds()) as number[];
    E().smart_add_filter(id, 1, new Float32Array([0]));
    mv.engine.commit();
    const afterSkewFilterBounds = Array.from(E().active_layer_bounds()) as number[];

    mv.smart.resetTransform(id);
    E().perspective_transform(8, 10, 39, 6, 35, 40, 11, 35);
    mv.engine.commit();
    const perspectiveBounds = Array.from(E().active_layer_bounds()) as number[];
    E().smart_add_filter(id, 1, new Float32Array([0]));
    mv.engine.commit();
    const afterPerspectiveFilterBounds = Array.from(E().active_layer_bounds()) as number[];

    mv.smart.resetTransform(id);
    const resetBounds = Array.from(E().active_layer_bounds()) as number[];
    return {
      rawBounds,
      skewBounds,
      afterSkewFilterBounds,
      perspectiveBounds,
      afterPerspectiveFilterBounds,
      resetBounds,
    };
  });
  expect(r.skewBounds).not.toEqual(r.rawBounds);
  expect(r.afterSkewFilterBounds).toEqual(r.skewBounds);
  expect(r.perspectiveBounds).not.toEqual(r.rawBounds);
  expect(r.afterPerspectiveFilterBounds).toEqual(r.perspectiveBounds);
  expect(r.resetBounds).toEqual(r.rawBounds);
});

test("smart object: warp transforms survive smart-filter rerenders", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(40, 40, "smart-warp-transform-rerender", "transparent");
    const id = mv.store.state.activeLayerId;
    E().select_all();
    E().fill_selection(220, 0, 0, 255);
    E().select_none();
    mv.engine.commit();

    mv.smart.convert(id);
    const rawBounds = Array.from(E().active_layer_bounds()) as number[];
    mv.warpLayer({ style: "arc", bend: 0.4, h: 0, v: 0, orient: "h" });
    const warpBounds = Array.from(E().active_layer_bounds()) as number[];
    const bottomAlpha = (E().pick_color(20, 39) >>> 0) & 255;

    E().smart_add_filter(id, 1, new Float32Array([0]));
    mv.engine.commit();
    const afterFilterBounds = Array.from(E().active_layer_bounds()) as number[];
    const afterFilterBottomAlpha = (E().pick_color(20, 39) >>> 0) & 255;

    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "smart-warp-roundtrip.mvision");
    const loadedId = mv.store.state.activeLayerId;
    E().smart_clear_filters(loadedId);
    mv.engine.commit();
    const loadedBounds = Array.from(E().active_layer_bounds()) as number[];

    mv.smart.resetTransform(loadedId);
    const resetBounds = Array.from(E().active_layer_bounds()) as number[];
    return { rawBounds, warpBounds, afterFilterBounds, loadedBounds, resetBounds, bottomAlpha, afterFilterBottomAlpha };
  });
  expect(r.warpBounds).not.toEqual(r.rawBounds);
  expect(r.bottomAlpha).toBeLessThan(128);
  expect(r.afterFilterBounds).toEqual(r.warpBounds);
  expect(r.afterFilterBottomAlpha).toBeLessThan(128);
  expect(r.loadedBounds).toEqual(r.warpBounds);
  expect(r.resetBounds).toEqual(r.rawBounds);
});

test("smart object: saving edited contents updates the parent object", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "smart-save-parent", "transparent");
    E().select_all(); E().fill_selection(24, 24, 24, 255); E().select_none(); mv.engine.commit();

    const parentDocId = mv.store.state.activeDocId;
    const id = mv.store.state.activeLayerId;
    mv.smart.convert(id);

    const editDocId = mv.smart.editContents();
    E().select_all(); E().fill_selection(220, 32, 32, 255); E().select_none(); mv.engine.commit();
    const dirtyBefore = mv.store.state.documents.find((d: { id: number }) => d.id === editDocId)?.dirty;

    await mv.saveDocument();
    const c = E().pick_color(16, 16) >>> 0;
    const docs = mv.store.state.documents;
    return {
      parentDocId,
      editDocId,
      activeDocId: mv.store.state.activeDocId,
      editDirtyAfter: docs.find((d: { id: number }) => d.id === editDocId)?.dirty,
      dirtyBefore,
      kind: E().layer_kind(id),
      rgb: [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255],
    };
  });
  expect(r.editDocId).not.toBeNull();
  expect(r.dirtyBefore).toBe(true);
  expect(r.activeDocId).toBe(r.parentDocId);
  expect(r.editDirtyAfter).toBe(false);
  expect(r.kind).toBe(7);
  expect(r.rgb[0]).toBeGreaterThan(170);
  expect(r.rgb[1]).toBeLessThan(90);
  expect(r.rgb[2]).toBeLessThan(90);
});

test("smart object: open edited source tabs survive project save and reopen", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(32, 32, "smart-source-persist-parent", "transparent");
    E().select_all(); E().fill_selection(24, 24, 24, 255); E().select_none(); mv.engine.commit();

    const parentDocId = mv.store.state.activeDocId;
    const id = mv.store.state.activeLayerId;
    mv.smart.convert(id);

    const editDocId = mv.smart.editContents();
    E().select_all(); E().fill_selection(32, 220, 48, 255); E().select_none(); mv.engine.commit();
    const editDirtyBefore = mv.store.state.documents.find((d: { id: number }) => d.id === editDocId)?.dirty;

    mv.store.activateDoc(parentDocId);
    const saved = mv.saveProjectBytes(parentDocId);
    const wrapped = new TextDecoder().decode(saved.slice(0, 48)).startsWith("{");
    const parentBeforePacked = E().pick_color(16, 16) >>> 0;

    mv.store.openProject(saved, "smart-source-persist-roundtrip.mvision");
    const restoredParentDocId = mv.store.state.activeDocId;
    const restoredParentLayerId = mv.store.state.activeLayerId;
    const restoredDocs = mv.store.state.documents.map((d: { id: number; name: string; dirty: boolean }) => ({
      id: d.id,
      name: d.name,
      dirty: d.dirty,
      binding: mv.smart.editedContentsBindingForDoc(d.id),
    }));
    const restoredSource = restoredDocs.find((d: any) => d.binding?.parentDocId === restoredParentDocId);
    const restoredParentPacked = E().pick_color(16, 16) >>> 0;

    if (!restoredSource) {
      return {
        editDocId,
        editDirtyBefore,
        wrapped,
        parentBeforeRgb: [(parentBeforePacked >>> 24) & 255, (parentBeforePacked >>> 16) & 255, (parentBeforePacked >>> 8) & 255],
        restoredParentDocId,
        restoredParentLayerId,
        restoredDocs,
      };
    }

    mv.store.activateDoc(restoredSource.id);
    const sourcePacked = E().pick_color(16, 16) >>> 0;
    const savedUpdate = mv.smart.saveEditedContentsDoc(restoredSource.id);
    const parentAfterPacked = E().pick_color(16, 16) >>> 0;
    const docsAfter = mv.store.state.documents.map((d: { id: number; dirty: boolean }) => ({ id: d.id, dirty: d.dirty }));

    return {
      editDocId,
      editDirtyBefore,
      wrapped,
      parentBeforeRgb: [(parentBeforePacked >>> 24) & 255, (parentBeforePacked >>> 16) & 255, (parentBeforePacked >>> 8) & 255],
      restoredParentDocId,
      restoredParentLayerId,
      restoredDocs,
      restoredSource,
      restoredParentRgb: [(restoredParentPacked >>> 24) & 255, (restoredParentPacked >>> 16) & 255, (restoredParentPacked >>> 8) & 255],
      sourceRgb: [(sourcePacked >>> 24) & 255, (sourcePacked >>> 16) & 255, (sourcePacked >>> 8) & 255],
      savedUpdate,
      activeAfterUpdate: mv.store.state.activeDocId,
      sourceDirtyAfter: docsAfter.find((d: { id: number }) => d.id === restoredSource.id)?.dirty,
      parentAfterRgb: [(parentAfterPacked >>> 24) & 255, (parentAfterPacked >>> 16) & 255, (parentAfterPacked >>> 8) & 255],
    };
  });
  expect(r.editDocId).not.toBeNull();
  expect(r.editDirtyBefore).toBe(true);
  expect(r.wrapped).toBe(true);
  expect(r.parentBeforeRgb).toEqual([24, 24, 24]);
  expect(r.restoredSource).toBeTruthy();
  expect(r.restoredSource.binding).toMatchObject({ parentDocId: r.restoredParentDocId, parentLayerId: r.restoredParentLayerId });
  expect(r.restoredSource.name).toContain("smart-contents");
  expect(r.restoredSource.dirty).toBe(true);
  expect(r.restoredParentRgb).toEqual([24, 24, 24]);
  expect(r.sourceRgb![1]).toBeGreaterThan(170);
  expect(r.savedUpdate).toBe(true);
  expect(r.activeAfterUpdate).toBe(r.restoredParentDocId);
  expect(r.sourceDirtyAfter).toBe(false);
  expect(r.parentAfterRgb![1]).toBeGreaterThan(170);
  expect(r.parentAfterRgb![0]).toBeLessThan(90);
  expect(r.parentAfterRgb![2]).toBeLessThan(100);
});

test("smart object: nested edited source tabs survive project save and reopen", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };
    const fill = (r: number, g: number, b: number) => {
      E().select_all(); E().fill_selection(r, g, b, 255); E().select_none(); mv.engine.commit();
    };

    mv.store.newDocument(32, 32, "nested-smart-root", "transparent");
    fill(24, 24, 24);
    const rootDocId = mv.store.state.activeDocId;
    const rootLayerId = mv.store.state.activeLayerId;
    mv.smart.convert(rootLayerId);

    const sourceDocId = mv.smart.editContents();
    if (!sourceDocId) return { sourceDocId };
    const sourceLayerId = mv.store.state.activeLayerId;
    mv.smart.convert(sourceLayerId);

    const nestedDocId = mv.smart.editContents();
    if (!nestedDocId) return { sourceDocId, nestedDocId };
    fill(220, 48, 32);
    const nestedDirtyBefore = mv.store.state.documents.find((d: { id: number }) => d.id === nestedDocId)?.dirty;

    mv.store.activateDoc(rootDocId);
    const saved = mv.saveProjectBytes(rootDocId);
    const wrapped = new TextDecoder().decode(saved.slice(0, 48)).startsWith("{");

    mv.store.openProject(saved, "nested-smart-roundtrip.mvision");
    const restoredRootDocId = mv.store.state.activeDocId;
    const restoredDocs = mv.store.state.documents.map((d: { id: number; name: string; dirty: boolean }) => ({
      id: d.id,
      name: d.name,
      dirty: d.dirty,
      binding: mv.smart.editedContentsBindingForDoc(d.id),
    }));
    const restoredSource = restoredDocs.find((d: any) => d.binding?.parentDocId === restoredRootDocId);
    const restoredNested = restoredSource
      ? restoredDocs.find((d: any) => d.binding?.parentDocId === restoredSource.id)
      : null;

    const rootBefore = rgb();
    if (!restoredSource || !restoredNested) {
      return { sourceDocId, nestedDocId, nestedDirtyBefore, wrapped, restoredRootDocId, restoredDocs, rootBefore };
    }

    const nestedSaved = mv.smart.saveEditedContentsDoc(restoredNested.id);
    const activeAfterNestedSave = mv.store.state.activeDocId;
    const sourceAfterNestedSave = rgb();
    const sourceDirtyAfterNestedSave = mv.store.state.documents.find((d: { id: number }) => d.id === restoredSource.id)?.dirty;

    const sourceSaved = mv.smart.saveEditedContentsDoc(restoredSource.id);
    const activeAfterSourceSave = mv.store.state.activeDocId;
    const rootAfter = rgb();
    const nestedDirtyAfter = mv.store.state.documents.find((d: { id: number }) => d.id === restoredNested.id)?.dirty;
    const sourceDirtyAfter = mv.store.state.documents.find((d: { id: number }) => d.id === restoredSource.id)?.dirty;

    return {
      sourceDocId,
      nestedDocId,
      nestedDirtyBefore,
      wrapped,
      restoredRootDocId,
      restoredDocs,
      restoredSource,
      restoredNested,
      rootBefore,
      nestedSaved,
      activeAfterNestedSave,
      sourceAfterNestedSave,
      sourceDirtyAfterNestedSave,
      sourceSaved,
      activeAfterSourceSave,
      rootAfter,
      nestedDirtyAfter,
      sourceDirtyAfter,
    };
  });
  expect(r.sourceDocId).toBeTruthy();
  expect(r.nestedDocId).toBeTruthy();
  expect(r.nestedDirtyBefore).toBe(true);
  expect(r.wrapped).toBe(true);
  expect(r.restoredSource).toBeTruthy();
  expect(r.restoredNested).toBeTruthy();
  expect(r.restoredSource.binding).toMatchObject({ parentDocId: r.restoredRootDocId });
  expect(r.restoredNested.binding).toMatchObject({ parentDocId: r.restoredSource.id });
  expect(r.rootBefore).toEqual([24, 24, 24]);
  expect(r.nestedSaved).toBe(true);
  expect(r.activeAfterNestedSave).toBe(r.restoredSource.id);
  expect(r.sourceAfterNestedSave![0]).toBeGreaterThan(170);
  expect(r.sourceAfterNestedSave![1]).toBeLessThan(100);
  expect(r.sourceAfterNestedSave![2]).toBeLessThan(90);
  expect(r.sourceDirtyAfterNestedSave).toBe(true);
  expect(r.sourceSaved).toBe(true);
  expect(r.activeAfterSourceSave).toBe(r.restoredRootDocId);
  expect(r.rootAfter![0]).toBeGreaterThan(170);
  expect(r.rootAfter![1]).toBeLessThan(100);
  expect(r.rootAfter![2]).toBeLessThan(90);
  expect(r.nestedDirtyAfter).toBe(false);
  expect(r.sourceDirtyAfter).toBe(false);
});

test("smart object: closing dirty edited contents can save to parent and close the source tab", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return true; };
    try {
      mv.store.newDocument(32, 32, "smart-close-parent", "transparent");
      E().select_all(); E().fill_selection(24, 24, 24, 255); E().select_none(); mv.engine.commit();

      const parentDocId = mv.store.state.activeDocId;
      const id = mv.store.state.activeLayerId;
      mv.smart.convert(id);

      const editDocId = mv.smart.editContents();
      E().select_all(); E().fill_selection(24, 220, 48, 255); E().select_none(); mv.engine.commit();
      const dirtyBefore = mv.store.state.documents.find((d: { id: number }) => d.id === editDocId)?.dirty;
      const closed = await mv.closeDocumentTab(editDocId);
      const c = E().pick_color(16, 16) >>> 0;
      return {
        closed,
        prompts,
        parentDocId,
        editDocId,
        activeDocId: mv.store.state.activeDocId,
        dirtyBefore,
        docs: mv.store.state.documents.map((d: { id: number; name: string }) => ({ id: d.id, name: d.name })),
        bindingAfter: mv.smart.editedContentsBindingForDoc(editDocId),
        rgb: [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255],
      };
    } finally {
      window.confirm = originalConfirm;
    }
  });
  expect(r.dirtyBefore).toBe(true);
  expect(r.closed).toBe(true);
  expect(r.prompts).toHaveLength(1);
  expect(r.prompts[0]).toContain("update the parent Smart Object");
  expect(r.docs.map((d: { id: number }) => d.id)).not.toContain(r.editDocId);
  expect(r.bindingAfter).toBeNull();
  expect(r.activeDocId).toBe(r.parentDocId);
  expect(r.rgb[1]).toBeGreaterThan(170);
  expect(r.rgb[0]).toBeLessThan(90);
  expect(r.rgb[2]).toBeLessThan(100);
});

test("smart object: canceling the close prompt keeps dirty edited contents open", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return false; };
    try {
      mv.store.newDocument(32, 32, "smart-close-cancel-parent", "transparent");
      E().select_all(); E().fill_selection(24, 24, 24, 255); E().select_none(); mv.engine.commit();

      const parentDocId = mv.store.state.activeDocId;
      const id = mv.store.state.activeLayerId;
      mv.smart.convert(id);

      const editDocId = mv.smart.editContents();
      E().select_all(); E().fill_selection(220, 48, 24, 255); E().select_none(); mv.engine.commit();
      const closed = await mv.closeDocumentTab(editDocId);
      const docs = mv.store.state.documents.map((d: { id: number; dirty: boolean }) => ({ id: d.id, dirty: d.dirty }));
      const activeAfterClose = mv.store.state.activeDocId;
      mv.store.activateDoc(parentDocId);
      const c = E().pick_color(16, 16) >>> 0;
      return {
        closed,
        prompts,
        parentDocId,
        editDocId,
        activeAfterClose,
        docs,
        bindingAfter: mv.smart.editedContentsBindingForDoc(editDocId),
        rgb: [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255],
      };
    } finally {
      window.confirm = originalConfirm;
    }
  });
  expect(r.closed).toBe(false);
  expect(r.prompts).toHaveLength(2);
  expect(r.prompts[0]).toContain("update the parent Smart Object");
  expect(r.prompts[1]).toContain("without updating its parent Smart Object");
  expect(r.docs.map((d: { id: number }) => d.id)).toContain(r.editDocId);
  expect(r.docs.find((d: { id: number }) => d.id === r.editDocId)?.dirty).toBe(true);
  expect(r.bindingAfter).toMatchObject({ editDocId: r.editDocId, parentDocId: r.parentDocId });
  expect(r.activeAfterClose).toBe(r.editDocId);
  expect(r.rgb).toEqual([24, 24, 24]);
});

test("smart object: linked source metadata can go missing, relink, and embed", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const png = async (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };

    mv.store.newDocument(32, 32, "smart-linked-parent", "transparent");
    E().select_all(); E().fill_selection(24, 24, 24, 255); E().select_none(); mv.engine.commit();
    const id = mv.store.state.activeLayerId;

    const linked = mv.smart.convertToLinkedFromBytes(await png(24, 80, 220), "blue-source.png", "/tmp/blue-source.png");
    const afterLink = mv.smart.linkedInfo(id);
    const blue = rgb();
    const missingMarked = mv.smart.markLinkedMissing(id, true);
    const missing = mv.smart.linkedInfo(id);

    const relinked = mv.smart.relinkContentsFromBytes(await png(24, 220, 64), "green-source.png", "/tmp/green-source.png");
    const afterRelink = mv.smart.linkedInfo(id);
    const green = rgb();
    const listed = mv.smart.linkedObjects();

    const embedded = mv.smart.embedLinked(id);
    const afterEmbed = mv.smart.linkedInfo(id);
    return {
      linked,
      afterLink,
      blue,
      missingMarked,
      missing,
      relinked,
      afterRelink,
      green,
      listed,
      embedded,
      afterEmbed,
      kind: E().layer_kind(id),
    };
  });
  expect(r.linked).toBe(true);
  expect(r.afterLink).toMatchObject({ name: "blue-source.png", path: "/tmp/blue-source.png", missing: false });
  expect(r.blue[2]).toBeGreaterThan(170);
  expect(r.missingMarked).toBe(true);
  expect(r.missing).toMatchObject({ name: "blue-source.png", missing: true });
  expect(r.relinked).toBe(true);
  expect(r.afterRelink).toMatchObject({ name: "green-source.png", path: "/tmp/green-source.png", missing: false });
  expect(r.green[1]).toBeGreaterThan(170);
  expect(r.green[2]).toBeLessThan(120);
  expect(r.listed).toHaveLength(1);
  expect(r.embedded).toBe(true);
  expect(r.afterEmbed).toBeNull();
  expect(r.kind).toBe(7);
});

test("smart object: update modified linked content preserves source identity", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const png = async (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };

    mv.store.newDocument(32, 32, "smart-update-linked", "transparent");
    E().select_all(); E().fill_selection(18, 18, 18, 255); E().select_none(); mv.engine.commit();
    const id = mv.store.state.activeLayerId;
    const linked = mv.smart.convertToLinkedFromBytes(await png(32, 72, 220), "source-a.png", "/linked/source-a.png");
    const original = mv.smart.linkedInfo(id);
    const blue = rgb();
    const missingMarked = mv.smart.markLinkedMissing(id, true);
    const updated = mv.smart.updateLinkedContentsFromBytes(await png(32, 220, 72), id);
    const afterUpdate = mv.smart.linkedInfo(id);
    const green = rgb();
    const listed = mv.smart.linkedObjects();
    return { linked, original, blue, missingMarked, updated, afterUpdate, green, listed };
  });
  expect(r.linked).toBe(true);
  expect(r.original).toMatchObject({ name: "source-a.png", path: "/linked/source-a.png", missing: false });
  expect(r.blue[2]).toBeGreaterThan(170);
  expect(r.missingMarked).toBe(true);
  expect(r.updated).toBe(true);
  expect(r.afterUpdate).toMatchObject({ name: "source-a.png", path: "/linked/source-a.png", missing: false });
  expect(r.afterUpdate.updatedAt).toBeGreaterThanOrEqual(r.original.updatedAt);
  expect(r.green[1]).toBeGreaterThan(170);
  expect(r.green[2]).toBeLessThan(120);
  expect(r.listed).toHaveLength(1);
});

test("smart object: update modified linked content can refresh from stored path", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const files = new Map<string, Uint8Array>();
    const alerts: string[] = [];
    const originalAlert = window.alert;
    const png = async (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };

    window.alert = (message?: string) => { alerts.push(String(message)); };
    mv.smart.setLinkedSourceReaderForTests(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing test linked source: ${path}`);
      return bytes;
    });

    try {
      mv.store.newDocument(32, 32, "smart-path-refresh", "transparent");
      E().select_all(); E().fill_selection(12, 12, 12, 255); E().select_none(); mv.engine.commit();
      const id = mv.store.state.activeLayerId;
      const path = "/linked/live-source.png";
      files.set(path, await png(32, 72, 220));
      const linked = mv.smart.convertToLinkedFromBytes(files.get(path)!, "live-source.png", path);
      const original = mv.smart.linkedInfo(id);
      const blue = rgb();

      files.set(path, await png(220, 72, 32));
      const updated = await mv.smart.updateLinkedContentsFromPath(id);
      const afterUpdate = mv.smart.linkedInfo(id);
      const orange = rgb();

      files.delete(path);
      const missingResult = await mv.smart.updateLinkedContentsFromPath(id);
      const afterMissing = mv.smart.linkedInfo(id);
      return { linked, original, blue, updated, afterUpdate, orange, missingResult, afterMissing, alerts };
    } finally {
      mv.smart.setLinkedSourceReaderForTests(null);
      window.alert = originalAlert;
    }
  });
  expect(r.linked).toBe(true);
  expect(r.original).toMatchObject({ name: "live-source.png", path: "/linked/live-source.png", missing: false });
  expect(r.blue[2]).toBeGreaterThan(170);
  expect(r.updated).toBe(true);
  expect(r.afterUpdate).toMatchObject({ name: "live-source.png", path: "/linked/live-source.png", missing: false });
  expect(r.afterUpdate.linkedAt).toBe(r.original.linkedAt);
  expect(r.afterUpdate.updatedAt).toBeGreaterThanOrEqual(r.original.updatedAt);
  expect(r.orange[0]).toBeGreaterThan(170);
  expect(r.orange[2]).toBeLessThan(100);
  expect(r.missingResult).toBe(false);
  expect(r.afterMissing).toMatchObject({ name: "live-source.png", path: "/linked/live-source.png", missing: true });
  expect(r.alerts).toHaveLength(1);
  expect(r.alerts[0]).toContain("/linked/live-source.png");
});

test("smart object: linked source watcher refreshes changed paths and marks removals missing", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const files = new Map<string, Uint8Array>();
    const watchers = new Map<string, (event: any) => Promise<void> | void>();
    const unwatched: string[] = [];
    const png = async (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };

    mv.smart.setLinkedSourceReaderForTests(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing test linked source: ${path}`);
      return bytes;
    });
    mv.smart.setLinkedSourceWatcherForTests(async (path: string, cb: (event: any) => Promise<void> | void) => {
      watchers.set(path, cb);
      return () => {
        unwatched.push(path);
        watchers.delete(path);
      };
    });

    try {
      mv.store.newDocument(32, 32, "smart-watch-refresh", "transparent");
      E().select_all(); E().fill_selection(16, 16, 16, 255); E().select_none(); mv.engine.commit();
      const id = mv.store.state.activeLayerId;
      const path = "/linked/watched-source.png";
      files.set(path, await png(32, 72, 220));
      const linked = mv.smart.convertToLinkedFromBytes(files.get(path)!, "watched-source.png", path);
      await mv.smart.syncLinkedSourceWatchers();
      const watchedAfterLink = [...watchers.keys()];
      const original = mv.smart.linkedInfo(id);
      const blue = rgb();

      files.set(path, await png(220, 72, 32));
      await watchers.get(path)?.({ type: { modify: { kind: "data", mode: "content" } }, paths: [path] });
      const afterModify = mv.smart.linkedInfo(id);
      const orange = rgb();

      await watchers.get(path)?.({ type: { remove: { kind: "file" } }, paths: [path] });
      const afterRemove = mv.smart.linkedInfo(id);
      const embedded = mv.smart.embedLinked(id);
      await mv.smart.syncLinkedSourceWatchers();
      return {
        linked,
        watchedAfterLink,
        original,
        blue,
        afterModify,
        orange,
        afterRemove,
        embedded,
        watchedAfterEmbed: [...watchers.keys()],
        unwatched,
      };
    } finally {
      mv.smart.setLinkedSourceWatcherForTests(null);
      mv.smart.setLinkedSourceReaderForTests(null);
    }
  });
  expect(r.linked).toBe(true);
  expect(r.watchedAfterLink).toEqual(["/linked/watched-source.png"]);
  expect(r.original).toMatchObject({ name: "watched-source.png", path: "/linked/watched-source.png", missing: false });
  expect(r.blue[2]).toBeGreaterThan(170);
  expect(r.afterModify).toMatchObject({ name: "watched-source.png", path: "/linked/watched-source.png", missing: false });
  expect(r.afterModify.linkedAt).toBe(r.original.linkedAt);
  expect(r.afterModify.updatedAt).toBeGreaterThanOrEqual(r.original.updatedAt);
  expect(r.orange[0]).toBeGreaterThan(170);
  expect(r.orange[2]).toBeLessThan(100);
  expect(r.afterRemove).toMatchObject({ name: "watched-source.png", path: "/linked/watched-source.png", missing: true });
  expect(r.embedded).toBe(true);
  expect(r.watchedAfterEmbed).toEqual([]);
  expect(r.unwatched).toContain("/linked/watched-source.png");
});

test("smart object: linked source watcher refreshes background documents", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const files = new Map<string, Uint8Array>();
    const watchers = new Map<string, (event: any) => Promise<void> | void>();
    const png = async (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };
    const docSummary = (id: number) => mv.store.state.documents.find((d: { id: number }) => d.id === id);
    const createLinkedDoc = async (name: string, path: string, color: [number, number, number]) => {
      files.set(path, await png(...color));
      mv.store.newDocument(32, 32, name, "transparent");
      E().select_all(); E().fill_selection(16, 16, 16, 255); E().select_none(); mv.engine.commit();
      const layerId = mv.store.state.activeLayerId;
      const linked = mv.smart.convertToLinkedFromBytes(files.get(path)!, path.replace(/^.*[\\/]/, ""), path);
      const docId = mv.store.state.activeDocId;
      mv.store.markActiveSaved();
      return { docId, layerId, linked, color: rgb(), info: mv.smart.linkedInfo(layerId, docId) };
    };

    mv.smart.setLinkedSourceReaderForTests(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing test linked source: ${path}`);
      return bytes;
    });
    mv.smart.setLinkedSourceWatcherForTests(async (path: string, cb: (event: any) => Promise<void> | void) => {
      watchers.set(path, cb);
      return () => watchers.delete(path);
    });

    try {
      const pathA = "/linked/background-a.png";
      const pathB = "/linked/active-b.png";
      const docA = await createLinkedDoc("background-a", pathA, [32, 72, 220]);
      const docB = await createLinkedDoc("active-b", pathB, [24, 220, 64]);
      await mv.smart.syncLinkedSourceWatchers();
      const watched = [...watchers.keys()].sort();
      const activeBefore = mv.store.state.activeDocId;

      files.set(pathA, await png(220, 72, 32));
      await watchers.get(pathA)?.({ type: { modify: { kind: "data", mode: "content" } }, paths: [pathA] });
      const activeAfterBackgroundModify = mv.store.state.activeDocId;
      const activeAfterBackgroundModifyRgb = rgb();
      const docADirtyAfterModify = !!docSummary(docA.docId)?.dirty;

      mv.store.activateDoc(docA.docId);
      const docAAfterModify = {
        activeDocId: mv.store.state.activeDocId,
        rgb: rgb(),
        info: mv.smart.linkedInfo(docA.layerId, docA.docId),
      };

      await watchers.get(pathB)?.({ type: { remove: { kind: "file" } }, paths: [pathB] });
      const activeAfterBackgroundRemove = mv.store.state.activeDocId;
      const docBDirtyAfterRemove = !!docSummary(docB.docId)?.dirty;
      mv.store.activateDoc(docB.docId);
      const docBAfterRemove = {
        activeDocId: mv.store.state.activeDocId,
        rgb: rgb(),
        info: mv.smart.linkedInfo(docB.layerId, docB.docId),
      };

      return {
        docA,
        docB,
        watched,
        activeBefore,
        activeAfterBackgroundModify,
        activeAfterBackgroundModifyRgb,
        docADirtyAfterModify,
        docAAfterModify,
        activeAfterBackgroundRemove,
        docBDirtyAfterRemove,
        docBAfterRemove,
      };
    } finally {
      mv.smart.setLinkedSourceWatcherForTests(null);
      mv.smart.setLinkedSourceReaderForTests(null);
    }
  });
  expect(r.docA.linked).toBe(true);
  expect(r.docB.linked).toBe(true);
  expect(r.watched).toEqual(["/linked/active-b.png", "/linked/background-a.png"]);
  expect(r.activeBefore).toBe(r.docB.docId);
  expect(r.activeAfterBackgroundModify).toBe(r.docB.docId);
  expect(r.activeAfterBackgroundModifyRgb[1]).toBeGreaterThan(170);
  expect(r.docADirtyAfterModify).toBe(true);
  expect(r.docAAfterModify.activeDocId).toBe(r.docA.docId);
  expect(r.docAAfterModify.rgb[0]).toBeGreaterThan(170);
  expect(r.docAAfterModify.rgb[2]).toBeLessThan(100);
  expect(r.docAAfterModify.info).toMatchObject({ path: "/linked/background-a.png", missing: false });
  expect(r.docAAfterModify.info.updatedAt).toBeGreaterThanOrEqual(r.docA.info.updatedAt);
  expect(r.activeAfterBackgroundRemove).toBe(r.docA.docId);
  expect(r.docBDirtyAfterRemove).toBe(true);
  expect(r.docBAfterRemove.activeDocId).toBe(r.docB.docId);
  expect(r.docBAfterRemove.info).toMatchObject({ path: "/linked/active-b.png", missing: true });
  expect(r.docBAfterRemove.rgb[1]).toBeGreaterThan(170);
});

test("smart object: Replace Contents hands linked source watchers to the replacement", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const files = new Map<string, Uint8Array>();
    const watchers = new Map<string, (event: any) => Promise<void> | void>();
    const unwatched: string[] = [];
    const png = async (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const rgb = () => {
      const c = E().pick_color(16, 16) >>> 0;
      return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    };

    mv.smart.setLinkedSourceReaderForTests(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing test linked source: ${path}`);
      return bytes;
    });
    mv.smart.setLinkedSourceWatcherForTests(async (path: string, cb: (event: any) => Promise<void> | void) => {
      watchers.set(path, cb);
      return () => {
        unwatched.push(path);
        watchers.delete(path);
      };
    });

    try {
      mv.store.newDocument(32, 32, "smart-replace-watch-handoff", "transparent");
      E().select_all(); E().fill_selection(16, 16, 16, 255); E().select_none(); mv.engine.commit();
      const id = mv.store.state.activeLayerId;
      const originalPath = "/linked/original-replace-source.png";
      const nativePath = "/linked/native-replacement-source.png";
      files.set(originalPath, await png(32, 72, 220));
      files.set(nativePath, await png(220, 72, 32));

      const linked = mv.smart.convertToLinkedFromBytes(files.get(originalPath)!, "original-replace-source.png", originalPath);
      await mv.smart.syncLinkedSourceWatchers();
      const watchedAfterLink = [...watchers.keys()];
      const original = mv.smart.linkedInfo(id);
      const blue = rgb();

      const pathless = mv.smart.replaceContentsFromBytes(await png(24, 220, 64), "pathless-replacement.png");
      await mv.smart.syncLinkedSourceWatchers();
      const afterPathless = mv.smart.linkedInfo(id);
      const green = rgb();
      const watchedAfterPathless = [...watchers.keys()];

      const native = mv.smart.replaceContentsFromBytes(files.get(nativePath)!, "native-replacement-source.png", nativePath);
      await mv.smart.syncLinkedSourceWatchers();
      const afterNative = mv.smart.linkedInfo(id);
      const orange = rgb();
      const watchedAfterNative = [...watchers.keys()];

      files.set(nativePath, await png(64, 64, 220));
      const replacementWatcher = watchers.get(nativePath);
      if (!replacementWatcher) throw new Error("replacement path was not watched");
      await replacementWatcher({ type: { modify: { kind: "data", mode: "content" } }, paths: [nativePath] });
      const afterNativeModify = mv.smart.linkedInfo(id);
      const purple = rgb();

      return {
        linked,
        watchedAfterLink,
        original,
        blue,
        pathless,
        afterPathless,
        pathlessPath: afterPathless?.path ?? null,
        green,
        watchedAfterPathless,
        native,
        afterNative,
        orange,
        watchedAfterNative,
        afterNativeModify,
        purple,
        unwatched,
      };
    } finally {
      mv.smart.setLinkedSourceWatcherForTests(null);
      mv.smart.setLinkedSourceReaderForTests(null);
    }
  });
  expect(r.linked).toBe(true);
  expect(r.watchedAfterLink).toEqual(["/linked/original-replace-source.png"]);
  expect(r.original).toMatchObject({ name: "original-replace-source.png", path: "/linked/original-replace-source.png", missing: false });
  expect(r.blue[2]).toBeGreaterThan(170);
  expect(r.pathless).toBe(true);
  expect(r.afterPathless).toMatchObject({ name: "pathless-replacement.png", missing: false });
  expect(r.pathlessPath).toBeNull();
  expect(r.green[1]).toBeGreaterThan(170);
  expect(r.watchedAfterPathless).toEqual([]);
  expect(r.unwatched).toContain("/linked/original-replace-source.png");
  expect(r.native).toBe(true);
  expect(r.afterNative).toMatchObject({ name: "native-replacement-source.png", path: "/linked/native-replacement-source.png", missing: false });
  expect(r.orange[0]).toBeGreaterThan(170);
  expect(r.orange[2]).toBeLessThan(100);
  expect(r.watchedAfterNative).toEqual(["/linked/native-replacement-source.png"]);
  expect(r.afterNativeModify).toMatchObject({ name: "native-replacement-source.png", path: "/linked/native-replacement-source.png", missing: false });
  expect(r.afterNativeModify.linkedAt).toBe(r.original.linkedAt);
  expect(r.afterNativeModify.updatedAt).toBeGreaterThanOrEqual(r.afterNative.updatedAt);
  expect(r.purple[2]).toBeGreaterThan(170);
});

test("smart object: linked source metadata survives project save and open", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const c = document.createElement("canvas");
    c.width = 24; c.height = 24;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgb(40, 72, 220)";
    ctx.fillRect(0, 0, 24, 24);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    mv.store.newDocument(24, 24, "smart-linked-roundtrip", "transparent");
    E().select_all(); E().fill_selection(8, 8, 8, 255); E().select_none(); mv.engine.commit();
    const id = mv.store.state.activeLayerId;
    const linked = mv.smart.convertToLinkedFromBytes(bytes, "roundtrip-source.png", "/linked/roundtrip-source.png");
    const missingMarked = mv.smart.markLinkedMissing(id, true);
    const saved = mv.store.saveProject();
    const wrapped = new TextDecoder().decode(saved.slice(0, 40)).startsWith("{");

    mv.store.openProject(saved, "linked-roundtrip.mvision");
    const links = mv.smart.linkedObjects();
    const activeId = mv.store.state.activeLayerId;
    const info = mv.smart.linkedInfo(activeId);
    const packed = E().pick_color(12, 12) >>> 0;
    return {
      linked,
      missingMarked,
      wrapped,
      links,
      info,
      kind: E().layer_kind(activeId),
      rgb: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255],
    };
  });
  expect(r.linked).toBe(true);
  expect(r.missingMarked).toBe(true);
  expect(r.wrapped).toBe(true);
  expect(r.links).toHaveLength(1);
  expect(r.info).toMatchObject({ name: "roundtrip-source.png", path: "/linked/roundtrip-source.png", missing: true });
  expect(r.kind).toBe(7);
  expect(r.rgb[2]).toBeGreaterThan(170);
});

test("smart object: missing linked source is visible in Layers panel and can be embedded", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const c = document.createElement("canvas");
    c.width = 24; c.height = 24;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgb(40, 72, 220)";
    ctx.fillRect(0, 0, 24, 24);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    mv.store.newDocument(24, 24, "smart-missing-ui", "transparent");
    const id = mv.store.state.activeLayerId;
    const linked = mv.smart.convertToLinkedFromBytes(bytes, "missing-source.png", "/lost/missing-source.png");
    const missingMarked = mv.smart.markLinkedMissing(id, true);
    const layer = mv.store.state.layers.find((l: any) => l.id === id);
    return { linked, missingMarked, smartLink: layer?.smartLink };
  });
  expect(r.linked).toBe(true);
  expect(r.missingMarked).toBe(true);
  expect(r.smartLink).toMatchObject({ name: "missing-source.png", path: "/lost/missing-source.png", missing: true });

  const warning = page.locator("[data-mv-smart-link-warning]");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Missing linked source: missing-source.png");
  await expect(page.locator('[data-mv-smart-link-state="missing"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-smart-link-name-state="missing"]')).toHaveText("Missing");

  await warning.getByRole("button", { name: "Embed" }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.locator('[data-mv-smart-link-state="missing"]')).toHaveCount(0);
  await expect(page.locator('[data-mv-smart-link-name-state="missing"]')).toHaveCount(0);

  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    const layer = mv.store.state.layers.find((l: any) => l.id === id);
    return { info: mv.smart.linkedInfo(id), smartLink: layer?.smartLink };
  });
  expect(after.info).toBeNull();
  expect(after.smartLink).toBeUndefined();
});
